# Plan: Microsoft SharePoint and Work IQ Gatekeepers

Status: **Approved 2026-09-01. S0–S5 complete; S6 deployed 2026-09-02 and live authenticated verification is in progress.**

This plan delivers two related but deliberately separate Microsoft integrations:

1. Add production-oriented SharePoint support to the existing delegated-Microsoft-Graph Gatekeeper in `packages/gatekeeper-microsoft`.
2. Design a separate Microsoft Work IQ Gatekeeper now, but do not build or deploy it until SharePoint is complete and Work IQ's tenant prerequisites and preview behavior have been proven.

The direct Graph integration remains the production path. Work IQ is an optional preview path with a different token audience, protocol, permission model, operational dependency, and data-control plane. They must not share credentials or masquerade as interchangeable adapters.

Authoritative inputs:

- Existing Gatekeeper plan: [`plans/gatekeeper-microsoft.md`](gatekeeper-microsoft.md)
- Microsoft MCP research: [`docs/microsoft-mcp-options.md`](../docs/microsoft-mcp-options.md)
- Gatekeeper implementation process: [`cloudflare-os/.agents/skills/write-gatekeeper/SKILL.md`](../cloudflare-os/.agents/skills/write-gatekeeper/SKILL.md)
- Microsoft selected permissions: <https://learn.microsoft.com/en-us/graph/permissions-selected-overview>
- Work IQ overview: <https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview>
- SharePoint MCP tools: <https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-sharepoint-tools>
- Word MCP tools: <https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-word-tools>

## Goal

Give Knox agents useful, resource-confined access to approved SharePoint document libraries and documents through the existing Microsoft connection, while preserving:

- delegated user identity;
- tenant pinning;
- tenant-admin-controlled site boundaries;
- Cloudflare OS observation authorization and write approval;
- observer safety when Gadgets are shared;
- stable resource identity across renames and moves;
- a small agent-facing capability interface rather than raw Graph or MCP calls.

In parallel, settle the architecture and authority model for a future Work IQ Gatekeeper so its later implementation starts from an approved seam rather than growing inside the Graph Gatekeeper.

## Non-goals

### Direct Graph SharePoint v1

- App-only Graph tokens in the production Gatekeeper.
- Tenant-wide SharePoint search or unrestricted site discovery.
- `Sites.Read.All`, `Sites.ReadWrite.All`, `Sites.FullControl.All`, or broad `Files.*.All` authority.
- Managing the Gatekeeper application's own selected-resource assignments at runtime.
- OneDrive personal drives.
- Generic SharePoint lists, list schemas, list items, sharing grants, sensitivity labels, retention labels, or permission administration.
- Anonymous or organization-wide sharing links.
- Cross-site moves.
- Deleting files or folders in the first production slice.
- A generic Graph request interface.

### Work IQ initial build

- Production reliance on a preview Microsoft service.
- Reusing Graph access or refresh tokens.
- Exposing arbitrary `listTools()` or `callTool()` to Gadgets.
- Tenant-wide MCP bindings.
- Destructive SharePoint tools, sharing, sensitivity-label changes, list deletion, or column deletion.
- Treating Microsoft-hosted governance as a replacement for Cloudflare OS approvals and observations.

## Domain model and terminology

- **Microsoft Graph account** — one user's delegated connection to Microsoft Graph, stored by the existing `UserAccount` Durable Object.
- **Assigned site** — a SharePoint site collection for which a tenant administrator has granted this Entra application a selected role.
- **Site grant** — the tuple of application ID, immutable site ID, and selected role (`read` or `write`). It is provisioned outside the production Gatekeeper.
- **SharePoint document resource** — one file or folder identified internally by immutable `siteId`, `driveId`, and `itemId`; its human URL is display metadata, not identity.
- **SharePoint site resource** — one assigned site whose libraries may contain items with distinct effective ACLs.
- **Graph authority** — Microsoft Graph delegated scopes plus the selected site grant, intersected with the signed-in user's own SharePoint access.
- **Work IQ account** — a separate user connection holding MCP-server-audience credentials. It is not a Microsoft Graph account even when both represent the same person.
- **Work IQ scenario** — one locally defined, typed capability mapped to a dynamically discovered remote MCP tool whose schema has been validated.

