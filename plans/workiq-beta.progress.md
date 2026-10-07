# WorkIQ beta progress

## B1: local staging wiring verified

Operator confirmed the existing `os-staging.knoxi.dev` target and approved precise pipeline slices. This authorizes local wiring, not infrastructure, OAuth, credential, tenant-policy or release mutations. Initial complete implementation checkpoint: `dbc9d13`.

Changes:

- Local staging configuration proposes `knox-os-staging-gatekeeper-workiq`; production stays at seven Workers. Neither staging mutation gate is opened.
- CI explicitly prepares the exact-pin extension and checks deployment-script/WorkIQ types. Protected release setup also prepares the patch.
- Release preflight requires existing deployment evidence for every configured Worker before checking either connector's required credential names. Errors are sanitized, and missing WorkIQ state stops before any deployment. Registered public clients need `WORKIQ_CLIENT_ID`; confidential registrations additionally need their separately installed secret, whose presence/validity is not established by this minimum name check.
- Anonymous evidence includes `/gatekeeper/workiq/oauth` only when WorkIQ is configured. An Access challenge does not prove the backend, OAuth or operations work.

Fresh verification after source edits:

- `node --test 'scripts/**/*.test.ts'`: 43 passed, zero failures.
- `pnpm run types:scripts`: passed.
- `pnpm --filter @knox/gatekeeper-workiq run types:check`: passed.
- Targeted Vite+ lint: passed.
- `pnpm check:staging`: passed. 513 tests reported, including cached unchanged suites; 4/13 test tasks were cache hits. WorkIQ pure/workerd tests and actual compiled-bundle RPC smoke executed successfully. All eight staging Workers built and dry-ran, Router last. No deployment.
- Generated `wrangler.prod.jsonc` files removed. Production deployment/workflow and lockfile unchanged; submodule gitlink/HEAD remains `32ce152654e8a205b54e094e31be932c620dbc52`. Unrelated root `AGENTS.md` and submodule scratch preserved.

B1 checkpoint: `e351983`. Do not infer hosted readiness from these local checks.

## B2: read-only inventory and token-specific routing guard

Sanitized evidence: `workiq-beta-inventory.json`. The inventory account selector was verified before requests. No secret values, authentication redirects, source content or private CLI diagnostics were retained.

- All seven existing staging Workers have observed deployments from 2026-10-02; the account's 56-Worker page does not contain the proposed WorkIQ name. WorkIQ deployment/credential queries were unavailable. No identity was created.
- `knoxi.dev` is active in the approved account, zone `423dd6e3814250bf304de8812e22ce4a`. The exact staging Access audience matches; its allow policy has an Entra selector. Group membership and signed-in allow/deny remain unverified.
- All five anonymous paths return the expected Access challenge. The WorkIQ callback also does so before a WorkIQ Worker exists, demonstrating why this is not backend/OAuth evidence.
- Failed run `36956274641` overlaps the observed deployment timestamps. Its deploy step failed but evidence collection succeeded: all seven new versions were published, not rolled back. These are current observed versions, not a proven last-known-good recovery baseline.
- The staging environment remains main-only with two reviewers. Run `37420111006` is waiting for approval against old baseline `672cadf`, not the WorkIQ branch. It was neither approved nor cancelled; do not use it as a beta release.

The operator's `cf` profile seeing an active zone does not establish the GitHub release token can see it. Added a read-only, exact-zone/account/active-status preflight using the actual release token, before any deploy. API errors and tokens are never logged; redirects are refused, with a 20-second timeout. Evidence reports a separate `zoneReadable` boolean. Denied/missing/wrong-zone/wrong-account/inactive/malformed/transport cases are covered. This prevents reaching a late Router mutation when the token cannot read the approved zone, without assuming that missing Zone Read caused the previous failure.

Source: [Cloudflare List Zones API](https://developers.cloudflare.com/api/resources/zones/methods/list/), which requires Zone Zone Read and supports exact name/account filters. No token permission was changed. Actual CI-token visibility still needs approved workflow execution.

Fresh verification after final source edits:

- `pnpm run types:scripts` and targeted Vite+ lint: passed.
- `pnpm check:staging`: passed, 46 fresh wrapper/preflight tests and 516 tests reported overall. 11/13 test tasks were cached unchanged package suites; the actual compiled WorkIQ bundle/RPC smoke executed. All eight Workers built and dry-ran. No deployment.
- Parent whitespace check passed; generated configs cleaned; production configuration and submodule pin unchanged.

Remaining B2 evidence: actual release-token zone access, exact custom-domain service mapping and alternate backend exposure, selected group membership and signed-in behavior. The `cf` schema catalog lacks the account Workers Custom Domains inventory endpoint; discovery friction is logged locally, not published. No DNS or Access repair is justified from the present evidence alone.

Next: publish/review source for fresh CI with approval, then complete token/routing inventory before asking for the exact private Worker and hosted OAuth setup mutation. B3/B4 remain gated; no tenant/billing/policy change, live mutation or production release.
