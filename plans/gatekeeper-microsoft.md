# Plan: Microsoft Gatekeeper

Status: **Phase 1 + approval-queue logging (Phase 2, partial) implemented 2026-08-25
(typechecks, dry-run bundles). Not registered with the deploy script, no resource
configurator UI, no live Graph testing yet. Do not deploy or enable.**

A Cloudflare OS Gatekeeper bridging Gadgets to Microsoft 365 through Microsoft Graph,
modelled on `cloudflare-os/packages/gatekeeper-google/`. Lives in this wrapper repo
(`packages/gatekeeper-microsoft/`) rather than the pinned submodule, so upstream
upgrades never clobber it.

Authoritative process guide:
[`cloudflare-os/.agents/skills/write-gatekeeper/SKILL.md`](../cloudflare-os/.agents/skills/write-gatekeeper/SKILL.md)
and its `SKELETON.md`. Read both before implementing.

## The central decision: delegated OAuth, never app-only

Knox already has Microsoft Graph code in
`knoxi-apps/packages/tools/src/integrations/microsoft/` and
`knoxi-apps/packages/tools/src/auth/microsoft/`. It comes in two flavours, and only one
of them is usable here.

- **`app-auth.server.ts` — app-only (`client_credentials`). DO NOT USE.** Graph
  Application permissions are tenant-wide. Knox's own `mailbox-policy.ts` states it
  plainly: a service principal holding `Calendars.ReadWrite` "can read and write EVERY
  mailbox in the tenant." If the gatekeeper minted app-only tokens, every Cloudflare OS
  user who connected Microsoft would silently gain tenant-wide authority, and observer
  verification would be impossible — there would be no per-user oracle to answer "can
  this collaborator see this resource?".
- **`oauth.server.ts` — delegated authorization code + `offline_access`. USE THIS.**
  Each connected account holds its own refresh token, and Graph enforces that user's
  real ACLs. This is what makes observer strategies B and C viable, and it mirrors how
  `gatekeeper-google` works.

This is not a preference; it is the security model. An app-only Microsoft gatekeeper
would be a tenant-wide privilege escalation dressed up as a connector.

## Reuse from Knox, and what to leave behind

**Port:** `graph-client.ts` is genuinely good and Workers-native — throttling awareness
(429/503, both `Retry-After` and `x-ms-retry-after-ms`), `$batch` handling, endpoint
normalisation. Graph throttles hard and `gatekeeper-google` has no equivalent. Also
`paginated.ts` and the non-mailbox parts of `graph-helpers.ts`.

**Demote, don't delete:** `mailbox-policy.ts`. Under delegated auth Graph is the
enforcing boundary, so the policy is redundant in principle. Keep it as
defence-in-depth against a bug in our own resource scoping — its fail-closed `$batch`
body checking is exactly the kind of detail that is easy to get wrong. It is no longer
the primary control.

**Ignore:** `fabric/` — that is the Knox GraphQL data platform, unrelated to Graph.

**Reference only:** `@flue/teams` JWT verification (signing key, `msteams` endorsement,
`serviceUrl` claim, tenant pinning) if the Teams bot path is ever built. Its outbound
messaging is app-only, so it cannot be lifted directly.

## Scope

### In scope for v1

| Resource | urlPattern | Delegated Graph scopes |
| --- | --- | --- |
| Outlook mailbox | `https://outlook.office.com/mail/*` | `Mail.ReadWrite` |
| Outlook calendar | `https://outlook.office.com/calendar/:calendarId/*` | `Calendars.ReadWrite` |

Always requested (identity): `openid`, `profile`, `email`, `User.Read`, `offline_access`.

Scopes are requested **per resource**, following `gatekeeper-google`'s `RESOURCE_SCOPES`
table (`google.ts:272`) — connecting a calendar must not ask for mailbox scopes.

**No `Mail.Send`.** Decided 2026-08-25: v1 ships read, organise (archive/delete/move/
read-state), and drafting only. `OutlookMailSession.createDraft()` and
`MailThread.draftReply()`/`draftForward()` create drafts in the Drafts folder via
`Mail.ReadWrite` alone; the mailbox owner reviews and sends them from Outlook. Actually
sending programmatically (`Mail.Send`, or `POST /messages/{id}/send`) is deferred until
the approval flow is proven end to end.

