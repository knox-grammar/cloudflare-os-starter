// Helpers talking to the Microsoft identity platform (OAuth) and Microsoft Graph.

import { AccountDescription } from "@gadgets/workshop-shared/gatekeeper";
import { fetchWithAuthRetry, type AccessTokenProvider } from "./auth-retry";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export type MicrosoftAccessToken = {
  token: string;
  expires: Date;
};

export type MicrosoftOAuthGrant = {
  refreshToken: string;
  accessToken: MicrosoftAccessToken;
  grantedScopes: string[];
};

function tokenEndpoint(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
}

export function authorizeEndpoint(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
}

async function readErrorText(response: Response, maxBytes = 4096): Promise<string> {
  let text = await response.text();
  return text.length > maxBytes ? text.slice(0, maxBytes) + "…" : text;
}

/** `signal` lets the caller bound the round trip; UserAccount holds the credential mutex across this. */
export async function exchangeAuthCode(
    tenantId: string, code: string, clientId: string, clientSecret: string, redirectUri: string,
    signal?: AbortSignal): Promise<MicrosoftOAuthGrant> {
  let params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("code", code);
  params.set("redirect_uri", redirectUri);
  params.set("grant_type", "authorization_code");

  let response = await fetch(tokenEndpoint(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    ...(signal ? { signal } : {}),
  });

  let body = await response.json<any>();
  if (!response.ok) {
    throw new Error(`Failed to obtain refresh token: ${body.error} ${body.error_description}`);
  }
  if (!body.refresh_token) {
    throw new Error(
        "Token endpoint didn't return a refresh token. Ensure offline_access was requested.");
  }

  return {
    accessToken: {
      token: body.access_token,
      expires: new Date(Date.now() + body.expires_in * 1000),
    },
    refreshToken: body.refresh_token,
    grantedScopes: typeof body.scope === "string" ? body.scope.split(" ").filter(Boolean) : [],
  };
}

export type RefreshFailure =
  | { ok: false; reason: "revoked" }
  | { ok: false; reason: "policyBlocked"; detail: string };

export type AccessTokenResult = { ok: true; token: MicrosoftAccessToken } | RefreshFailure;

