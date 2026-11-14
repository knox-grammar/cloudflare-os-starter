# Cloudflare OS upgrade review, November 2026

Starter merged from `cloudflare/cloudflare-os-starter` `main` (`cbbf13d`), then core moved from
`32ce152` through the starter's `a679442` to upstream `main` `769474e` with
`cf-os update --upstream`. The deployment is experimental: one signed-in developer, and existing
Workshop data and Microsoft connections are disposable by operator decision (2026-11-13).

## What changed for Knox

- **Deploy tooling:** `scripts/deploy.ts` is replaced by upstream's `cf-os` CLI. Staging is the
  same CLI with `--config deployment.staging.jsonc`. `cf-os check`/`deploy` verify the account,
  Access application and storage when credentials are present, replacing the Knox staging and
  production preflight scripts. The private-bootstrap and release-ready gates are gone; the
  staging stack already exists and GitHub Environment approval still gates every deploy.
- **Removed:** Knox's Microsoft Graph Gatekeeper, the WorkIQ Gatekeeper and its core patch,
  `agent.timeZone` (core never read `AGENT_TIME_ZONE`), and upstream's Bonk review workflows.
- **Added:** upstream's Web Search Gatekeeper (built in, ambient) and upstream's Microsoft 365
  Gatekeeper as `gatekeepers.microsoft`, capped to selected SharePoint sites read-only, Outlook
  `draft` and Calendar `edit`. Eight Workers per stack.
- **Workshop:** additive Durable Object migrations `v3` (`UserDirectoryDurableObject`, already in
  the previous pin) and `v4` (`AdminAuditDurableObject`), plus a `version_metadata` binding.
  Neither deletes or renames a class. Version rollback across them is not supported.
- **Gatekeeper contract:** 14 upstream changes; none reach the custom Gatekeeper, which has no
  actions or git repository. Type-check passes.
- **Catalog:** workers-types, Wrangler 4.154.0, Miniflare, Vite+ and the Vitest pool mirror the
  submodule's catalog.

## Before Microsoft 365 works

1. A Knox tenant admin adds the Graph delegated permissions the caps request and grants admin
   consent: `openid profile email offline_access User.Read`, `Sites.Selected`, `Files.Read`,
   `Mail.ReadWrite`, `Mail.ReadWrite.Shared`, `MailboxSettings.ReadWrite`,
   `Calendars.ReadWrite`, `Calendars.ReadWrite.Shared`, `MailboxSettings.Read`, `People.Read`,
   `User.ReadBasic.All`. The app previously had only `Mail.ReadWrite`, `Calendars.ReadWrite`
   and `Sites.Selected`.
2. Register Web redirects `https://os.knoxi.dev/gatekeeper/microsoft/oauth` (already present)
   and `https://os-staging.knoxi.dev/gatekeeper/microsoft/oauth`.
3. After the first deploy creates each Worker, set `CLIENT_ID`, `CLIENT_SECRET` and
   `MICROSOFT_TENANT_ID` with `pnpm cf-os secrets microsoft` (plus `--config` for staging).
4. Load AI Gateway credits or a Ceramic key for Web Search, or its searches fail. Done: both
   stacks search through the `knox-os` gateway on the Knox account's credits, verified with a
   live search on 2026-11-14.

## Verification

- `pnpm lint`: passed.
- `pnpm cf-os check` and `pnpm cf-os check --config deployment.staging.jsonc`, back to back:
  434 tests passed, eight Wrangler dry-runs each, Microsoft 365 bound to Workshop and Router
  with the four cap vars. Run without Cloudflare credentials, so account checks were skipped.

## Rollback

Workers rollback cannot undo `v4` or Workshop writes. With disposable data, recovery is a
forward fix or a fresh stack. The retired `knox-os-gatekeeper-microsoft` and
`knox-os-gatekeeper-workiq` Workers, and their staging equivalents, were deleted on 2026-11-14.