**Calendar invites are a separate mechanism and are still in scope.** Creating a
calendar event with `attendees` causes Graph to send invitations automatically under
`Calendars.ReadWrite` — this is not the `Mail.Send` path and was not part of the
send/draft decision above. Flag if you want invite-sending deferred too; if so,
`createEvent`/`updateEvent` would need an `attendees`-free variant for v1.

### Phase 2 (later, same package)

SharePoint site / list / document, OneDrive file. Needs a real decision on
`Sites.Selected` vs `Sites.ReadWrite.All`; prefer `Sites.Selected` if the tenant admin
will provision per-site grants.

### Deliberately deferred: Teams

Teams via the Bot Connector is a different shape and does not belong in v1.

- The Bot Connector is **push-based** (Azure Bot Service posts activities to a webhook)
  and its outbound messaging is **app-only**. That maps to Cloudflare OS **Hooks**
  (`gatekeeper-email` is the reference implementation), not to resource connections, and
  it reintroduces the tenant-wide token problem above.
- A delegated alternative exists — `Chat.ReadWrite` / `ChannelMessage.Send` as the
  signed-in user — which fits the gatekeeper model cleanly but cannot receive push
  events without polling or Graph change notifications (public webhook plus subscription
  renewal).

Treat Teams as its own design conversation with its own plan document.

## Observer strategy, per resource

Chosen per `Gatekeeper` DO class, not per package (Google uses three strategies in one
package). See the SKILL's "Observer verification" section for the A/B/C/D definitions.

- **Outlook mailbox → A (private-only).** `addObserver()` always throws. A personal
  mailbox has no per-recipient ACL we could verify an observer against, so full access to
  it is too personal to extend to any non-owner. This is the same reasoning
  `gatekeeper-google` applies to Gmail (`google.ts:1960`).
- **Outlook calendar → A (private-only) for v1.** Decided 2026-08-25: start conservative.
  Event bodies and attendee lists can carry information from people who never shared
  anything with the observer, and there's no clean per-observer oracle for "can this
  person see this specific event." `addObserver()` always throws, same as mail. Revisit
  as B (single-ACL via `MicrosoftVerifier.hasCalendarAccess(calendarId)`) once there's a
  concrete case for sharing a calendar-reading Gadget between staff.
- **SharePoint document → B** (per-item ACL check). **SharePoint site → C** (data-set
  tracking; a site spans items with distinct ACLs and Graph provides a per-observer
  oracle for each).

## Architecture

Three tiers, mirroring `gatekeeper-google`:

1. `GatekeeperVendor` (WorkerEntrypoint) — one per service. `describe()`,
   `connectAccount()`, `getSupportedResources()`, `getTypeScriptTypes()`.
2. `UserAccount` (DO) + `MicrosoftUserImpl` (WorkerEntrypoint) — one per connected
   Microsoft account. Holds the refresh token, serialises minting/refresh/revoke against
   each other, maps resource URLs to gatekeeper classes.
3. One `Gatekeeper<Session>` DO class per resource type — `OutlookMailGatekeeperImpl`,
   `OutlookCalendarGatekeeperImpl`. Each provides its Session API and owns its
   approvals, caching, and simulation.

Plus `MicrosoftVerifier` (WorkerEntrypoint, no migration entry needed) implementing the
non-standard verifier methods for strategies B/C.

The router already proxies `/gatekeeper/<binding-name>` to the matching Worker, which is
how the OAuth redirect arrives.

## Implementation phases (per the SKILL)

**Phase 1 — auth, API design, resource granularity.**
1. Study Graph's API surface and auth model. ✅
2. Design `src/types.d.ts` — the Session interfaces. ✅ (this commit)
3. **STOP for operator review of the API.** ← we are here. The SKILL is explicit:
   "getting the API right is the most important and delicate part of creating a new
   gatekeeper," and "do not proceed without operator approval."
4. Implement vendor / UserAccount / UserImpl / GatekeeperImpl / SessionImpl.
5. Register the service binding and wire it into `scripts/deploy.ts`.
6. Add resource configurator UIs (mailbox folder picker, calendar picker).
7. **STOP — ask whether to proceed to Phase 2.**

**Phase 2 — approvals, caching, simulation, observers.** Every read calls
`authorizeObservation()`; every side effect goes through `submitAction()` and is not
performed until `applyAction()`. Then caching, then simulation, then the observer
strategies above.