No `CONTEXT.md` is added yet: these terms are local to this delivery plan and do not currently form a repository-wide domain glossary.

## Architectural decisions

### A1. Keep direct Graph and Work IQ as separate modules

The existing `packages/gatekeeper-microsoft` module owns Graph OAuth, Graph tokens, SharePoint selected permissions, and Graph resource sessions.

The future `packages/gatekeeper-work-iq` module will own MCP OAuth discovery/PKCE, Agent 365 token audiences, Streamable HTTP, tool discovery, schema gating, and Work IQ resource sessions.

There will be no common token interface and no pass-through request interface. Shared code is considered only after two real implementations reveal a stable, authority-neutral seam.

### A2. Use delegated `Sites.Selected` with out-of-band site assignment

The existing Entra application receives delegated `Sites.Selected` consent. A tenant-admin-controlled process separately assigns `read` or `write` on each approved site.

Effective runtime authority is:

```text
selected application site grant ∩ signed-in user's SharePoint permissions
```

The production Worker never receives `Sites.FullControl.All`, `owner`, or `fullcontrol` merely to provision itself.

### A3. Bind resources by immutable Graph IDs

Configurator input may begin with a SharePoint URL, but the Gatekeeper resolves and stores immutable IDs. Resource URLs exposed to Cloudflare OS are Gatekeeper-owned canonical URLs, not mutable SharePoint paths.

Proposed canonical forms:

```text
https://sharepoint.microsoft.com/site/:siteId
https://sharepoint.microsoft.com/site/:siteId/drive/:driveId/item/:itemId
```

These are capability identifiers, not browser destinations. The configurator displays the current `webUrl` and title.

### A4. Deliver document capability before broad site traversal

The first usable resource is one document or folder. It earns a strategy-B observer seam: the observer's own delegated token must successfully probe that exact item before observation is allowed.

A site-wide resource is a later slice using strategy C because documents may have broken inheritance or otherwise distinct effective ACLs. Every data-revealing site observation must identify the concrete item IDs revealed and pass through one shared observation tracker.

### A5. Make reads useful before adding writes

The first production slice is read-only: metadata, bounded library/folder navigation, search constrained to an assigned site, and bounded/streamed document content.

Writes follow only after read authority and observer verification are live-tested. Initial writes are create folder, create/upload file, replace with eTag, rename, and same-site move. Delete and sharing remain deferred.

### A6. Fail closed on remote ambiguity

Graph verifier behavior:

- `2xx` from an observer-owned exact-item/site probe: access verified.
- `401`, `403`, or `404`: access not verified; deny.
- throttling, timeout, malformed response, or server error: rethrow and fail the open rather than silently accepting or permanently classifying access.

Work IQ behavior:

- only locally allowlisted scenarios are visible;
- required tool/schema drift disables that scenario;
- unknown tools and remote descriptions never create authority;
- observer strategy remains A (private-only) until live Work IQ error behavior proves a reliable exact-document oracle.

## Proposed direct Graph interfaces

The exact `types.d.ts` change is the first implementation deliverable and requires a mandatory operator review before implementation continues.

The intended shape is:

```ts
export interface SharePointDocumentSession {
  metadata(): Promise<SharePointItemMetadata>;
  listChildren(options?: { cursor?: string; limit?: number }): Promise<SharePointItemPage>;
  search(query: string, options?: { cursor?: string; limit?: number }): Promise<SharePointItemPage>;
  read(options?: { offset?: number; length?: number }): Promise<ArrayBuffer>;
}

export interface SharePointSiteSession {
  metadata(): Promise<SharePointSiteMetadata>;
  libraries(): Promise<SharePointLibrary[]>;
  openItem(driveId: string, itemId: string): Promise<SharePointDocumentSession>;
  search(query: string, options?: { cursor?: string; limit?: number }): Promise<SharePointItemPage>;
}
```

Design constraints for operator review:

- `SharePointDocumentSession` may bind either one file or one folder; folder-only methods throw clearly for files.
- `SharePointSiteSession` never accepts arbitrary tenant/site IDs after binding.
- Pagination is represented by opaque Gatekeeper cursors/tokens; callers never construct Graph URLs or skip tokens.
- Returned metadata is normalized and structured, not raw Graph responses.
- File reads are metadata-first and size-limited. Preauthenticated download URLs never leave the Graph adapter or enter logs/storage.
- Native Office document-to-text conversion is not implied by `read()`. If required, it becomes an explicit later interface decision with its own size/privacy constraints.
- Agent-facing JSDoc describes capability behavior and errors only; it does not mention OAuth, Durable Objects, approvals, caching, or simulation.

Proposed write extension, reviewed separately after read-only verification:

```ts
export interface SharePointWritableFolderSession extends SharePointDocumentSession {
  createFolder(name: string): Promise<SharePointItemMetadata>;
  createFile(name: string, content: ArrayBuffer): Promise<SharePointItemMetadata>;
}

export interface SharePointWritableItemSession extends SharePointDocumentSession {
  replace(content: ArrayBuffer, expectedETag: string): Promise<SharePointItemMetadata>;
  rename(name: string, expectedETag: string): Promise<SharePointItemMetadata>;
  move(destinationFolderId: string, expectedETag: string): Promise<SharePointItemMetadata>;
}
```

The plan may instead use one interface with methods that reject under a read-only site grant. The interface review must choose one of these shapes; separate writable capabilities are preferred because authority is visible structurally.

## Permission and provisioning model

### Entra consent

Add delegated `Sites.Selected` to the existing single-tenant Graph application. Existing users may need incremental re-consent.

Do not request broad site/file scopes as a discovery shortcut.

### Site assignment

A tenant administrator provisions each approved site outside this Worker:

```http
POST /sites/{siteId}/permissions
{
  "roles": ["read"],
  "grantedToIdentities": [{
    "application": {
      "id": "{client-id}",
      "displayName": "Knox Microsoft Gatekeeper"
    }
  }]
}
```

Use only `read` or `write`. Record the site ID, role, owner, reason, approval, and revocation procedure in the operational inventory without recording credentials.

### Discovery

V1 accepts an operator/user-provided URL from an allowlisted assigned-site catalog. It does not search all tenant sites. The configurator resolves the URL with the connected user's delegated token and reports a clear distinction among:

- malformed URL;
- site not in the configured catalog;
- application has no selected assignment;
- signed-in user lacks access;
- transient Graph failure.

If a maintained site catalog is needed, add non-secret `sharePoint.assignedSites` configuration to `deployment.jsonc` only after deciding whether repository readers may see site names/URLs. Otherwise keep the catalog in a private operator-owned control plane and allow exact URL entry.

## SharePoint module seams

Inside `packages/gatekeeper-microsoft`:

- `microsoft-scopes.ts` remains the single mapping from resource patterns to incremental Graph scopes.
- Add `sharepoint-resources.ts` for canonical parsing/formatting and URL-to-ID normalization.
- Add `sharepoint-api.ts` as the internal Graph adapter for sites, drives, items, pagination, content redirects, uploads, eTags, delta, and structured Graph errors.
- `microsoft.ts` continues to own Vendor/User/Gatekeeper composition, but SharePoint session and observer-tracker implementations may move to `sharepoint.ts` if keeping them in `microsoft.ts` would reduce locality.
- `MicrosoftVerifier` gains exact site/item probe methods using the observer's own Graph account.
- Configurator iframe modules receive only narrow lookup/browse methods; they never receive access tokens, arbitrary Graph fetch, or write methods.

The Graph adapter is a deep internal module: callers provide bound IDs and typed intents; it hides Graph URLs, redirects, paging tokens, retry classification, and response normalization.

## Work IQ Gatekeeper design

### Package and deployment shape

Create a separate optional package only after the feasibility gate:

```text
packages/gatekeeper-work-iq/
  src/work-iq.ts
  src/work-iq-oauth.ts
  src/mcp-client.ts
  src/tool-catalog.ts
  src/types.d.ts
  src/types.txt -> types.d.ts
  src/configurator/
  wrangler.jsonc
  package.json
  tsconfig.json
```

Proposed deployment control:

```jsonc
"workers": {
  "gatekeeperWorkIq": { "name": "knox-os-gatekeeper-work-iq" }
},
"workIq": {
  "enabled": false,
  "tenantId": "<tenant-id>",
  "servers": ["sharepoint", "word"]
}
```

When disabled, no generated config, build, Worker deployment, Workshop binding, or Router binding is present. When enabled, it remains private and is reached through `/gatekeeper/work-iq` on the Access-protected Router.

### Internal interfaces

`McpClient` is an internal deep module. It owns:

- protected-resource and authorization-server metadata discovery;
- PKCE and the OAuth `resource` parameter;
- exact tenant/server-origin pinning;
- MCP initialization and protocol-version negotiation;
- Streamable HTTP JSON-RPC, optional SSE, session IDs, timeouts, and bounded responses;
- token audience enforcement and redirect safety;
- typed errors with secrets and remote content redacted.

`ToolCatalog` maps dynamically discovered tools into fixed local scenarios. It owns:

- tool-name and input-schema compatibility checks;
- local observation/action classification;
- allowed result-size/resource-ID extraction;
- fail-closed behavior on schema drift;
- rejection of unknown tools and remote policy text.

Neither module is exposed directly to Gadgets.

### Initial agent-facing capability

Start with a document-bound, read-only interface using an existing SharePoint/OneDrive sharing URL in the configurator:

```ts
export interface WorkIqDocumentSession {
  metadata(): Promise<WorkIqDocumentMetadata>;
  text(): Promise<string>;
  comments(): Promise<WorkIqComment[]>;
}
```

This is a local stable interface mapped to approved SharePoint/Word MCP scenarios. Tool names and schemas remain implementation details.

Later writes may add document creation and comment/reply operations through typed pending actions. Generic tool calls, delete, sharing, labels, and list/schema administration remain unavailable.

### Authentication separation

Work IQ uses a separate Entra application unless Microsoft publishes and the tenant approves a compelling reason to combine registrations. It uses MCP-server-specific permissions and tokens issued for the canonical MCP server URI.

Hard invariants:

- Graph tokens cannot be passed to `McpClient`.
- Work IQ tokens cannot be passed to Graph adapters.
- Graph and Work IQ account Durable Object IDs are not interchangeable.
- OAuth callbacks are scoped to different Router paths.
- Redirects cannot change the configured tenant or server origin.

## Delivery tasks

Task status and dependencies are mirrored in [`plans/microsoft-sharepoint-and-work-iq.json`](microsoft-sharepoint-and-work-iq.json).

### S0 — Confirm authority and tenant operations

**Depends on:** none
**Status:** complete 2026-09-01

Approved decisions:

1. Assigned site: `https://knoxnswedu.sharepoint.com/sites/digital-utilities` (updated and granted 2026-09-02). The whole-site selected role is accepted; `/Shared Documents/test-uploads/os-test/` is the harmless evaluation fixture, not a narrower Microsoft permission boundary.
2. Initial selected role: `read`.
3. Provisioning/revocation: Carrick is a tenant Global Administrator and will approve the separate admin operation as needed; the production Worker never receives grant-management authority.
4. Resource selection: exact SharePoint URL entry; no tenant-wide site search. Add a private assigned-site catalog only if URL entry proves inadequate.
5. Limits: 50 MB maximum streamed download; 5 MB maximum buffered read/transform; uploads disabled in the read-only slice.
6. Content: raw bytes only in v1; native Office/PDF text extraction deferred.
7. Shared Gadgets: supported only after observer-owned delegated access checks pass; otherwise fail closed.
8. Scope: files and folders only; generic SharePoint lists deferred.

Authority update 2026-09-02: delegated `Sites.Selected` has tenant admin consent and the Entra application has a separately provisioned whole-site `read` assignment for `digital-utilities`. The production Worker still has no grant-management authority. Live use remains blocked on deployment approval and evaluation verification.

**Acceptance:** complete. Authority, site, provisioning owner, resource scope, content behavior, and limits are recorded without credentials.

### S1 — Harden existing Graph OAuth

**Depends on:** S0
**Status:** complete 2026-09-01

