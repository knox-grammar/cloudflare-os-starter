# WorkIQ production wiring and release gate

This source change enables the already provisioned private WorkIQ identity in production configuration. It does not deploy production, change Access, advance the native pin, grant Microsoft consent or authorize data mutations.

## Approved scope

- Account `2ddaede0fbdd479a6bf410a5f1eb76ad`; existing origin `https://os.knoxi.dev`.
- Add existing `knox-os-gatekeeper-workiq` to the eight-Worker wrapper deployment. Router and Workshop bindings are derived by the existing wrapper; Router remains last.
- Pin the four independently inventoried production KV/R2 identities rather than provision replacements on a clean runner.
- Preserve all existing Worker names, Context sharing origin, Access issuer/audience/administrator, Microsoft settings, AI and observability configuration.
- Fixed native pin remains `32ce152654e8a205b54e094e31be932c620dbc52`; use the already reviewed exact-pin WorkIQ patch.
- The hosted WorkIQ application and production Web callback are separate setup. Both production credential names were independently verified; callback addition is operator-reported. Names do not prove credential validity or successful OAuth.

## Before the first upload

The protected production workflow checks the approved main SHA and reviewer environment as before. The new read-only preflight independently matches the exact source SHA, approved identities/storage/authentication configuration, active zone ownership, zone route-read access, all eight existing Worker deployments and both confidential WorkIQ credential names. It never provisions missing prerequisites and never reads credential values.

Sanitized pre-upload version IDs are retained in `production-preflight.json` for 14 days, including on a failed job. An actual deploy may still fail after code upload. Stop on first failure and reconcile published versions against this snapshot; no automatic retry or rollback.

Zone/route read access is not proof of route-write authority. `knoxi.dev` zone permissions include production, staging and other hostnames. Worker scoping does not confine zone authority. Do not broaden token permissions silently.

## Production Workshop migration gate, not yet complete

The live September Workshop exports/namespaces have `UserDurableObject`, `OverseerDurableObject`, `AdminSettings` and `PendingLogin`, but not `UserDirectoryDurableObject`. The current pinned bundle adds that SQLite class at v3, without deleting/renaming the old classes. The exact live old source commit and migration tag remain unverified; historical source review from `2e37d67fbb2883d5a730a08e865697ccb2c7034a` is context, not proof of the later deployed bundle's provenance.

The new directory stores profile IDs/names/revisions on user synchronization; search is admin-policy controlled. Authorizing an observation carrying `ownerInvitesOnly` persists that flag and narrows gadget sharing to direct owner grants, disables share links and prevents non-owner invitations. Deployment alone does not set that flag.

Current Cloudflare guidance prevents version rollback across the v3 class lifecycle change. Old code reading newly written state is not proven safe. Version rollback would not restore data or sharing flags anyway.

Required before release:
1. Specialist-reviewed old/new schema and RPC compatibility, including the non-atomic mixed-version window.
2. Representative non-sensitive persisted-account/workspace rehearsal; existing regression tests or a fresh staging connection alone are insufficient.
3. Backup/export feasibility, post-migration validation, approved containment and forward-repair instructions. Do not promise a restore that has not been proven.
4. Final approved merged main SHA and successful protected production dry-run.

Focused native directory/sharing/observation regression tests passed, but do not establish the complete historical-production upgrade contract. Migration review and persisted-data rehearsal remain pending. Do not approve the production job solely because this PR passes CI.

## Verification

- `node --test scripts/deploy.test.ts scripts/staging-workflow.test.ts scripts/production-preflight.test.ts`: 53 passed.
- `pnpm run types:scripts`: passed.
- `pnpm exec vp lint scripts/production-preflight.ts scripts/production-preflight.test.ts scripts/deploy.test.ts`: passed.
- Native Workshop `vitest run __tests__/user-directory.test.ts __tests__/sharing.test.ts __tests__/authorize-observation-flags.test.ts`: 75 passed after required local build preparation. Negative-input cases emit expected rejected-RPC exceptions.
- Actual WorkIQ production bundle/startup/inherited RPC smoke passed during private provisioning from unchanged connector source.
- Protected PR CI must verify the new eight-Worker production configuration and unchanged isolated staging configurations.

Natural live token refresh remains normal-use follow-up, not a launch prerequisite. No forced expiry, synthetic WorkIQ performance calls or production-user data reads are authorized by these checks.

## References

- [Worker rollback constraints](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
- [Durable Object lifecycle deployment constraints](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/).
- Existing source upgrade review: `plans/cloudflare-os-upgrade-2026-09.md`.
