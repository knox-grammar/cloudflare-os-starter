import { WorkerEntrypoint, DurableObject, RpcTarget, RpcStub } from "cloudflare:workers";
import { validateRpc } from "capnweb-validate";
import {
  GatekeeperUser,
  GatekeeperUserVerifier,
  GatekeeperVendor as GatekeeperVendorIface,
  Gatekeeper,
  ResourceDescription,
  ApprovalQueue,
  VendorDescription,
  GatekeeperConnectCallback,
  GatekeeperConnectOptions,
  AccountDescription,
  SupportedResource,
  ResourceConfiguratorFrame,
} from "@gadgets/workshop-shared/gatekeeper";
import {
  authorizeEndpoint,
  exchangeAuthCode,
  refreshAccessToken,
  getMicrosoftAccountDescription,
  getMicrosoftVerifiedEmail,
  htmlToPlainText,
  markdownToHtml,
  graphAttendeeResponse,
  MailApi,
  CalendarApi,
  MicrosoftAccessToken,
  GraphMessage,
  GraphEvent,
} from "./microsoft-api";
import { AccessTokenCache, AccessTokenRequest } from "./auth-retry";
import type {
  Cursor,
  OutlookMailSession,
  OutlookCalendarSession,
  MailThread,
  MailThreadSummary,
  MailMessage,
  DraftMail,
  CalendarEvent,
  NewCalendarEvent,
  CalendarEventUpdate,
  FreeSlot,
} from "./types";
import TYPES_CODE from "./types.txt";
import MICROSOFT_LOGO_SVG from "./microsoft-logo.svg";

const VENDOR_ID = "microsoft";

const NONCE_BYTES = 32;
const INITIATION_NONCE_LIFETIME_MS = 10 * 60 * 1000;
const OAUTH_NONCE_LIFETIME_MS = 10 * 60 * 1000;
const TOKEN_MINT_TIMEOUT_MS = 20 * 1000;
const AUTH_CODE_EXCHANGE_TIMEOUT_MS = 30 * 1000;
const MINT_FAILURE_COOLDOWN_MS = 60 * 1000;