- Add PKCE to authorization and token exchange.
- Bind verifier/challenge to one expiring OAuth flow.
- Persist rotated refresh tokens atomically.
- Preserve serialized connect/refresh/revoke behavior.
- Add deterministic tests for callback replay, expiry, PKCE, incremental consent, refresh rotation, and reconnect rollback.

**Acceptance:** complete. The authorization-code exchange now requires `code_verifier`; the redirect sends its RFC 7636 S256 challenge; the verifier is held only in the existing expiring, one-time OAuth nonce state and consumed before exchange; rotated refresh tokens are persisted only after the credential used for refresh is confirmed current. Existing nonce expiry/replay enforcement remains the gate around the verifier.

**Evidence:** `src/microsoft-oauth.test.ts` covers the RFC 7636 vector, token-exchange verifier, and refresh rotation; package tests and `tsc --noEmit` passed; full `pnpm check` passed with all seven Worker dry-runs.

### S2 — Propose and approve SharePoint capability interfaces

**Depends on:** S0
**Status:** complete 2026-09-01

- Add a proposed `SharePointDocumentSession` and `SharePointSiteSession` to a review diff or design artifact.
- Define read-only and writable capability shapes.
- Define canonical resource URLs and normalized metadata.
- Review every method as observation or action and identify simulation behavior.
- Confirm JSDoc contains no implementation details.

**Acceptance:** complete. The operator approved a read-only `SharePointDocumentSession` bound to one immutable file/folder capability, with `metadata()`, folder-only `listChildren()`/`search()`, file-only bounded `read()`, raw bytes, opaque pagination, exact-item strategy-B verification, and no writes. Site-wide capability remains a separate strategy-C review.

### S3 — Add SharePoint resource/scopes model

**Depends on:** S1, S2
**Status:** complete 2026-09-01

- Add `Sites.Selected` to the per-resource scope mapping.
- Preserve short/fully-qualified returned-scope normalization.
- Parse/format canonical site/document resource URLs.
- Reject tenant mismatch, malformed IDs, mutable-path-only identity, and resource-pattern confusion.
- Add tests for incremental consent and resource matching.

**Acceptance:** complete. The SharePoint resource requests only delegated `Sites.Selected`, recognizes short and fully-qualified returned scopes, and uses canonical immutable `siteId`/`driveId`/`itemId` capability URLs that reject mutable SharePoint URLs, foreign origins, malformed paths, query strings, and encoded path confusion. Existing Outlook scope tests remain green.

**Evidence:** 19 package tests and `tsc --noEmit` passed; changed-file diagnostics are clean.

### S4 — Implement the SharePoint Graph adapter

**Depends on:** S3
**Status:** complete 2026-09-01

Implement `sharepoint-api.ts` with injected token/fetch dependencies and typed results:

- resolve assigned site URL;
- site metadata and document libraries;
- item metadata, children, constrained search, and paging;
- bounded content download with safe preauthenticated redirects;
- structured status-bearing errors;
- `Retry-After`, pagination, and response-size handling;
- no logging/caching of bearer tokens or download/upload URLs.

Prepare write methods behind internal typed intents but do not expose them yet.

**Completed 2026-09-01:** implemented immutable-ID item metadata; normalized file/folder results; children paging with exact bound-folder `nextLink` validation; search paging bound to the exact folder and query; metadata-first 50 MB file rejection; 5 MB range reads; manual Graph content redirects; HTTPS-only preauthenticated downloads without Graph bearer forwarding; status-only redacted Graph errors; exact assigned-site browser URL resolution through Graph `/shares`; double confinement against submitted and returned URLs; assigned-site resolution and document-library discovery without tenant-wide search; and denial, throttling, malformed-response tests.

**Acceptance:** fixture/HTTP tests cover success, paging, 401 refresh, 403/404 denial, 429 retry, unsafe redirect, oversized file, malformed response, and secret-redacted errors.

### S5 — Ship read-only document/folder Gatekeeper

**Depends on:** S4
**Status:** complete 2026-09-01