/** Exchange a refresh token for an access token. `signal` lets the caller bound the round trip. */
export async function refreshAccessToken(
    tenantId: string, refreshToken: string, clientId: string, clientSecret: string,
    signal?: AbortSignal): Promise<AccessTokenResult> {
  let params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("refresh_token", refreshToken);
  params.set("grant_type", "refresh_token");

  let response = await fetch(tokenEndpoint(tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    let body = await response.json<{error?: string, error_description?: string}>();
    if (body.error === "invalid_grant") {
      return { ok: false, reason: "revoked" };
    }
    if (body.error === "unauthorized_client" || body.error === "invalid_client") {
      return {
        ok: false, reason: "policyBlocked",
        detail: body.error_description ?? body.error ?? "unauthorized_client",
      };
    }
    throw new Error(`Failed to refresh access token: ${body.error} ${body.error_description}`);
  }

  let data = await response.json<{access_token: string, expires_in: number}>();
  return {
    ok: true,
    token: { token: data.access_token, expires: new Date(Date.now() + data.expires_in * 1000) },
  };
}

/**
 * Microsoft's identity platform has no equivalent of Google's `/revoke` endpoint a client can call
 * to invalidate a refresh token: a work/school account's grant can only be revoked by a tenant
 * admin (Microsoft Graph `revokeSignInSessions`, which needs application-level admin permissions
 * we deliberately don't hold). "Revoking" a connection here can only drop our own copy of the
 * refresh token; the underlying consent in Microsoft Entra ID remains until the user or an admin
 * removes it there. Document this in the UI copy so it isn't mistaken for a full revoke.
 */
export const REVOKE_IS_LOCAL_ONLY = true;

/**
 * Generic Microsoft avatar, used because per-user photos require a separate authenticated fetch
 * (`GET /me/photo/$value`, binary) this Phase-1 pass doesn't implement. Follow-up work: fetch and
 * cache the real photo, or omit avatar display entirely rather than showing a placeholder for
 * everyone.
 */
const GENERIC_AVATAR_URL = "https://graph.microsoft.com/v1.0/me/photo/$value";

export async function getMicrosoftAccountDescription(accessToken: string)
    : Promise<AccountDescription> {
  let response = await fetch(
      `${GRAPH_BASE}/me?$select=displayName,mail,userPrincipalName`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (!response.ok) {
    response.body?.cancel();
    throw new Error(`Failed to fetch account info: ${response.status} ${response.statusText}`);
  }
  let data: any = await response.json();
  return {
    displayName: data.displayName ?? data.mail ?? data.userPrincipalName,
    uniqueName: data.mail ?? data.userPrincipalName,
    avatar: { url: GENERIC_AVATAR_URL },
  };
}

/**
 * The account's email for use as a sign-in identity.
 *
 * Unlike Google's `email_verified` claim, Graph's `/me` doesn't carry an explicit verification
 * flag. This gatekeeper's tenant is pinned to a single, IT-managed Microsoft Entra tenant (see
 * `TENANT_ID` in wrangler.jsonc), so every account able to complete the OAuth flow at all is
 * already a tenant-managed identity -- there is no "arbitrary unverified Microsoft account" case
 * to guard against the way a multi-tenant (`common`) app would need to.
 */
export async function getMicrosoftVerifiedEmail(accessToken: string): Promise<string | null> {
  let response = await fetch(
      `${GRAPH_BASE}/me?$select=mail,userPrincipalName`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  if (!response.ok) {
    response.body?.cancel();
    throw new Error(`Failed to fetch account info: ${response.status} ${response.statusText}`);
  }
  let data: any = await response.json();
  return data.mail ?? data.userPrincipalName ?? null;
}

// =======================================================================================
// Mail
// =======================================================================================

export type GraphEmailAddress = { name?: string; address: string };

export type GraphMessage = {
  id: string;
  conversationId: string;
  /** Which mail folder this message currently lives in -- used to enforce folder-scoped bindings. */
  parentFolderId?: string;
  subject: string;
  from?: { emailAddress: GraphEmailAddress };
  toRecipients?: { emailAddress: GraphEmailAddress }[];
  ccRecipients?: { emailAddress: GraphEmailAddress }[];
  receivedDateTime: string;
  bodyPreview?: string;
  body?: { contentType: "text" | "html"; content: string };
  isRead: boolean;
  hasAttachments: boolean;
};

export type GraphAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  contentBytes?: string;
};

const WELL_KNOWN_FOLDERS = new Set([
  "inbox", "archive", "drafts", "sentitems", "deleteditems", "junkemail",
]);

function toEmailAddress(a: GraphEmailAddress | undefined): { name?: string; address: string } {
  return a ? { name: a.name, address: a.address } : { address: "" };
}

/**
 * Very light HTML→plain-text conversion for message bodies. Strips tags and decodes the common
 * entities Outlook actually emits; it does not attempt to preserve structure (lists, links,
 * emphasis) the way `gatekeeper-google`'s dedicated Markdown converter does for Google Docs.
 *
 * Follow-up work: a real HTML→Markdown pass (preserve links, lists, emphasis) once the core flow
 * is proven -- flagged in the plan doc.
 */
/**
 * Very light Markdown→HTML conversion for outbound drafts. Handles paragraphs, line breaks, and
 * basic emphasis; does not attempt full CommonMark (lists, links, headings). Escapes HTML first so
 * user-authored Markdown can't inject markup into the draft. Follow-up work, same as
 * `htmlToPlainText`: a real converter once the core flow is proven.
 */
export function markdownToHtml(markdown: string): string {
  let escaped = markdown
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  let withEmphasis = escaped
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/\*([^*]+)\*/g, "<i>$1</i>");
  return withEmphasis
      .split(/\n{2,}/)
      .map(paragraph => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
      .join("");
}

export function htmlToPlainText(html: string): string {
  return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/(div|tr|li)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
}

export class MailApi {
  #getToken: AccessTokenProvider;

  constructor(getToken: AccessTokenProvider) {
    this.#getToken = getToken;
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
    let response = await fetchWithAuthRetry(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    }, this.#getToken);
    if (!response.ok) {
      let text = await readErrorText(response);
      throw new Error(`Graph API ${init.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json<T>();
  }

  /** Resolve a well-known or custom folder name to a Graph folder id. */
  async resolveFolderId(folder: string): Promise<string> {
    let normalized = folder.toLowerCase();
    if (WELL_KNOWN_FOLDERS.has(normalized)) {
      let result = await this.#request<{ id: string }>(`/me/mailFolders/${normalized}?$select=id`);
      return result.id;
    }
    let escaped = folder.replace(/'/g, "''");
    let result = await this.#request<{ value: { id: string }[] }>(
        `/me/mailFolders?$filter=${encodeURIComponent(`displayName eq '${escaped}'`)}&$select=id`);
    let match = result.value[0];
    if (!match) throw new Error(`Mail folder not found: ${folder}`);
    return match.id;
  }

  async listFolders(): Promise<string[]> {
    let result = await this.#request<{ value: { displayName: string }[] }>(
        "/me/mailFolders?$top=250&$select=displayName");
    return result.value.map(f => f.displayName);
  }

  /**
   * One page of messages, most recently received first.
   *
   * Groups by `conversationId` within the fetched page to approximate conversations, since Graph
   * has no first-class "list conversations" endpoint for a personal mailbox the way it does for
   * O365 Group conversations. A conversation whose most recent message falls outside this page
   * will not appear here even if older messages from it are on this page -- exactly the caching
   * gap the write-gatekeeper skill calls out for Gmail's thread-list API. Flagged in the plan doc
   * as Phase 2 caching work (a DO-side conversation index keyed by conversationId).
   */
  async listMessagesPage(options: {
    folderId?: string;
    unreadOnly?: boolean;
    query?: string;
    top?: number;
    nextLink?: string;
  }): Promise<{ messages: GraphMessage[]; nextLink?: string }> {
    if (options.nextLink) {
      let result = await this.#request<{ value: GraphMessage[]; "@odata.nextLink"?: string }>(
          options.nextLink);
      return { messages: result.value, nextLink: result["@odata.nextLink"] };
    }

    let base = options.folderId ? `/me/mailFolders/${options.folderId}/messages` : "/me/messages";
    let params = new URLSearchParams();
    params.set("$top", String(options.top ?? 50));
    params.set(
        "$select",
        "id,conversationId,parentFolderId,subject,from,toRecipients,ccRecipients,receivedDateTime," +
        "bodyPreview,isRead,hasAttachments");

    let headers: Record<string, string> = {};
    if (options.query?.trim()) {
      // $search can't combine with $orderby/$filter; results are relevance-ordered.
      params.set("$search", `"${options.query.replace(/"/g, "'")}"`);
      headers["ConsistencyLevel"] = "eventual";
    } else {
      params.set("$orderby", "receivedDateTime desc");
      if (options.unreadOnly) params.set("$filter", "isRead eq false");
    }

    let result = await this.#request<{ value: GraphMessage[]; "@odata.nextLink"?: string }>(
        `${base}?${params.toString()}`, { headers });
    return { messages: result.value, nextLink: result["@odata.nextLink"] };
  }

  async getMessagesByConversation(conversationId: string): Promise<GraphMessage[]> {
    let escaped = conversationId.replace(/'/g, "''");
    let result = await this.#request<{ value: GraphMessage[] }>(
        "/me/messages?" + new URLSearchParams({
          "$filter": `conversationId eq '${escaped}'`,
          "$orderby": "receivedDateTime asc",
          "$select":
              "id,conversationId,parentFolderId,subject,from,toRecipients,ccRecipients," +
              "receivedDateTime,body,isRead,hasAttachments",
        }).toString());
    if (result.value.length === 0) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    return result.value;
  }

  async listAttachments(messageId: string): Promise<GraphAttachment[]> {
    let result = await this.#request<{ value: GraphAttachment[] }>(
        `/me/messages/${messageId}/attachments?$select=id,name,contentType,size`);
    return result.value;
  }

  async getAttachmentBytes(messageId: string, attachmentId: string): Promise<ArrayBuffer> {
    let attachment = await this.#request<GraphAttachment>(
        `/me/messages/${messageId}/attachments/${attachmentId}?$select=contentBytes`);
    if (!attachment.contentBytes) {
      throw new Error("Attachment has no inline content (may be a reference attachment).");
    }
    let binary = atob(attachment.contentBytes);
    let bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  /** Move every message in a conversation to `folderId` (or a well-known folder name). */
  async moveConversation(conversationId: string, destination: string): Promise<void> {
    let destinationId = WELL_KNOWN_FOLDERS.has(destination.toLowerCase())
        ? destination.toLowerCase() : await this.resolveFolderId(destination);
    let messages = await this.getMessagesByConversation(conversationId);
    await Promise.all(messages.map(m =>
        this.#request(`/me/messages/${m.id}/move`, {
          method: "POST", body: JSON.stringify({ destinationId }),
        })));
  }

  async setConversationRead(conversationId: string, isRead: boolean): Promise<void> {
    let messages = await this.getMessagesByConversation(conversationId);
    await Promise.all(messages.map(m =>
        this.#request(`/me/messages/${m.id}`, {
          method: "PATCH", body: JSON.stringify({ isRead }),
        })));
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.moveConversation(conversationId, "deleteditems");
  }

  /** Create a standalone draft. Never sends. */
  async createDraft(message: {
    to: string[]; cc?: string[]; subject: string; bodyHtml: string;
  }): Promise<void> {
    await this.#request("/me/messages", {
      method: "POST",
      body: JSON.stringify({
        subject: message.subject,
        body: { contentType: "HTML", content: message.bodyHtml },
        toRecipients: message.to.map(address => ({ emailAddress: { address } })),
        ccRecipients: (message.cc ?? []).map(address => ({ emailAddress: { address } })),
      }),
    });
  }

  /**
   * Draft a reply to the most recent message in a conversation, via Graph's `createReply`, which
   * builds the draft with the original quoted below `comment` and never sends it.
   */
  async draftReply(mostRecentMessageId: string, commentHtml: string, replyAll: boolean)
      : Promise<void> {
    let action = replyAll ? "createReplyAll" : "createReply";
    await this.#request(`/me/messages/${mostRecentMessageId}/${action}`, {
      method: "POST",
      body: JSON.stringify({ comment: commentHtml }),
    });
  }

  /** Draft a forward of the most recent message in a conversation. Never sends. */
  async draftForward(mostRecentMessageId: string, to: string[], commentHtml: string): Promise<void> {
    await this.#request(`/me/messages/${mostRecentMessageId}/createForward`, {
      method: "POST",
      body: JSON.stringify({
        comment: commentHtml,
        toRecipients: to.map(address => ({ emailAddress: { address } })),
      }),
    });
  }
}