function hexEncode(bytes: Uint8Array): string {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateNonce(): string {
  return hexEncode(crypto.getRandomValues(new Uint8Array(NONCE_BYTES)));
}

function constantTimeEqual(a: string, b: string): boolean {
  let encoder = new TextEncoder();
  let bufA = encoder.encode(a);
  let bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;
  return crypto.subtle.timingSafeEqual(bufA, bufB);
}

type Env = Cloudflare.Env & {
  BASE_URL?: string;
  TENANT_ID: string;
  CLIENT_ID?: string;
  CLIENT_SECRET?: string;
};

function getBaseUrl(env: Env) {
  return (env.BASE_URL || "http://localhost:8787/gatekeeper/microsoft").replace(/\/+$/, "");
}

function getBasePath(env: Env) {
  const path = new URL(getBaseUrl(env)).pathname;
  return path === "/" ? "" : path;
}

const SELF_CLOSING_HTML = `<!DOCTYPE html>
<html lang="en">
  <body>
    <script type="text/javascript">window.close();</script>
    <p>Authorization complete. You may close this tab and return to the Gadgets Workshop.
  </body>
</html>`;

const INVALID_LINK_HTML = `<!DOCTYPE html>
<html lang="en">
  <body>
    <p>This link has expired or was already used. Please return to the Gadgets Workshop and try
    connecting again.</p>
  </body>
</html>`;

const NOT_CONFIGURED_HTML = `<!DOCTYPE html>
<html lang="en">
  <body>
    <p>The Microsoft Gatekeeper is not configured. An administrator needs to set CLIENT_ID and
    CLIENT_SECRET.</p>
  </body>
</html>`;

type StoredNonce = {
  value: string;
  expiresAt: number;
  stage: "initiation" | "oauth";
};

// ===========================================================================================
// Resource types and OAuth scopes
// ===========================================================================================

const IDENTITY_SCOPES = ["openid", "profile", "email", "User.Read", "offline_access"];
const AUTH_SCOPES = IDENTITY_SCOPES;

const OUTLOOK_MAIL_RESOURCE: SupportedResource = {
  urlPattern: "https://outlook.office.com/mail/*",
  title: "Outlook Mailbox",
  description: "Read email, organise it, and draft replies.",
  grantable: true,
};

const OUTLOOK_CALENDAR_RESOURCE: SupportedResource = {
  urlPattern: "https://outlook.office.com/calendar/:calendarId/*",
  title: "Outlook Calendar",
  description: "Read and manage a single Outlook calendar.",
  grantable: true,
};

const RESOURCE_SCOPES: { resource: SupportedResource; scopes: string[] }[] = [
  { resource: OUTLOOK_MAIL_RESOURCE, scopes: ["https://graph.microsoft.com/Mail.ReadWrite"] },
  { resource: OUTLOOK_CALENDAR_RESOURCE, scopes: ["https://graph.microsoft.com/Calendars.ReadWrite"] },
];

const SUPPORTED_RESOURCES: SupportedResource[] = RESOURCE_SCOPES.map(entry => entry.resource);

function validateResourceUrlPatterns(resourceUrlPatterns?: string[]): void {
  if (resourceUrlPatterns === undefined) return;
  let known = new Set(RESOURCE_SCOPES.map(entry => entry.resource.urlPattern));
  let unknown = resourceUrlPatterns.filter(pattern => !known.has(pattern));
  if (unknown.length > 0) {
    throw new Error(`Unknown grantable resource URL pattern(s): ${unknown.join(", ")}`);
  }
}

function resourceUrlPatternsToOAuthScopes(resourceUrlPatterns?: string[]): string[] {
  validateResourceUrlPatterns(resourceUrlPatterns);
  let scopes = new Set<string>(IDENTITY_SCOPES);
  for (let entry of RESOURCE_SCOPES) {
    if (resourceUrlPatterns === undefined || resourceUrlPatterns.includes(entry.resource.urlPattern)) {
      for (let scope of entry.scopes) scopes.add(scope);
    }
  }
  return [...scopes];
}

function grantedResourcesFromScopes(grantedOAuthScopes: string[]): string[] {
  let granted = new Set(grantedOAuthScopes.map(s => s.toLowerCase()));
  return RESOURCE_SCOPES
      .filter(entry => entry.scopes.every(scope => granted.has(scope.toLowerCase())))
      .map(entry => entry.resource.urlPattern);
}

const MICROSOFT_LOGO_URL = `data:image/svg+xml,${encodeURIComponent(MICROSOFT_LOGO_SVG)}`;

// ===========================================================================================
// Approval-queue helpers, shared by both resource gatekeepers.
//
// Approval model (see write-gatekeeper SKILL.md "Logging and approvals"): every read calls
// authorizeObservation() before returning data; every side-effecting write is stored via
// submitAction() and not actually performed until the overseer calls applyAction(). Neither
// gatekeeper simulates pending actions (reads do not reflect an unapplied archive/draft/event
// change) -- gatekeeper-google's own Gmail actions make the same choice for the same reason:
// simulation is optional per the SKILL, and these actions don't need it enough to justify the
// complexity. Revisit if that proves confusing in practice.
// ===========================================================================================

function sanitizeApprovalTitle(value: string): string {
  return value.replace(/[\r\n]+/g, " ").slice(0, 200);
}

function formatApprovalField(label: string, value: string): string {
  // Use a fence longer than any backtick run in the value, so untrusted email/event fields
  // render verbatim and cannot forge surrounding approval Markdown.
  let fence = "```";
  while (value.includes(fence)) fence += "`";
  return `**${label}:**\n\n${fence}\n${value}\n${fence}`;
}

/** Ported unchanged from gatekeeper-google -- generic pending-action ledger keyed by DO storage. */
class PendingActionStore<Action> {
  #kv: DurableObjectStorage["kv"];

  constructor(kv: DurableObjectStorage["kv"]) {
    this.#kv = kv;
  }

  #actionKey(id: number): string {
    return `pending:action:${id}`;
  }

  submit(action: Action): number {
    let id = this.#kv.get<number>("pending:nextActionId") ?? 1;
    this.#kv.put("pending:nextActionId", id + 1);
    this.#kv.put(this.#actionKey(id), action);
    return id;
  }

  get(id: number): Action | undefined {
    return this.#kv.get<Action>(this.#actionKey(id));
  }

  list(): { id: number; action: Action }[] {
    return [...this.#kv.list<Action>({ prefix: "pending:action:" })]
        .map(([key, action]) => ({ id: Number(key.slice("pending:action:".length)), action }))
        .filter(({ id }) => Number.isFinite(id))
        .toSorted((a, b) => a.id - b.id);
  }

  remove(id: number): void {
    this.#kv.delete(this.#actionKey(id));
  }
}

async function submitAction<Action>(
    pendingActions: PendingActionStore<Action>, approvalQueue: RpcStub<ApprovalQueue>,
    action: Action, desc: { title: string; description: string }): Promise<void> {
  if (pendingActions.list().length >= 100) {
    throw new Error("Too many pending actions. Resolve existing actions before adding more.");
  }
  let actionId = pendingActions.submit(action);
  try {
    await approvalQueue.submitAction(actionId, { ...desc, implementsRevert: false });
  } catch (err) {
    pendingActions.remove(actionId);
    throw err;
  }
}

// ===========================================================================================
// HTTP handler -- OAuth initiation and completion.
// ===========================================================================================

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    let url = new URL(req.url);
    let basePath = getBasePath(env);
    if (!url.pathname.startsWith(basePath + "/") && url.pathname !== basePath) {
      throw new Error(`Request path ${url.pathname} does not match BASE_URL path ${basePath}`);
    }
    let relPath = url.pathname.slice(basePath.length);
    let path = relPath.slice(1).split("/");

    if (path.length === 2 && path[0].length === 64 && path[1].length === NONCE_BYTES * 2) {
      if (!env.CLIENT_ID || !env.CLIENT_SECRET) {
        return new Response(NOT_CONFIGURED_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      let doId = path[0];
      let initiationNonce = path[1];
      let stub = ctx.exports.UserAccount.get(ctx.exports.UserAccount.idFromString(doId));
      let begun = await stub.beginOAuthFlow(initiationNonce);
      if (begun === null) {
        return new Response(INVALID_LINK_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      let newUrl = new URL(authorizeEndpoint(env.TENANT_ID));
      newUrl.searchParams.set("client_id", env.CLIENT_ID);
      newUrl.searchParams.set("redirect_uri", getBaseUrl(env) + "/oauth");
      newUrl.searchParams.set("response_type", "code");
      newUrl.searchParams.set("response_mode", "query");
      newUrl.searchParams.set("scope", begun.scopes.join(" "));
      newUrl.searchParams.set("state", `${doId}:${begun.oauthNonce}`);

      return Response.redirect(newUrl.toString(), 302);
    } else if (relPath === "/oauth") {
      let error = url.searchParams.get("error");
      if (error) {
        return new Response(`${error}: ${url.searchParams.get("error_description")}`);
      }

      let state = url.searchParams.get("state");
      if (!state) return new Response("Error: no 'state' provided");
      let colonIdx = state.indexOf(":");
      if (colonIdx < 0) return new Response("Error: malformed state");
      let doId = state.slice(0, colonIdx);
      let oauthNonce = state.slice(colonIdx + 1);

      let code = url.searchParams.get("code");
      if (!code) return new Response("Error: no 'code' provided");

      let userObjectId = ctx.exports.UserAccount.idFromString(doId);
      let stub: DurableObjectStub<UserAccount> = ctx.exports.UserAccount.get(userObjectId);
      if (!await stub.acceptAuthCode(code, oauthNonce)) {
        return new Response(INVALID_LINK_HTML, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response(SELF_CLOSING_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } else {
      return new Response("Not Found", { status: 404 });
    }
  },
};

// ===========================================================================================
// Vendor
// ===========================================================================================

@validateRpc()
export class GatekeeperVendor extends WorkerEntrypoint<Env> implements GatekeeperVendorIface {
  status() {
    return "Microsoft Gatekeeper";
  }

  async describe(): Promise<VendorDescription> {
    return {
      displayName: "Microsoft",
      url: "https://microsoft.com",
      logo: { url: MICROSOFT_LOGO_URL },
      color: "#f3f2f1",
      tagline: "Read email, draft replies, and manage a calendar",
      description:
          "Connect your Microsoft 365 account to give Cloudflare OS access to your Outlook " +
          "mailbox and calendar. Build agents that triage email, draft replies for you to send, " +
          "find meeting times, and manage calendar events.",
      providesAuth: true,
    };
  }

  async connectAccount(callback: Fetcher<GatekeeperConnectCallback>,
                        options?: GatekeeperConnectOptions): Promise<{ url: string }> {
    let userObjectId = this.ctx.exports.UserAccount.newUniqueId();
    let initiationNonce = generateNonce();

    let authOnly = options?.scopes === "auth";
    let requestedScopes = authOnly
        ? AUTH_SCOPES
        : resourceUrlPatternsToOAuthScopes(options?.resourceUrlPatterns);
    await this.ctx.exports.UserAccount.get(userObjectId)
        .setCallback(callback, initiationNonce, requestedScopes, authOnly);

    return { url: `${getBaseUrl(this.env)}/${userObjectId.toString()}/${initiationNonce}` };
  }

  async newUser(): Promise<Fetcher<GatekeeperUser>> {
    let userObjectId = this.ctx.exports.UserAccount.newUniqueId();
    let props: MicrosoftUserImplProps = { userObjectId: userObjectId.toString() };
    return this.ctx.exports.MicrosoftUserImpl({ props });
  }

  async getSupportedResources(): Promise<SupportedResource[]> {
    return SUPPORTED_RESOURCES;
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }
}

// ===========================================================================================
// UserAccount -- per-connected-account Durable Object holding OAuth credentials.
// ===========================================================================================

export class UserAccount extends DurableObject<Env> {
  // Serialize minting, reconnect, and revoke against each other. See gatekeeper-google's UserAccount
  // for the full reasoning -- same pattern, ported unchanged.
  #credentialUpdate: Promise<void> = Promise.resolve();
  #mintFailure: { error: Error; at: number } | undefined;

  async #updateCredentials<T>(operation: () => Promise<T>): Promise<T> {
    let previous = this.#credentialUpdate;
    let release!: () => void;
    this.#credentialUpdate = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async setCallback(
      callback: Fetcher<GatekeeperConnectCallback>, initiationNonce: string,
      requestedScopes: string[], ephemeral?: boolean) {
    if (!this.ctx.storage.kv.get<string>("refreshToken")) {
      this.ctx.storage.setAlarm(Date.now() + 3600 * 1000);
    }
    this.ctx.storage.kv.put("callback", callback);
    this.ctx.storage.kv.put<string[]>("requestedScopes", requestedScopes);
    this.ctx.storage.kv.put<boolean>("ephemeral", ephemeral ?? false);
    this.ctx.storage.kv.put<StoredNonce>("nonce", {
      value: initiationNonce,
      expiresAt: Date.now() + INITIATION_NONCE_LIFETIME_MS,
      stage: "initiation",
    });
  }

  async prepareReconnect(initiationNonce: string, requestedScopes: string[]) {
    this.ctx.storage.kv.put<boolean>("reconnecting", true);
    this.ctx.storage.kv.put<string[]>("requestedScopes", requestedScopes);
    this.ctx.storage.kv.put<StoredNonce>("nonce", {
      value: initiationNonce,
      expiresAt: Date.now() + INITIATION_NONCE_LIFETIME_MS,
      stage: "initiation",
    });
  }

  async getGrantedResourceUrlPatterns(): Promise<string[]> {
    let granted = this.ctx.storage.kv.get<string[]>("grantedScopes");
    if (granted === undefined) return [];
    return grantedResourcesFromScopes(granted);
  }

  async beginOAuthFlow(initiationNonce: string): Promise<{ oauthNonce: string; scopes: string[] } | null> {
    let stored = this.ctx.storage.kv.get<StoredNonce>("nonce");
    if (!stored || stored.stage !== "initiation" ||
        Date.now() >= stored.expiresAt || !constantTimeEqual(stored.value, initiationNonce)) {
      return null;
    }
    let oauthNonce = generateNonce();
    this.ctx.storage.kv.put<StoredNonce>("nonce", {
      value: oauthNonce,
      expiresAt: Date.now() + OAUTH_NONCE_LIFETIME_MS,
      stage: "oauth",
    });
    let scopes = this.ctx.storage.kv.get<string[]>("requestedScopes") ?? resourceUrlPatternsToOAuthScopes();
    return { oauthNonce, scopes };
  }

  async acceptAuthCode(code: string, oauthNonce: string): Promise<boolean> {
    let stored = this.ctx.storage.kv.get<StoredNonce>("nonce");
    if (!stored || stored.stage !== "oauth" ||
        Date.now() >= stored.expiresAt || !constantTimeEqual(stored.value, oauthNonce)) {
      return false;
    }
    this.ctx.storage.kv.delete("nonce");

    let { CLIENT_ID: clientId, CLIENT_SECRET: clientSecret, TENANT_ID: tenantId } = this.env;
    if (!clientId || !clientSecret) {
      throw new Error("The Microsoft Gatekeeper is not configured.");
    }

    let completion = await this.#updateCredentials(async () => {
      let callback = this.ctx.storage.kv.get<Fetcher<GatekeeperConnectCallback>>("callback");
      if (!callback) {
        throw new Error("Took too long to complete the authorization. Please try again.");
      }

      let response = await exchangeAuthCode(
          tenantId, code, clientId, clientSecret, getBaseUrl(this.env) + "/oauth",
          AbortSignal.timeout(AUTH_CODE_EXCHANGE_TIMEOUT_MS));

      this.ctx.storage.kv.put<string>("refreshToken", response.refreshToken);
      this.ctx.storage.kv.put<MicrosoftAccessToken>("accessToken", response.accessToken);
      this.#mintFailure = undefined;
      this.ctx.storage.kv.put<string[]>("grantedScopes", response.grantedScopes);
      this.ctx.storage.kv.delete("requestedScopes");

      let reconnecting = this.ctx.storage.kv.get<boolean>("reconnecting");
      if (reconnecting) this.ctx.storage.kv.delete("reconnecting");
      return { callback, reconnecting: !!reconnecting };
    });

    let callback = completion.callback;
    if (completion.reconnecting) {
      await callback.credentialsRestored();
    } else {
      try {
        let props: MicrosoftUserImplProps = { userObjectId: this.ctx.id.toString() };
        await callback.complete(this.ctx.exports.MicrosoftUserImpl({ props }));
      } catch (err) {
        this.ctx.storage.kv.delete("refreshToken");
        throw err;
      }
      if (this.ctx.storage.kv.get<boolean>("ephemeral")) {
        this.ctx.storage.setAlarm(Date.now() + 2 * 60 * 1000);
      }
    }
    return true;
  }

  hasRefreshToken() {
    return this.ctx.storage.kv.get<string>("refreshToken") !== undefined;
  }

  #tokenSatisfies(cached: MicrosoftAccessToken | undefined, opts?: AccessTokenRequest)
      : cached is MicrosoftAccessToken {
    if (!cached) return false;
    if (cached.expires.valueOf() <= Date.now() + 60 * 1000) return false;
    if (opts?.staleToken !== undefined) return cached.token !== opts.staleToken;
    return !opts?.forceRefresh;
  }

  async getAccessToken(opts?: AccessTokenRequest): Promise<MicrosoftAccessToken> {
    let { CLIENT_ID: clientId, CLIENT_SECRET: clientSecret, TENANT_ID: tenantId } = this.env;
    if (!clientId || !clientSecret) {
      throw new Error("The Microsoft Gatekeeper is not configured.");
    }
    if (!this.ctx.storage.kv.get<string>("refreshToken")) {
      throw new Error("no refresh token set");
    }

    let cached = this.ctx.storage.kv.get<MicrosoftAccessToken>("accessToken");
    if (this.#tokenSatisfies(cached, opts)) return cached;

    return this.#updateCredentials(async () => {
      let fresh = this.ctx.storage.kv.get<MicrosoftAccessToken>("accessToken");
      if (this.#tokenSatisfies(fresh, opts)) return fresh;

      if (this.#mintFailure && Date.now() - this.#mintFailure.at < MINT_FAILURE_COOLDOWN_MS) {
        throw this.#mintFailure.error;
      }

      let refreshToken = this.ctx.storage.kv.get<string>("refreshToken");
      if (!refreshToken) throw new Error("no refresh token set");

      let result = await refreshAccessToken(
          tenantId, refreshToken, clientId, clientSecret,
          AbortSignal.timeout(TOKEN_MINT_TIMEOUT_MS));
      if (!result.ok) {
        let error = new Error(
            result.reason === "policyBlocked"
                ? `A Microsoft Entra admin has restricted access this connection needs ` +
                  `(${result.detail}). Ask your administrator to allow it — re-authenticating ` +
                  "will not help."
                : "Microsoft credentials have expired or been revoked. Please re-authenticate.");
        this.#mintFailure = { error, at: Date.now() };
        this.#notifyCredentialsDead();
        throw error;
      }

      if (this.ctx.storage.kv.get<string>("refreshToken") !== refreshToken) {
        let current = this.ctx.storage.kv.get<MicrosoftAccessToken>("accessToken");
        if (current) return current;
        throw new Error("Microsoft credentials changed while refreshing. Please try again.");
      }

      this.ctx.storage.kv.put<MicrosoftAccessToken>("accessToken", result.token);
      return result.token;
    });
  }

  #notifyCredentialsDead(): void {
    let callback = this.ctx.storage.kv.get<Fetcher<GatekeeperConnectCallback>>("callback");
    callback?.credentialsExpired().catch(() => {});
  }

  async alarm(): Promise<void> {
    await this.#updateCredentials(async () => {
      if (!this.hasRefreshToken() || this.ctx.storage.kv.get<boolean>("ephemeral")) {
        this.ctx.storage.deleteAll();
      }
    });
  }

  /**
   * See `REVOKE_IS_LOCAL_ONLY` in microsoft-api.ts: Microsoft has no client-callable token revoke
   * endpoint, so this only drops our own copy of the refresh token. The underlying consent grant
   * in Microsoft Entra ID remains until the user or a tenant admin removes it there.
   */
  async revoke(): Promise<void> {
    await this.#updateCredentials(async () => {
      this.ctx.storage.deleteAlarm();
      this.ctx.storage.deleteAll();
    });
  }
}