- Add `SharePointDocumentGatekeeperImpl` with a new additive Durable Object migration tag.
- Dispatch canonical document/folder URLs from `MicrosoftUserImpl`.
- Route every read through `authorizeObservation()` before returning data.
- Implement strategy-B `MicrosoftVerifier.hasSharePointItemAccess()` using the observer's own token.
- Fail closed on missing observer connection or ambiguous Graph failure.
- Implement resource configurator URL resolution and optional assigned-site browsing.
- Keep action lifecycle methods rejecting because this slice is read-only.

**Completed 2026-09-01:** added the approved agent-facing types; explicit `SHAREPOINT_ASSIGNED_SITE_URL` authority configuration; additive migration `v1`; canonical SharePoint dispatch; read-only session implementation with observation authorization before metadata/pages/bytes return; strategy-B exact-item verifier using observer-owned credentials; exported `SharePointDocumentGatekeeperImpl`; exact-URL configurator with async canonical resolution and prefill round-trip; and generated sandbox HTML. Dedicated Node and workerd suites prove canonical dispatch and mutable/foreign rejection, authorization on metadata/empty pages/bytes with denial preventing return, file/folder mismatch rejection, read-only action enforcement, exact-item observer admission/denial/transient failure, verifier success and fail-closed error classification, and configurator resolution/prefill/edit behavior. Full `pnpm check` passes and the Microsoft dry-run shows the assigned-site var with no public route.

**Acceptance:** Worker tests prove confinement to the bound site/drive/item, authorization-before-return, positive/negative/transient observer behavior, configurator round-trip, and no token exposure.

### S6 — Evaluate and verify document support

**Depends on:** S5
**Status:** in progress; recursive folder reads deployed and authenticated against `os-test`, remaining live verification matrix pending

- Completed 2026-09-02: provision delegated `Sites.Selected` and a whole-site `read` assignment for `digital-utilities` out of band.
- Run package checks and full `pnpm check`.
- Completed 2026-09-02 by approved production continuation: deploy the read-only capability behind the existing Access-protected Router, with evaluation limited to the harmless `os-test` fixture.
- Verify URL resolution, metadata, folder browsing, search, bounded content, rename/move stability, a denied unassigned site, a denied user, positive observer, negative observer, and transient verifier failure.
- Live finding and resolution 2026-09-02: a folder session could list child metadata but `read()` targeted only the bound folder. The deployed fix adds recursive `open(itemId)`, bounded immutable-parent ancestry validation, strategy-C item tracking, and Workers-compatible manual download redirects. Authenticated testing against only `os-test` now reads `hello.txt`; tests cover nested descendants, outside/cyclic ancestry rejection, forward observer exclusion, historical observer admission denial, and redirect-mode compatibility.
- Verify Outlook Mail/Calendar regression paths.
- Present production mutation and rollback summary before any Knox production deployment.

**Acceptance:** evaluation evidence covers authority, resource confinement, observer behavior, Access, private Worker routing, Outlook regressions, and rollback limitations.

### S7 — Add site/library capability with strategy C

**Depends on:** S6
**Status:** blocked

- Add `SharePointSiteGatekeeperImpl` under a new additive migration tag.
- Implement one observation tracker for pending/observed item data sets and stored observers.
- Ensure every list/search/open result reports all concrete item IDs it reveals.
- Reverify existing observers before newly observed items are released.
- Use immutable item IDs across path changes; handle deleted/inaccessible items conservatively.
- Add bounded caching/delta only if measurements justify it.

**Acceptance:** concurrency tests cover observer admission races, failed authorization, multiple item ACLs in one page, revoked access, renames, deletion, retries, and correct `excludeObservers` behavior.

### S8 — Add approved SharePoint writes

**Depends on:** S6; S7 only for site-wide writes
**Status:** blocked; separate authority approval required

- Change only selected sites from `read` to `write` assignment.
- Add create folder, create/upload file, replace with eTag, rename, and same-site move.
- Store normalized typed pending actions; perform no Graph write before `applyAction()`.
- Re-fetch/eTag-check at apply time.
- Simulate pending actions where reliable; document any unavoidable interface-visible gap.
- Add resumable upload only after explicit size limits and idempotency behavior are approved.
- Continue to exclude delete, sharing, permissions, labels, cross-site moves, lists, and schema operations.

