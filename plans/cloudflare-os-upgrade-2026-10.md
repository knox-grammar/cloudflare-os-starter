# Cloudflare OS upgrade review (source pin only)

Target: `cloudflare-os` `32ce152654e8a205b54e094e31be932c620dbc52` → `4f55124087d1525528697bdfdde1f15f83de740d` (upstream `origin/main` as fetched 2026-10-09). Parent before upgrade: `bb782bd`. This is 78 upstream commits / 629 changed files. No production or staging deployment is authorized by this source-pin change.

## Findings

- Workshop, Router, Context and Scheduler `wrangler.jsonc` files are now generated from `cloudflare.config.ts`. The generated JSON still carries the same bindings and migrations the wrapper reads. `scripts/deploy.ts` still clones those JSON files and preserves `migrations`. No new Durable Object class or migration tag was added to the four Workers Knox deploys. Workshop remains `v0`–`v3`.
- Existing workspace storage still migrates inside the Overseer. Production code already stamps schema version 4. The new code adds version 5, `migrateToBlueprintUpstreams`, which records each gadget's origin and reads up to 1000 chat messages on first wake. New workspaces are born at version 5. Old Workshop code cannot be assumed to understand version 5 rows. Rolling the Workshop back after a workspace wakes is **not proven safe**.
- `@gadgets/backend-utils` was renamed to `@gadgets/observability`. The logger export path is now `@gadgets/observability/logger`. WorkIQ follows that rename. The root workspace now includes `cloudflare-os/packages/observability` instead of `backend-utils`.
- Root `pnpm-workspace.yaml` catalog matches the pinned submodule: workers-types `^5.20261001.1`, miniflare `5.20261001.0-alpha`, vite-plus `^1.0.0`, wrangler `^4.147.0`, zod `^4.6.5`, and the vite override is `vite@*`. Vite+ 1 requires task `input`/`output` under `cache`; custom-gatekeeper and error-reporter were updated. Shared configurator tasks already use that shape.
- Usage metrics write to an optional `PRODUCT_ANALYTICS` pipeline. It is absent from the generated Workshop config, so a deployment without that binding no-ops. No new production secret or KV/R2 binding is required.
- Workshop trace sampling stays at 0.5. Upstream noted spans bill against the Logs quota from 2026-10-01. This pin does not change the rate, but the cost window is now open.
- `patches/workiq-native-mcp.patch` applies cleanly to `4f551240` and still only edits `packages/mcp-shared/src/account.ts` and `tools.ts`. The prepare script and patch test now require that exact commit.

## Migration and release gate

- **Durable Object tags:** unchanged for Workshop (`v0`–`v3`), Context (`v0`) and Scheduler (`v1`). No class added, renamed or deleted.
- **In-object schema:** Overseer version 4 → 5 is additive bookkeeping for gadget upstreams. It runs in the constructor before other storage use. It does not delete workspace data. It is not undone by reverting source.
- **Mixed-version window:** wrapper order is unchanged: Reporter, Context, Scheduler, custom, Microsoft and WorkIQ Gatekeepers, then Workshop, then Router. Gatekeeper RPC used by Knox was not given a new required binding. Google, GitLab and other upstream gatekeepers are not deployed here.
- **Before production approval:** rehearse on staging with a non-sensitive existing workspace, confirm it wakes, keeps its gadgets, and records upstreams; verify Access, `/admin`, Microsoft, WorkIQ, Scheduler, Context, AI and Reporter. Reconfirm live version IDs immediately before deployment. Do not delete storage.
- **Rollback limits:** Worker version rollback cannot undo a workspace that has already moved to schema version 5. Prefer an approved forward repair for the Workshop if a woken workspace misbehaves. Other Workers can roll back only after confirming their bindings still match the previous version. Stop at the first failed stage.

## Not authorized

Exact account `2ddaede0fbdd479a6bf410a5f1eb76ad`, route `os.knoxi.dev`, and the existing Worker identities are unchanged by this review. Do not dispatch the production workflow, and do not approve the staging job, merely because this pin is committed.