// ===========================================================================================
// MicrosoftUserImpl -- maps resource URLs to gatekeeper DO classes.
// ===========================================================================================

type MicrosoftUserImplProps = {
  userObjectId: string;
};

@validateRpc()
export class MicrosoftUserImpl extends WorkerEntrypoint<Env, MicrosoftUserImplProps>
    implements GatekeeperUser {
  #account() {
    let id = this.ctx.exports.UserAccount.idFromString(this.ctx.props.userObjectId);
    return this.ctx.exports.UserAccount.get(id);
  }

  async describe(): Promise<AccountDescription> {
    let account = this.#account();
    let tokenPromise = account.getAccessToken();
    let grantedResourcesPromise = account.getGrantedResourceUrlPatterns();
    let token = await tokenPromise;
    let description = await getMicrosoftAccountDescription(token.token);
    description.grantedResourceUrlPatterns = await grantedResourcesPromise;
    return description;
  }

  async getAuthenticatedEmail(): Promise<string | null> {
    try {
      let token = await this.#account().getAccessToken();
      if (!token) return null;
      return await getMicrosoftVerifiedEmail(token.token);
    } catch {
      return null;
    }
  }

  async getSupportedResources(): Promise<SupportedResource[]> {
    return SUPPORTED_RESOURCES;
  }

  async getGatekeeperClassFor(url: string): Promise<{
    class: DurableObjectClass<Gatekeeper<any>>;
    resource: SupportedResource;
  }> {
    let parsed = new URL(url);
    if (parsed.hostname !== "outlook.office.com") {
      throw new Error(`Unsupported Microsoft resource URL: ${url}`);
    }

    if (parsed.pathname.startsWith("/calendar/")) {
      let calendarId = decodeURIComponent(parsed.pathname.split("/")[2] ?? "");
      if (!calendarId) throw new Error("Invalid Outlook Calendar URL: no calendar ID found");
      let props: OutlookCalendarGatekeeperImplProps = {
        userObjectId: this.ctx.props.userObjectId, calendarId,
      };
      return {
        class: this.ctx.exports.OutlookCalendarGatekeeperImpl({ props }),
        resource: OUTLOOK_CALENDAR_RESOURCE,
      };
    }

    if (parsed.pathname === "/mail" || parsed.pathname.startsWith("/mail/")) {
      let props: OutlookMailGatekeeperImplProps = { userObjectId: this.ctx.props.userObjectId };
      let hash = parsed.hash;
      if (hash.startsWith("#folder/")) {
        let folderName = decodeURIComponent(hash.slice("#folder/".length));
        if (!folderName || new TextEncoder().encode(folderName).byteLength > 255) {
          throw new Error("Outlook mail folder name must be between 1 and 255 bytes.");
        }
        props.folder = folderName;
      } else if (hash && hash !== "#inbox") {
        throw new Error(
            "Unsupported Outlook Mail view. Connect the whole mailbox or an explicit folder.");
      }
      return {
        class: this.ctx.exports.OutlookMailGatekeeperImpl({ props }),
        resource: OUTLOOK_MAIL_RESOURCE,
      };
    }

    throw new Error(`Unsupported Microsoft resource URL: ${url}`);
  }

  async startResourceConfigurator(_resourceUrlPattern: string): Promise<ResourceConfiguratorFrame> {
    // TODO(Phase 1 follow-up): build the folder-picker (mail) and calendar-picker (calendar)
    // configurator UIs per write-gatekeeper's Step 6, using @gadgets/configurator-ui the way
    // gatekeeper-google's src/configurator/*-ui.tsx do. Not implemented in this pass -- see
    // plans/gatekeeper-microsoft.md.
    throw new Error(
        "Resource selection UI for the Microsoft gatekeeper is not implemented yet. " +
        "See plans/gatekeeper-microsoft.md.");
  }

  async revoke(): Promise<void> {
    await this.#account().revoke();
  }

  async reconnect(): Promise<{ url: string }> {
    let account = this.#account();
    let initiationNonce = generateNonce();
    let requestedScopes = resourceUrlPatternsToOAuthScopes(await account.getGrantedResourceUrlPatterns());
    await account.prepareReconnect(initiationNonce, requestedScopes);
    return { url: `${getBaseUrl(this.env)}/${this.ctx.props.userObjectId}/${initiationNonce}` };
  }

  async ensureResources(resourceUrlPatterns: string[]): Promise<{ url?: string }> {
    let account = this.#account();
    let granted = new Set<string>(await account.getGrantedResourceUrlPatterns());
    if (resourceUrlPatterns.every(pattern => granted.has(pattern))) return {};

    let unionPatterns = new Set<string>([...granted, ...resourceUrlPatterns]);
    let requestedScopes = resourceUrlPatternsToOAuthScopes([...unionPatterns]);
    let initiationNonce = generateNonce();
    await account.prepareReconnect(initiationNonce, requestedScopes);
    return { url: `${getBaseUrl(this.env)}/${this.ctx.props.userObjectId}/${initiationNonce}` };
  }

  /**
   * Both Outlook Mail and Outlook Calendar use observer strategy A (private-only, see the plan
   * doc): addObserver always throws on both, so this verifier is minted but never consulted. It
   * still needs a real public method -- an empty WorkerEntrypoint is never registered in
   * `ctx.exports` -- so it exposes a no-op, matching the write-gatekeeper skill's guidance for a
   * verifier with no strategy-B/C consumer.
   */
  async getVerifier(): Promise<Fetcher<GatekeeperUserVerifier>> {
    let props: MicrosoftVerifierProps = { userObjectId: this.ctx.props.userObjectId };
    return this.ctx.exports.MicrosoftVerifier({ props });
  }
}