**Acceptance:** tests prove submit-without-side-effect, exactly-once approved application where possible, stale eTag rejection, rejection cleanup, same-site confinement, upload expiry/recovery, and safe approval descriptions.

### S9 — Production deployment and closeout

**Depends on:** S6 and any approved subset of S7/S8
**Status:** blocked; explicit production approval required

- Inventory all current Worker versions, site grants, scopes, and rollback limits.
- Confirm additive DO migrations and mixed-version compatibility.
- Run fresh `pnpm check`.
- Present the operator-skill production mutation summary.
- Deploy once after approval, record every version ID, and stop on first failure.
- Verify live Access, `/admin`, Outlook, SharePoint, observers, approval queue, storage persistence, AI, Reporter, logs, and absence of backend public routes.
- Update `DEPLOYMENT.md` and the original Microsoft plan status.

**Acceptance:** production verification is recorded with no unverified security-critical item described as passed.

### W0 — Prove Work IQ tenant feasibility

**Depends on:** S9
**Status:** blocked by SharePoint production completion

Confirm without production mutation:

- Microsoft 365 Copilot licensing;
- Agent 365 availability and region;
- exact SharePoint and Word Work IQ permission names;
- tenant admin consent and allow/block state;
- supported client registration type and Worker HTTPS callback;
- exact MCP endpoint metadata, current tool schemas, error shapes, telemetry, and retention;
- whether an observer-owned exact-document probe can distinguish denial from transient failure.

**Acceptance:** sanitized feasibility report identifies available servers, permissions, callback flow, schemas, governance, costs, privacy, and remaining blockers. Stop if prerequisites are unavailable.

### W1 — Approve Work IQ interfaces and package design

**Depends on:** W0
**Status:** blocked; mandatory review stop

- Finalize document resource identifiers and `WorkIqDocumentSession`.
- Define allowed read scenarios and explicitly forbidden tools.
- Decide observer strategy; default A unless W0 proves strategy B.
- Approve OAuth/account separation, MCP client seam, ToolCatalog seam, configurator authority, and disabled-by-default deployment controls.

**Acceptance:** operator approves `types.d.ts`, authority matrix, and schema-drift behavior before code is written.

### W2 — Build and test MCP transport without real credentials

**Depends on:** W1
**Status:** blocked

- Scaffold `packages/gatekeeper-work-iq` without deployment registration.
- Implement `McpClient` against fake token and sanitized server fixtures.
- Cover initialization, protocol headers, Streamable HTTP, SSE, sessions, bounds, timeouts, redirects, JSON-RPC IDs, retries, and redaction.

**Acceptance:** deterministic transport contract tests pass without tenant credentials or external data.

### W3 — Implement separate Work IQ OAuth/account state

**Depends on:** W2
**Status:** blocked

- Implement protected-resource/authorization-server discovery, PKCE, canonical `resource`, refresh rotation, tenant/server pinning, callback state, reconnect, and revocation semantics.
- Add separate Work IQ Durable Object classes and migrations.
- Prove Graph/Work-IQ tokens and account IDs cannot cross interfaces.

**Acceptance:** OAuth separation tests pass and no credential appears in logs, tracked files, approval text, or fixtures.

### W4 — Add schema-gated read-only document scenarios

**Depends on:** W3
**Status:** blocked

- Implement `ToolCatalog` with local allowlisted SharePoint/Word read scenarios.
- Dynamically discover tools and validate required schemas.
- Add sharing-URL configurator producing a canonical Gatekeeper document resource.
- Authorize observations before returning metadata, text, or comments.
- Keep observer strategy A unless W0 evidence supports B.

**Acceptance:** fixture and live-evaluation tests prove known schemas work, drift disables only affected scenarios, unknown/destructive tools remain unreachable, and reads stay within the selected document.

### W5 — Add optional deployment integration

**Depends on:** W4
**Status:** blocked; trust-boundary approval required

- Add conditional `workIq` configuration and stable Worker identity.
- Generate/build/deploy/bind only when enabled.
- Route OAuth through `/gatekeeper/work-iq` while keeping the Worker private.
- Add complete enabled/disabled deployment tests and documentation.
- Keep `enabled: false` in production until evaluation is approved and verified.