## Wrapper-specific integration work

Unlike a submodule gatekeeper, this package needs the starter's deploy script taught
about it. `scripts/deploy.ts` currently hardcodes six Workers:

- Add `gatekeeperMicrosoft` to `packageDirs`.
- Add its generated config to `generateConfigs()`, with `setCommon()` (no route,
  `preview_urls: false`) like every other backend Worker.
- Add `{ binding: "GATEKEEPER_MICROSOFT", service: <name>, entrypoint: "GatekeeperVendor" }`
  to the Workshop's `services` array, and the router's non-entrypoint equivalent.
- Add a build step to `buildCommands()`.
- Add it to the deploy sequence **before** the Workshop (which binds it).
- Add `workers.gatekeeperMicrosoft.name` to `deployment.jsonc` and its validation paths.

`CLIENT_ID` / `CLIENT_SECRET` are **secrets**, installed interactively with
`wrangler secret put` against the Microsoft gatekeeper Worker. They never go in
`deployment.jsonc`, `vars`, or any tracked file. `TENANT_ID` is not a secret and can be
a `var`.

## Gotchas confirmed in the codebase

- `src/types.txt` **must be a symlink** to `types.d.ts`, never a copy. All six in
  `gatekeeper-google/src` are symlinks; it is imported as a text module for
  `getTypeScriptTypes()`.
- Every DO class needs a `migrations[].new_sqlite_classes` entry under a **new** tag.
  Never edit an existing tag. `WorkerEntrypoint`s (the verifier) need no entry but must
  be exported from the main module so `ctx.exports.X` resolves.
- The agent-facing JSDoc in `types.d.ts` must **not** mention approvals, caching, OAuth,
  or DO storage. Correct simulation keeps the approval queue invisible to the agent.
- Call `.dup()` on `approvalQueue` stubs before storing them in a session.
- `suggestedBindingName` reflects the resource **type**, not the instance.
- Use `this.ctx.storage.kv` (synchronous) over the older async storage methods.
- Pass credentials and resource ids via `ctx.props`, not constructor arguments.

## Decisions (resolved 2026-08-25)

1. **Calendar observer strategy → A**, start conservative; revisit if a real sharing
   need shows up.
2. **Mailbox granularity → folder scoping included.** `OutlookMailSession` supports a
   folder-scoped binding, matching Gmail's label/search/inbox split. Implemented in
   `types.d.ts`'s `WellKnownFolder` and the `folder` option on `list()`.
3. **Send authority → deferred.** No `Mail.Send` scope in v1. `createDraft()`,
   `draftReply()`, `draftForward()` create Drafts-folder items only; the mailbox owner
   sends them. See the scope table note above for the calendar-invite caveat.
4. **Tenant pinning → single-tenant.** `TENANT_ID` is pinned to the Knox tenant
   (`3b951541-2eca-412c-9d5f-ffb43008c700`) in `wrangler.jsonc`, blocking sign-in from
   any other Microsoft tenant.

## Open questions still outstanding

- Should calendar invite-sending (automatic under `Calendars.ReadWrite` when an event
  has `attendees`) be deferred alongside `Mail.Send`, or is that acceptable to ship now?

## Phase 1 implementation notes (2026-08-25)

Files added under `packages/gatekeeper-microsoft/src/`:

- `microsoft.ts` — `GatekeeperVendor`, `UserAccount` (OAuth DO, ported structurally from
  `gatekeeper-google`'s), `MicrosoftUserImpl`, `MicrosoftVerifier`, and the two resource
  gatekeepers: `OutlookMailGatekeeperImpl` / `OutlookCalendarGatekeeperImpl` with their
  session implementations.
- `microsoft-api.ts` — OAuth token exchange/refresh against
  `login.microsoftonline.com/{tenant}/oauth2/v2.0/token`, `MailApi`, `CalendarApi`.
- `auth-retry.ts` — ported **unchanged** from `gatekeeper-google` (401 retry-with-refresh,
  429/5xx backoff, `AccessTokenCache`). Nothing in it was Google-specific.

**Approval-queue logging added 2026-08-25 (Phase 2, first task):** every read in both
sessions now calls `authorizeObservation()` before returning data, and every
side-effecting write (archive/delete/mark-read/moveTo/draft* on mail;
createEvent/updateEvent/deleteEvent/respondToEvent on calendar) is stored via a
per-gatekeeper `PendingActionStore` and submitted with `submitAction()` — nothing
reaches Microsoft Graph until the overseer calls `applyAction()`, which both
gatekeepers now implement for real (a `switch` over the stored action, mirroring
`gatekeeper-google`'s `GmailGatekeeperImpl.applyAction`). Draft-reply/draft-forward
actions refetch the conversation's most-recent message at apply time rather than
trusting an id captured at submit time, since the conversation can change while the
action awaits approval — the same reasoning `gatekeeper-google` gives for refetching
immutable source messages.

**Deliberately still out of scope, per the SKILL's Phase 1/Phase 2 split:**

- **No simulation.** Neither gatekeeper reflects a pending (not-yet-approved) action in
  its reads — an archived-but-not-yet-approved conversation still shows up in `list()`.
  This mirrors `gatekeeper-google`'s own choice for Gmail's archive/trash/markRead
  actions (simulation is optional per the SKILL; Google's Gmail gatekeeper doesn't
  simulate those either, only Google Docs does, because editing genuinely needs it).
  Revisit if this proves confusing in practice.
- **No resource configurator UI.** `startResourceConfigurator()` throws with a clear message.
  Step 6 of the SKILL (folder picker, calendar picker) is unbuilt.
- **Not registered with `scripts/deploy.ts` or `deployment.jsonc`.** The wrapper-specific
  integration work described above (packageDirs, generateConfigs, build step, deploy
  ordering, service bindings) has not been done, so `pnpm check`/`pnpm deploy` neither build
  nor deploy this package. It cannot reach production by accident.
- **No caching.** Mail conversation listing groups messages by `conversationId` within a
  single fetched page only — a conversation whose most recent message falls on a
  different page can be missed or duplicated across pages. Flagged inline in
  `microsoft-api.ts`. This is the exact caching gap the SKILL calls out for Gmail's list
  API.
- **Every read still authorizes even data the caller may not end up using** (e.g.
  `getThread()` authorizes full message bodies even if the caller only calls
  `summary()`). Conservative by design — consistent with how `gatekeeper-google`'s Gmail
  cursor authorizes a full page of thread metadata regardless of what the caller reads
  afterward — but worth knowing if approval descriptions look broader than what an agent
  actually did with the data.
- **HTML↔Markdown conversion is a light first pass** (`htmlToPlainText` / `markdownToHtml` in
  `microsoft-api.ts`), not a full converter. Adequate for plain messages; loses structure
  (lists, links, formatting) that `gatekeeper-google`'s dedicated converter preserves.
- **Placeholder logo asset** (`microsoft-logo.svg`) — a simplified four-square mark, not a
  licensed Microsoft brand asset. Replace before this is shown to real users.
- **Per-user avatar not fetched** — `AccountDescription.avatar` is a generic placeholder
  since Graph's photo endpoint (`GET /me/photo/$value`) needs a separate authenticated binary
  fetch, not implemented this pass.

**Verification performed:** `tsc --noEmit` on the package (clean, both after the initial
implementation and again after the approval-queue rewrite), and `wrangler deploy --dry-run`
(bundles and dry-run-deploys cleanly with `TENANT_ID` baked in, both times). Neither proves
correctness against a real Microsoft Graph tenant — no live OAuth flow or Graph call has been
exercised, and the approval-queue wiring has not been exercised against a real overseer
either. That requires `CLIENT_ID`/`CLIENT_SECRET` and registration in `deployment.jsonc`,
which is deliberately not done yet.

## Next steps

1. Resource configurator UI (SKILL Step 6).
2. Caching (the conversation-listing gap above) and, if it proves necessary in testing,
   simulation.
3. Confirm the observer strategies (both currently A / always-throw) against real Graph
   behavior and real usage — particularly whether calendar sharing ever needs to move to B.
4. Wrapper integration: register in `scripts/deploy.ts` and `deployment.jsonc`, following
   "Wrapper-specific integration work" above.
5. A real HTML↔Markdown converter and real per-user avatar fetch, if the first-pass versions
   prove insufficient in testing.
6. Manual end-to-end test against a real Knox Microsoft 365 account once `CLIENT_ID`/
   `CLIENT_SECRET` are provisioned (Azure App Registration, single-tenant, redirect URI
   `<PUBLIC_BASE_URL>/gatekeeper/microsoft/oauth`).