// ===========================================================================================
// Verifier -- both resources currently use strategy A, so this exists only to satisfy the
// mandatory getVerifier()/addObserver() contract. Revisit if calendar sharing becomes strategy B.
// ===========================================================================================

type MicrosoftVerifierProps = {
  userObjectId: string;
};

export interface MicrosoftVerifierApi extends GatekeeperUserVerifier {
  verify(): Promise<void>;
}

export class MicrosoftVerifier extends WorkerEntrypoint<Env, MicrosoftVerifierProps>
    implements MicrosoftVerifierApi {
  async verify(): Promise<void> {}
}

// ===========================================================================================
// Outlook Mail
// ===========================================================================================

type OutlookMailGatekeeperImplProps = {
  userObjectId: string;
  /** Optional folder-name scope. When set, list() is confined to it and getThread() rejects
   *  conversations that don't live in it. */
  folder?: string;
};

function graphMessageToSummary(m: GraphMessage): MailThreadSummary {
  return {
    id: m.conversationId,
    subject: m.subject ?? "",
    participants: m.from?.emailAddress ? [{ name: m.from.emailAddress.name, address: m.from.emailAddress.address }] : [],
    preview: (m.bodyPreview ?? "").slice(0, 200),
    lastReceivedAt: new Date(m.receivedDateTime),
    messageCount: 1, // Corrected to the real count once messages() is called; see MailThreadImpl.
    hasUnread: !m.isRead,
    hasAttachments: m.hasAttachments,
  };
}