**Acceptance:** `pnpm check` proves disabled means no Worker/bindings and enabled produces the exact private Worker, callback origin, build, deployment order, and service bindings.

### W6 — Evaluate Work IQ and decide whether to continue

**Depends on:** W5
**Status:** blocked

- Deploy to isolated evaluation identities, route, Access app, storage, and Microsoft test data.
- Verify OAuth, schema drift, SharePoint/Word reads, denial/error behavior, privacy/telemetry, and private routing.
- Compare reliability, authority, latency, coverage, and governance with direct Graph.
- Decide: stop, retain as evaluation-only, or approve a production-readiness plan.

**Acceptance:** written go/no-go decision with evidence and no assumption that preview implies a production path.

### W7 — Optional approved Work IQ writes

**Depends on:** W6 go decision
**Status:** blocked

Start with document creation and Word comment/reply scenarios only:

- typed pending actions;
- no remote call before `applyAction()`;
- apply-time schema revalidation;
- rejection cleanup;
- operation-specific idempotency and no blind write retries.

Delete, sharing, sensitivity labels, list deletion, and column deletion remain out of scope until separately designed and approved.

**Acceptance:** approval tests prove immediate MCP writes are impossible through the Gadget interface and remote effects match approved typed intent.

## Verification strategy

### Local and contract checks

- Package-focused TypeScript, unit, Worker, configurator, and HTTP-adapter tests.
- Full `pnpm check` after each deployment-affecting slice.
- Generated `wrangler.prod.jsonc` review and cleanup verification.
- No generated files, secrets, tokens, sharing URLs, download URLs, or real document content tracked.

### Security checks

- Incremental-consent tests for each resource type.
- Site assignment absent/present and user denied/allowed matrix.
- Exact resource confinement after rename and move.
- Observation authorization happens before return.
- Writes cannot occur before approval.
- Observer positive, negative, revoked, and transient-failure cases.
- Graph and Work IQ token-audience separation.
- Backend Workers have no route or Preview URL.

### Live checks

Live checks use non-sensitive evaluation sites/documents first. Production requires the Cloudflare OS operator skill's mutation summary and explicit approval. A passing dry-run does not prove tenant assignments, Microsoft policy, observer access, content preservation, or production rollback.

## Rollback and revocation

- Durable Object migrations are additive; do not remove old migration tags/classes during rollback.
- Reverting Worker code does not remove Entra consent, site assignments, refresh tokens, or external writes.
- SharePoint access rollback includes revoking the selected site assignment and, if required, delegated consent; verify Outlook scopes remain intact.
- Write rollback is operation-specific. Rename/move/replace may require compensating Graph actions; uploads and comments may not be safely reversible.
- Work IQ rollback disables the Worker/binding and revokes its separate app consent/tokens; it cannot undo MCP-triggered external effects.
- Record current and prior Worker version IDs before every production mutation.

## Open operator decisions

Recommended defaults are in parentheses:

Resolved 2026-09-01; site updated and granted 2026-09-02:

1. Assigned site: `https://knoxnswedu.sharepoint.com/sites/digital-utilities`; harmless evaluation fixture: `/Shared Documents/test-uploads/os-test/`; whole-site boundary accepted.
2. Initial assignment: `read`.
3. Provisioner: separate Global Administrator operation; never the production Worker.
4. Selection: exact URL; no tenant-wide search.
5. Initial capability: document/folder first, site traversal second.
6. Generic lists: deferred.
7. Office text extraction: deferred; raw bytes only.
8. Limits: 50 MB streamed, 5 MB buffered, uploads disabled initially.
9. Graph writes: only after read-only evaluation; no delete or sharing.
10. Work IQ: designed now, implementation blocked until direct Graph is live and W0 passes.

## Completion definition

This plan is complete when:

- approved SharePoint sites are reachable only through delegated `Sites.Selected` authority;
- the existing Gatekeeper exposes approved resource-confined SharePoint capabilities;
- observations, writes, and observers satisfy the Gatekeeper security model;
- Outlook behavior remains verified;
- production deployment and rollback evidence are current;
- the Work IQ module has an approved separate interface/design and feasibility evidence;
- any Work IQ implementation remains optional and disabled until its own evaluation and production decision.