// =======================================================================================
// Calendar
// =======================================================================================

export type GraphEvent = {
  id: string;
  subject: string;
  bodyPreview?: string;
  body?: { contentType: "text" | "html"; content: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay: boolean;
  location?: { displayName?: string };
  organizer?: { emailAddress: GraphEmailAddress };
  attendees?: {
    emailAddress: GraphEmailAddress;
    status?: { response: string };
    type?: "required" | "optional" | "resource";
  }[];
  type: "singleInstance" | "occurrence" | "exception" | "seriesMaster";
  showAs: "free" | "tentative" | "busy" | "oof" | "workingElsewhere" | "unknown";
};

export function graphAttendeeResponse(status?: string): "accepted" | "declined" | "tentative" | "none" {
  switch (status) {
    case "accepted": return "accepted";
    case "declined": return "declined";
    case "tentativelyAccepted": return "tentative";
    default: return "none";
  }
}

export class CalendarApi {
  #getToken: AccessTokenProvider;

  constructor(getToken: AccessTokenProvider) {
    this.#getToken = getToken;
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
    let response = await fetchWithAuthRetry(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    }, this.#getToken);
    if (!response.ok) {
      let text = await readErrorText(response);
      throw new Error(`Graph API ${init.method ?? "GET"} ${path} failed: ${response.status} ${text}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json<T>();
  }

  async getCalendarName(calendarId: string): Promise<string> {
    let result = await this.#request<{ name: string }>(`/me/calendars/${calendarId}?$select=name`);
    return result.name;
  }

  async getOwnerAddress(): Promise<string> {
    let result = await this.#request<{ mail?: string; userPrincipalName?: string }>(
        "/me?$select=mail,userPrincipalName");
    return result.mail ?? result.userPrincipalName ?? "";
  }

  /**
   * Events overlapping `[from, to)`, earliest first, with recurring events already expanded into
   * occurrences by Graph's `calendarView`.
   */
  async listEvents(calendarId: string, from: Date, to: Date): Promise<GraphEvent[]> {
    let params = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      "$orderby": "start/dateTime",
      "$top": "250",
      "$select":
          "id,subject,bodyPreview,start,end,isAllDay,location,organizer,attendees,type,showAs",
    });
    let result = await this.#request<{ value: GraphEvent[] }>(
        `/me/calendars/${calendarId}/calendarView?${params.toString()}`);
    return result.value;
  }

  async getEvent(calendarId: string, eventId: string): Promise<GraphEvent> {
    return this.#request<GraphEvent>(
        `/me/calendars/${calendarId}/events/${eventId}?` +
        "$select=id,subject,body,start,end,isAllDay,location,organizer,attendees,type,showAs");
  }

  async createEvent(calendarId: string, event: {
    subject: string; start: Date; end: Date; bodyHtml?: string; location?: string;
    attendees?: string[]; allDay?: boolean;
  }): Promise<void> {
    await this.#request(`/me/calendars/${calendarId}/events`, {
      method: "POST",
      body: JSON.stringify({
        subject: event.subject,
        body: event.bodyHtml ? { contentType: "HTML", content: event.bodyHtml } : undefined,
        start: { dateTime: event.start.toISOString(), timeZone: "UTC" },
        end: { dateTime: event.end.toISOString(), timeZone: "UTC" },
        isAllDay: event.allDay ?? false,
        location: event.location ? { displayName: event.location } : undefined,
        attendees: (event.attendees ?? []).map(address => (
            { emailAddress: { address }, type: "required" })),
      }),
    });
  }

  async updateEvent(calendarId: string, eventId: string, changes: {
    subject?: string; start?: Date; end?: Date; bodyHtml?: string; location?: string;
  }): Promise<void> {
    let body: Record<string, unknown> = {};
    if (changes.subject !== undefined) body.subject = changes.subject;
    if (changes.start !== undefined) body.start = { dateTime: changes.start.toISOString(), timeZone: "UTC" };
    if (changes.end !== undefined) body.end = { dateTime: changes.end.toISOString(), timeZone: "UTC" };
    if (changes.bodyHtml !== undefined) body.body = { contentType: "HTML", content: changes.bodyHtml };
    if (changes.location !== undefined) body.location = { displayName: changes.location };
    await this.#request(`/me/calendars/${calendarId}/events/${eventId}`, {
      method: "PATCH", body: JSON.stringify(body),
    });
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    await this.#request(`/me/calendars/${calendarId}/events/${eventId}`, { method: "DELETE" });
  }

  async respondToEvent(
      calendarId: string, eventId: string, response: "accept" | "decline" | "tentativelyAccept")
      : Promise<void> {
    await this.#request(`/me/calendars/${calendarId}/events/${eventId}/${response}`, {
      method: "POST", body: JSON.stringify({ sendResponse: true }),
    });
  }
}