function graphMessageToMailMessage(m: GraphMessage, attachments: { id: string; filename: string; contentType: string; size: number }[]): MailMessage {
  return {
    id: m.id,
    subject: m.subject ?? "",
    from: m.from?.emailAddress ? { name: m.from.emailAddress.name, address: m.from.emailAddress.address } : { address: "" },
    to: (m.toRecipients ?? []).map(r => ({ name: r.emailAddress.name, address: r.emailAddress.address })),
    cc: (m.ccRecipients ?? []).map(r => ({ name: r.emailAddress.name, address: r.emailAddress.address })),
    receivedAt: new Date(m.receivedDateTime),
    body: m.body ? (m.body.contentType === "html" ? htmlToPlainText(m.body.content) : m.body.content) : "",
    unread: !m.isRead,
    attachments,
  };
}

type OutlookMailAction =
  | { type: "archive" | "delete" | "markRead" | "markUnread"; conversationId: string }
  | { type: "moveTo"; conversationId: string; folder: string }
  | { type: "createDraft"; to: string[]; cc: string[]; subject: string; body: string }
  | { type: "draftReply"; conversationId: string; body: string; replyAll: boolean }
  | { type: "draftForward"; conversationId: string; to: string[]; body: string };

type OutlookMailSessionContext = {
  mailApi: MailApi;
  approvalQueue: RpcStub<ApprovalQueue>;
  pendingActions: PendingActionStore<OutlookMailAction>;
  folderId: string | undefined;
};

class MailThreadImpl extends RpcTarget implements MailThread {
  #ctx: OutlookMailSessionContext;
  #conversationId: string;
  #messages: GraphMessage[]; // ascending by receivedDateTime, bodies already fetched

  constructor(ctx: OutlookMailSessionContext, conversationId: string, messages: GraphMessage[]) {
    super();
    this.#ctx = ctx;
    this.#conversationId = conversationId;
    this.#messages = messages;
  }

