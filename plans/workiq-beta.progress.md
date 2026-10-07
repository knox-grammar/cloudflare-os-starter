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

Next slice: reconcile actual staging state using read-only inventory. Do not infer hosted readiness from these local checks.