  #mostRecent(): GraphMessage {
    let last = this.#messages[this.#messages.length - 1];
    if (!last) throw new Error("Conversation has no messages.");
    return last;
  }

  #subject(): string {
    return this.#mostRecent().subject || "(no subject)";
  }

  async summary(): Promise<MailThreadSummary> {
    let latest = this.#mostRecent();
    let summary = graphMessageToSummary(latest);
    summary.id = this.#conversationId;
    summary.messageCount = this.#messages.length;
    summary.hasUnread = this.#messages.some(m => !m.isRead);
    summary.hasAttachments = this.#messages.some(m => m.hasAttachments);
    // No separate authorization here: getThread() already authorized the full read of every
    // message in this conversation (bodies included), and this method only exposes a subset of
    // that same already-authorized data.
    return summary;
  }

  async messages(): Promise<MailMessage[]> {
    let capped = this.#messages.slice(-100);
    return Promise.all(capped.map(async m => {
      let attachments = m.hasAttachments ? await this.#ctx.mailApi.listAttachments(m.id) : [];
      return graphMessageToMailMessage(
          m, attachments.map(a => ({ id: a.id, filename: a.name, contentType: a.contentType, size: a.size })));
    }));
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<ArrayBuffer> {
    if (!this.#messages.some(m => m.id === messageId)) {
      throw new Error(`Message not in this conversation: ${messageId}`);
    }
    let bytes = await this.#ctx.mailApi.getAttachmentBytes(messageId, attachmentId);
    await this.#ctx.approvalQueue.authorizeObservation({
      title: sanitizeApprovalTitle(`Download attachment: ${this.#subject()}`),
      description: `Download attachment ${attachmentId} from message ${messageId}.`,
    });
    return bytes;
  }

  async #submitThreadAction(
      type: "archive" | "delete" | "markRead" | "markUnread", titlePrefix: string, intro: string)
      : Promise<void> {
    let subject = this.#subject();
    await submitAction(this.#ctx.pendingActions, this.#ctx.approvalQueue,
        { type, conversationId: this.#conversationId },
        {
          title: sanitizeApprovalTitle(`${titlePrefix}: ${subject}`),
          description: `${intro}\n\n${formatApprovalField("Subject", subject)}`,
        });
  }

  async archive(): Promise<void> {
    await this.#submitThreadAction("archive", "Archive", "Move this conversation to the Archive folder.");
  }

  async delete(): Promise<void> {
    await this.#submitThreadAction("delete", "Delete", "Move this conversation to Deleted Items.");
  }

  async markRead(): Promise<void> {
    await this.#submitThreadAction("markRead", "Mark read", "Mark every message in this conversation as read.");
  }

  async markUnread(): Promise<void> {
    await this.#submitThreadAction("markUnread", "Mark unread", "Mark every message in this conversation as unread.");
  }

  async moveTo(folder: string): Promise<void> {
    let subject = this.#subject();
    await submitAction(this.#ctx.pendingActions, this.#ctx.approvalQueue,
        { type: "moveTo", conversationId: this.#conversationId, folder },
        {
          title: sanitizeApprovalTitle(`Move to ${folder}: ${subject}`),
          description: `Move this conversation to the "${folder}" folder.\n\n` +
              formatApprovalField("Subject", subject),
        });
  }

  async draftReply(body: string, replyAll?: boolean): Promise<void> {
    let subject = this.#subject();
    await submitAction(this.#ctx.pendingActions, this.#ctx.approvalQueue,
        { type: "draftReply", conversationId: this.#conversationId, body, replyAll: replyAll ?? false },
        {
          title: sanitizeApprovalTitle(`Draft reply: ${subject}`),
          description: `Create a draft reply${replyAll ? " to all recipients" : ""} in the Drafts ` +
              "folder. It is not sent automatically.\n\n" +
              formatApprovalField("Subject", subject) + "\n\n" + formatApprovalField("Body", body),
        });
  }

  async draftForward(to: string[], body?: string): Promise<void> {
    let subject = this.#subject();
    await submitAction(this.#ctx.pendingActions, this.#ctx.approvalQueue,
        { type: "draftForward", conversationId: this.#conversationId, to, body: body ?? "" },
        {
          title: sanitizeApprovalTitle(`Draft forward: ${subject}`),
          description: "Create a draft forward in the Drafts folder. It is not sent automatically.\n\n" +
              formatApprovalField("Subject", subject) + "\n\n" + formatApprovalField("To", to.join(", ")) +
              (body ? "\n\n" + formatApprovalField("Note", body) : ""),
        });
  }
}

class MailThreadCursor extends RpcTarget implements Cursor<MailThreadSummary> {
  #ctx: OutlookMailSessionContext;
  #unreadOnly: boolean | undefined;
  #query: string | undefined;
  #nextLink: string | undefined;
  #done = false;
  #seen = new Set<string>();
  #started = false;

  constructor(ctx: OutlookMailSessionContext, options: { unreadOnly?: boolean; query?: string }) {
    super();
    this.#ctx = ctx;
    this.#unreadOnly = options.unreadOnly;
    this.#query = options.query;
  }

  async next(): Promise<MailThreadSummary[] | null> {
    if (this.#done && this.#started) return null;
    this.#started = true;
    let page = await this.#ctx.mailApi.listMessagesPage({
      folderId: this.#ctx.folderId, unreadOnly: this.#unreadOnly, query: this.#query,
      top: 50, nextLink: this.#nextLink,
    });
    this.#nextLink = page.nextLink;
    if (!this.#nextLink) this.#done = true;

    let summaries: MailThreadSummary[] = [];
    for (let m of page.messages) {
      if (this.#seen.has(m.conversationId)) continue;
      this.#seen.add(m.conversationId);
      summaries.push(graphMessageToSummary(m));
    }

    if (summaries.length > 0) {
      await this.#ctx.approvalQueue.authorizeObservation({
        title: `Read ${summaries.length} Outlook conversation(s)`,
        description: "Fetch the next page of conversation summaries from the mailbox.\n\n" +
            formatApprovalField("Subjects", summaries.map(s => s.subject).join("\n")),
      });
    }
    return summaries;
  }
}

class OutlookMailSessionImpl extends RpcTarget implements OutlookMailSession {
  #ctx: OutlookMailSessionContext;
  #ownerAddress: Promise<string> | undefined;

  constructor(ctx: OutlookMailSessionContext) {
    super();
    this.#ctx = ctx;
  }

  [Symbol.dispose]() {
    this.#ctx.approvalQueue[Symbol.dispose]();
  }

  async address(): Promise<string> {
    if (!this.#ownerAddress) {
      this.#ownerAddress = (async () => {
        let address = await this.#ctx.mailApi.getOwnerAddress();
        await this.#ctx.approvalQueue.authorizeObservation({
          title: "Read mailbox owner address",
          description: "Read the signed-in mailbox owner's email address.",
        });
        return address;
      })();
    }
    return this.#ownerAddress;
  }

  async list(options?: { folder?: string; unreadOnly?: boolean; query?: string })
      : Promise<Cursor<MailThreadSummary>> {
    let folderId = this.#ctx.folderId
        ?? (options?.folder ? await this.#ctx.mailApi.resolveFolderId(options.folder) : undefined);
    let cursorCtx: OutlookMailSessionContext = { ...this.#ctx, folderId };
    await this.#ctx.approvalQueue.authorizeObservation({
      title: "List Outlook conversations",
      description: "Create a cursor for conversations in the mailbox" +
          (options?.folder ? ` (folder: ${options.folder})` : "") +
          (options?.query ? `\n\n${formatApprovalField("Search", options.query)}` : ""),
    });
    return new RpcStub(new MailThreadCursor(cursorCtx, {
      unreadOnly: options?.unreadOnly, query: options?.query,
    })) as unknown as Cursor<MailThreadSummary>;
  }

  async getThread(id: string): Promise<MailThread> {
    let messages = await this.#ctx.mailApi.getMessagesByConversation(id);
    if (this.#ctx.folderId && !messages.some(m => m.parentFolderId === this.#ctx.folderId)) {
      throw new Error(`Conversation not found in this mailbox binding's scope: ${id}`);
    }
    let latest = messages[messages.length - 1];
    await this.#ctx.approvalQueue.authorizeObservation({
      title: sanitizeApprovalTitle(`Open conversation: ${latest?.subject || "(no subject)"}`),
      description: `Read ${messages.length} message(s) in this conversation, including bodies.`,
    });
    return new RpcStub(new MailThreadImpl(this.#ctx, id, messages)) as unknown as MailThread;
  }

  async listFolders(): Promise<string[]> {
    let folders = await this.#ctx.mailApi.listFolders();
    await this.#ctx.approvalQueue.authorizeObservation({
      title: "List mail folders",
      description: "List the folder names in this mailbox.",
    });
    return folders;
  }

  async createDraft(message: DraftMail): Promise<void> {
    await submitAction(this.#ctx.pendingActions, this.#ctx.approvalQueue,
        { type: "createDraft", to: message.to, cc: message.cc ?? [], subject: message.subject, body: message.body },
        {
          title: sanitizeApprovalTitle(`Draft: ${message.subject}`),
          description: "Create a new draft in the Drafts folder. It is not sent automatically.\n\n" +
              formatApprovalField("To", message.to.join(", ")) + "\n\n" +
              formatApprovalField("Subject", message.subject) + "\n\n" +
              formatApprovalField("Body", message.body),
        });
  }
}

export class OutlookMailGatekeeperImpl extends DurableObject<Env, OutlookMailGatekeeperImplProps>
    implements Gatekeeper<OutlookMailSession> {
  #tokens = new AccessTokenCache(opts => {
    let stub = this.ctx.exports.UserAccount.get(
        this.ctx.exports.UserAccount.idFromString(this.ctx.props.userObjectId));
    return stub.getAccessToken(opts);
  });

  #mailApi(): MailApi {
    return new MailApi(opts => this.#tokens.get(opts));
  }

  async describe(): Promise<ResourceDescription> {
    let folder = this.ctx.props.folder;
    if (folder) {
      return {
        url: `https://outlook.office.com/mail/#folder/${encodeURIComponent(folder)}`,
        title: `Outlook folder: ${folder}`,
        snippet: `Outlook mail folder: ${folder}`,
        suggestedBindingName: "MAIL_FOLDER",
        tsType: "OutlookMailSession",
      };
    }
    return {
      url: "https://outlook.office.com/mail/",
      title: "Outlook Mailbox",
      snippet: "Your personal Outlook mailbox",
      suggestedBindingName: "MAIL_INBOX",
      tsType: "OutlookMailSession",
    };
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }

  async getAutoApprovableActions() {
    return [];
  }

  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<OutlookMailSession> {
    let mailApi = this.#mailApi();
    let folderId = this.ctx.props.folder ? await mailApi.resolveFolderId(this.ctx.props.folder) : undefined;
    let ctx: OutlookMailSessionContext = {
      mailApi, folderId, approvalQueue: approvalQueue.dup(),
      pendingActions: new PendingActionStore<OutlookMailAction>(this.ctx.storage.kv),
    };
    return new OutlookMailSessionImpl(ctx);
  }

  async applyAction(actionId: number): Promise<void> {
    let pendingActions = new PendingActionStore<OutlookMailAction>(this.ctx.storage.kv);
    let action = pendingActions.get(actionId);
    if (!action) throw new Error(`Unknown pending Outlook Mail action: ${actionId}`);

    let mailApi = this.#mailApi();
    switch (action.type) {
      case "archive":
        await mailApi.moveConversation(action.conversationId, "archive");
        break;
      case "delete":
        await mailApi.deleteConversation(action.conversationId);
        break;
      case "markRead":
        await mailApi.setConversationRead(action.conversationId, true);
        break;
      case "markUnread":
        await mailApi.setConversationRead(action.conversationId, false);
        break;
      case "moveTo":
        await mailApi.moveConversation(action.conversationId, action.folder);
        break;
      case "createDraft":
        await mailApi.createDraft({
          to: action.to, cc: action.cc, subject: action.subject, bodyHtml: markdownToHtml(action.body),
        });
        break;
      case "draftReply": {
        // Refetch at apply time rather than trusting a message id captured at submit time: the
        // conversation's most recent message may have changed while the action awaited approval.
        let messages = await mailApi.getMessagesByConversation(action.conversationId);
        let mostRecent = messages[messages.length - 1];
        if (!mostRecent) throw new Error("Conversation no longer has any messages.");
        await mailApi.draftReply(mostRecent.id, markdownToHtml(action.body), action.replyAll);
        break;
      }
      case "draftForward": {
        let messages = await mailApi.getMessagesByConversation(action.conversationId);
        let mostRecent = messages[messages.length - 1];
        if (!mostRecent) throw new Error("Conversation no longer has any messages.");
        await mailApi.draftForward(mostRecent.id, action.to, markdownToHtml(action.body));
        break;
      }
      default:
        action satisfies never;
        throw new Error(`unknown action type: ${(action as { type: string }).type}`);
    }

    pendingActions.remove(actionId);
  }

  async rejectAction(actionId: number): Promise<void | { restart?: boolean }> {
    let pendingActions = new PendingActionStore<OutlookMailAction>(this.ctx.storage.kv);
    if (!pendingActions.get(actionId)) {
      throw new Error(`Unknown pending Outlook Mail action: ${actionId}`);
    }
    pendingActions.remove(actionId);
  }

  revertAction(_action: number):
      Promise<void | { message?: string; canRetry?: boolean; restart?: boolean }> {
    return Promise.reject(new Error("Revert is not implemented."));
  }

  /**
   * Strategy A (private-only), same reasoning as gatekeeper-google's Gmail: a personal mailbox
   * has no per-recipient ACL to verify an observer against.
   */
  async addObserver(_id: string, _user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    throw new Error(
        "Outlook mail cannot be shared with other users: this workspace reads a personal " +
        "mailbox, which may only be observed by its owner.");
  }

  async removeObserver(_id: string): Promise<void> {}
}

// ===========================================================================================
// Outlook Calendar
// ===========================================================================================

type OutlookCalendarGatekeeperImplProps = {
  userObjectId: string;
  calendarId: string;
};

function graphEventToCalendarEvent(e: GraphEvent): CalendarEvent {
  let organizerAddress = e.organizer?.emailAddress;
  return {
    id: e.id,
    subject: e.subject ?? "",
    body: e.body ? (e.body.contentType === "html" ? htmlToPlainText(e.body.content) : e.body.content) : "",
    start: new Date(e.start.dateTime + "Z"),
    end: new Date(e.end.dateTime + "Z"),
    allDay: e.isAllDay,
    location: e.location?.displayName ?? "",
    organizer: organizerAddress
        ? { name: organizerAddress.name, address: organizerAddress.address, response: "accepted", optional: false }
        : { address: "", response: "none", optional: false },
    attendees: (e.attendees ?? []).map(a => ({
      name: a.emailAddress.name,
      address: a.emailAddress.address,
      response: graphAttendeeResponse(a.status?.response),
      optional: a.type === "optional",
    })),
    recurring: e.type !== "singleInstance",
    showAs: e.showAs === "workingElsewhere" || e.showAs === "unknown" ? "busy" : e.showAs,
  };
}

type OutlookCalendarAction =
  | { type: "createEvent"; event: NewCalendarEvent }
  | { type: "updateEvent"; id: string; changes: CalendarEventUpdate }
  | { type: "deleteEvent"; id: string }
  | { type: "respondToEvent"; id: string; response: "accept" | "decline" | "tentative" };

type OutlookCalendarSessionContext = {
  calendarApi: CalendarApi;
  approvalQueue: RpcStub<ApprovalQueue>;
  pendingActions: PendingActionStore<OutlookCalendarAction>;
  calendarId: string;
};

class CalendarEventCursor extends RpcTarget implements Cursor<CalendarEvent> {
  #ctx: OutlookCalendarSessionContext;
  #events: GraphEvent[];
  #delivered = false;

  constructor(ctx: OutlookCalendarSessionContext, events: GraphEvent[]) {
    super();
    this.#ctx = ctx;
    this.#events = events;
  }

  // TODO(Phase 1 follow-up): Graph's calendarView paginates past ~250 events via
  // @odata.nextLink too; this cursor currently only surfaces the first page. Fine for the
  // common "next few weeks" query this API is designed for; revisit if a caller needs a very
  // wide date range with many events.
  async next(): Promise<CalendarEvent[] | null> {
    if (this.#delivered) return null;
    this.#delivered = true;
    let events = this.#events.map(graphEventToCalendarEvent);
    if (events.length > 0) {
      await this.#ctx.approvalQueue.authorizeObservation({
        title: `Read ${events.length} calendar event(s)`,
        description: "Fetch events overlapping the requested date range.\n\n" +
            formatApprovalField("Subjects", events.map(e => e.subject).join("\n")),
      });
    }
    return events;
  }
}

class OutlookCalendarSessionImpl extends RpcTarget implements OutlookCalendarSession {
  #ctx: OutlookCalendarSessionContext;

  constructor(ctx: OutlookCalendarSessionContext) {
    super();
    this.#ctx = ctx;
  }

  [Symbol.dispose]() {
    this.#ctx.approvalQueue[Symbol.dispose]();
  }

  async name(): Promise<string> {
    let name = await this.#ctx.calendarApi.getCalendarName(this.#ctx.calendarId);
    await this.#ctx.approvalQueue.authorizeObservation({
      title: "Read calendar name", description: "Read this calendar's display name.",
    });
    return name;
  }

  async address(): Promise<string> {
    let address = await this.#ctx.calendarApi.getOwnerAddress();
    await this.#ctx.approvalQueue.authorizeObservation({
      title: "Read calendar owner address", description: "Read the signed-in calendar owner's email address.",
    });
    return address;
  }

  async list(from: Date, to: Date): Promise<Cursor<CalendarEvent>> {
    let events = await this.#ctx.calendarApi.listEvents(this.#ctx.calendarId, from, to);
    return new RpcStub(new CalendarEventCursor(this.#ctx, events)) as unknown as Cursor<CalendarEvent>;
  }

  async getEvent(id: string): Promise<CalendarEvent> {
    let event = await this.#ctx.calendarApi.getEvent(this.#ctx.calendarId, id);
    await this.#ctx.approvalQueue.authorizeObservation({
      title: sanitizeApprovalTitle(`Read event: ${event.subject || "(no subject)"}`),
      description: `Read details for calendar event ${id}.`,
    });
    return graphEventToCalendarEvent(event);
  }

  async findFreeTime(from: Date, to: Date, minimumMinutes: number): Promise<FreeSlot[]> {
    let events = await this.#ctx.calendarApi.listEvents(this.#ctx.calendarId, from, to);
    let busy = events
        .filter(e => e.showAs !== "free")
        .map(e => ({ start: new Date(e.start.dateTime + "Z"), end: new Date(e.end.dateTime + "Z") }))
        .sort((a, b) => a.start.valueOf() - b.start.valueOf());

    let slots: FreeSlot[] = [];
    let cursor = from;
    let minimumMs = minimumMinutes * 60 * 1000;
    for (let event of busy) {
      if (event.start.valueOf() - cursor.valueOf() >= minimumMs) {
        slots.push({ start: cursor, end: event.start });
      }
      if (event.end.valueOf() > cursor.valueOf()) cursor = event.end;
    }
    if (to.valueOf() - cursor.valueOf() >= minimumMs) {
      slots.push({ start: cursor, end: to });
    }

    await this.#ctx.approvalQueue.authorizeObservation({
      title: `Find free time (${slots.length} slot(s))`,
      description: `Scan busy events between ${from.toISOString()} and ${to.toISOString()} for gaps ` +
          `of at least ${minimumMinutes} minutes.`,
    });
    return slots;
  }

  async createEvent(event: NewCalendarEvent): Promise<void> {
    await submitAction(this.#ctx.pendingActions, this.#ctx.approvalQueue,
        { type: "createEvent", event },
        {
          title: sanitizeApprovalTitle(`Create event: ${event.subject}`),
          description: "Create a new calendar event" +
              ((event.attendees?.length ?? 0) > 0 ? ", sending invitations to its attendees" : "") +
              ".\n\n" + formatApprovalField("Subject", event.subject) + "\n\n" +
              formatApprovalField("When", `${event.start.toISOString()} \u2013 ${event.end.toISOString()}`) +
              (event.attendees?.length ? `\n\n${formatApprovalField("Attendees", event.attendees.join(", "))}` : ""),
        });
  }

  async updateEvent(id: string, changes: CalendarEventUpdate): Promise<void> {
    await submitAction(this.#ctx.pendingActions, this.#ctx.approvalQueue,
        { type: "updateEvent", id, changes },
        {
          title: sanitizeApprovalTitle(`Update event: ${changes.subject ?? id}`),
          description: `Update calendar event ${id}. Attendees are notified of time or subject changes.\n\n` +
              formatApprovalField("Changes", JSON.stringify(changes, null, 2)),
        });
  }

  async deleteEvent(id: string): Promise<void> {
    await submitAction(this.#ctx.pendingActions, this.#ctx.approvalQueue,
        { type: "deleteEvent", id },
        {
          title: sanitizeApprovalTitle(`Cancel event ${id}`),
          description: `Cancel calendar event ${id}. Attendees are notified.`,
        });
  }

  async respondToEvent(id: string, response: "accept" | "decline" | "tentative"): Promise<void> {
    await submitAction(this.#ctx.pendingActions, this.#ctx.approvalQueue,
        { type: "respondToEvent", id, response },
        {
          title: sanitizeApprovalTitle(`Respond ${response} to event ${id}`),
          description: `Respond "${response}" to the invitation for calendar event ${id}.`,
        });
  }
}

export class OutlookCalendarGatekeeperImpl
    extends DurableObject<Env, OutlookCalendarGatekeeperImplProps>
    implements Gatekeeper<OutlookCalendarSession> {
  #tokens = new AccessTokenCache(opts => {
    let stub = this.ctx.exports.UserAccount.get(
        this.ctx.exports.UserAccount.idFromString(this.ctx.props.userObjectId));
    return stub.getAccessToken(opts);
  });

  #calendarApi(): CalendarApi {
    return new CalendarApi(opts => this.#tokens.get(opts));
  }

  async describe(): Promise<ResourceDescription> {
    let calendarApi = this.#calendarApi();
    let name = await calendarApi.getCalendarName(this.ctx.props.calendarId);
    return {
      url: `https://outlook.office.com/calendar/${encodeURIComponent(this.ctx.props.calendarId)}/`,
      title: `Outlook Calendar: ${name}`,
      snippet: `Outlook calendar: ${name}`,
      suggestedBindingName: "OUTLOOK_CALENDAR",
      tsType: "OutlookCalendarSession",
    };
  }

  async getTypeScriptTypes(): Promise<string> {
    return TYPES_CODE;
  }

  async getAutoApprovableActions() {
    return [];
  }

  async startSession(approvalQueue: RpcStub<ApprovalQueue>): Promise<OutlookCalendarSession> {
    let ctx: OutlookCalendarSessionContext = {
      calendarApi: this.#calendarApi(), calendarId: this.ctx.props.calendarId,
      approvalQueue: approvalQueue.dup(),
      pendingActions: new PendingActionStore<OutlookCalendarAction>(this.ctx.storage.kv),
    };
    return new OutlookCalendarSessionImpl(ctx);
  }

  async applyAction(actionId: number): Promise<void> {
    let pendingActions = new PendingActionStore<OutlookCalendarAction>(this.ctx.storage.kv);
    let action = pendingActions.get(actionId);
    if (!action) throw new Error(`Unknown pending Outlook Calendar action: ${actionId}`);

    let calendarApi = this.#calendarApi();
    switch (action.type) {
      case "createEvent":
        await calendarApi.createEvent(this.ctx.props.calendarId, {
          subject: action.event.subject, start: action.event.start, end: action.event.end,
          bodyHtml: action.event.body ? markdownToHtml(action.event.body) : undefined,
          location: action.event.location, attendees: action.event.attendees, allDay: action.event.allDay,
        });
        break;
      case "updateEvent":
        await calendarApi.updateEvent(this.ctx.props.calendarId, action.id, {
          subject: action.changes.subject, start: action.changes.start, end: action.changes.end,
          bodyHtml: action.changes.body !== undefined ? markdownToHtml(action.changes.body) : undefined,
          location: action.changes.location,
        });
        break;
      case "deleteEvent":
        await calendarApi.deleteEvent(this.ctx.props.calendarId, action.id);
        break;
      case "respondToEvent":
        await calendarApi.respondToEvent(
            this.ctx.props.calendarId, action.id,
            action.response === "tentative" ? "tentativelyAccept" : action.response);
        break;
      default:
        action satisfies never;
        throw new Error(`unknown action type: ${(action as { type: string }).type}`);
    }

    pendingActions.remove(actionId);
  }

  async rejectAction(actionId: number): Promise<void | { restart?: boolean }> {
    let pendingActions = new PendingActionStore<OutlookCalendarAction>(this.ctx.storage.kv);
    if (!pendingActions.get(actionId)) {
      throw new Error(`Unknown pending Outlook Calendar action: ${actionId}`);
    }
    pendingActions.remove(actionId);
  }

  revertAction(_action: number):
      Promise<void | { message?: string; canRetry?: boolean; restart?: boolean }> {
    return Promise.reject(new Error("Revert is not implemented."));
  }

  /**
   * Strategy A (private-only) for v1 -- see plans/gatekeeper-microsoft.md. Event bodies and
   * attendee lists can carry information from people who never shared anything with a
   * prospective observer, and there's no clean per-observer oracle for "can this person see this
   * specific event." Revisit as strategy B if a concrete sharing need emerges.
   */
  async addObserver(_id: string, _user: Fetcher<GatekeeperUserVerifier>): Promise<void> {
    throw new Error(
        "This Outlook calendar cannot be shared with other users in this configuration.");
  }

  async removeObserver(_id: string): Promise<void> {}
}
