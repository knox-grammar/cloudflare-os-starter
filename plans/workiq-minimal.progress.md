# Minimal WorkIQ progress

## 2026-10-07: park Graph expansion and propose the tiny layer

Operator approved pausing/parking the custom Graph expansion and pursuing a tiny WorkIQ wrapper. This is product-direction approval, not the mandatory review of the concrete Gatekeeper interface or approval of tenant/deployment changes.

### Completed

- Created `archive/microsoft-graph-save-as` at `647eeff`. Original Graph branch remains intact.
- Started `feat/workiq-minimal` from `672cadfc2c6874bcf780f2510522df6885264db6`, the merged CI/staging baseline. The post-baseline Graph expansion is absent from the active branch, not deleted from history.
- Preserved unrelated submodule scratch, untracked root `AGENTS.md`, Pi configuration/skill and current WorkIQ research. No stash, reset, force push or credential deletion.
- Identified existing native MCP session, catalog, action, OAuth and owner-only sharing modules. No reason to build another workload SDK or MCP stack.
- Drafted the three-method native MCP interface, one portable routing skill, and a small task/gate plan. Historical Graph-first plan now points to this pivot.

### Compatibility findings

The shared account currently expects dynamic public-client registration and a hosted `/oauth` redirect. The successful Pi public-client/localhost flow is not hosted OAuth evidence. A registered-client/tenant-discovery seam and separately approved hosted registration/setup may be necessary. Shared OAuth-provider code is private, so do not pretend an existing configuration option already provides it.

Shared transport buffers at 1 MiB and retained action results are bounded at 128 KB. WorkIQ's documented 4 MB raw file limit is not a supported wrapper download size. `ask` can delegate effects; it must be conservatively gated rather than classed as read-only from a prompt or annotation. No direct mutations in the first execution slice, no new workload abstractions or file storage.

### Fresh verification

- `node --test 'scripts/**/*.test.ts'`: **35 passed**, zero failures.
- `pnpm exec tsc --ignoreConfig --noEmit --skipLibCheck --target es2022 plans/workiq-minimal-interface.d.ts`: exit 0. pnpm reconciled the baseline workspace installation; no dependency manifest/lockfile change was intended.
- Node assertions: parked and original Graph refs match; active branch/base match; gitlink unchanged; separate approval flags false; task dependencies valid; expanded Graph provider absent; Pi configuration, assessment and root `AGENTS.md` preserved. Passed.
- `git diff --check`: passed. Deployment configurations, wrapper scripts, CI workflows and package/workspace manifests match the merged baseline.

These checks cover the park/proposal, not a running WorkIQ Gatekeeper. No new Worker, credentials, OAuth registration, consent, tenant policy, infrastructure, staging release or production deployment. No push or commit in this turn.

### Next gate

Operator reviews `workiq-minimal-interface.d.ts` and the linked policy trade-offs. Stop before Gatekeeper implementation per the project authoring skill. After approval, first resolve hosted OAuth reuse; do not expand the wrapper to work around an unsupported flow.

## Complete interface implementation after operator review

The operator approved MCP and explicitly rejected a deferred mutation subset. W1 is approved. The interface now exposes every discovered tool and generated named method, including mutations, actions/functions, delegated `ask` and future tools, subject to the native grant and approval queue. Live tenant writes are still not authorized by implementation approval.

### Implemented

- Thin `packages/gatekeeper-workiq/` subclass adapter, deployment-classified reads and approval-gated other operations; no auto-approval based on annotations.
- Registered public/confidential Microsoft client configuration using the native account's PKCE, issuer/nonce/generation fences and staged reconnect. Exact WorkIQ/offline scope is pinned rather than allowing remote metadata to widen it or silently remove refresh support. Fixed public resource metadata independently checked; no live authenticated API call was made during this implementation.
- Full apply/reject/result lifecycle, exact forwarded payloads, generated mutation methods, owner-only and named-tool grants, and failed ambiguous outcomes without blind replay. No new Microsoft workload SDK or byte store.
- One canonical `skill.md`, linked into Pi and included in Workshop binding type documentation. Guidance distinguishes interpretation, structured facts and actual bytes and does not claim to enforce authorization.
- Optional wrapper configuration for a private WorkIQ Worker and callback/vendor bindings. Actual production and staging configurations remain unchanged.
- Explicit `patches/workiq-native-mcp.patch` for two tiny shared changes, applied idempotently with exact-pin/applicability checks. Both scratch and unrelated edits are preserved; pin unchanged.
- Repository-wide RPC validation and generated-source aliases. The initial package-scoped build skipped native decorated imports. This was fixed, not hidden: the normal test task now dry-runs the real bundle and checks its startup/inherited vendor RPC through a Worker service binding. Standalone Miniflare probes also needed its current converter and a correct modules root; only the working bounded smoke is retained.

### Final fresh evidence

- `pnpm test`: exit 0, **508 tests passed**. Includes **26 pure WorkIQ**, **14 workerd WorkIQ**, **324 native shared MCP**, **38 wrapper/patch**, and existing regression suites. All Vite+ tasks executed without cache hits in this final run.
- Included production `wrangler deploy --dry-run`: exit 0. Validation transformed both adapter and native connector; actual compiled bundle startup and inherited RPC smoke passed. No deployment.
- `pnpm run types:scripts`: passed.
- `pnpm --filter @knox/gatekeeper-workiq run types:check`: passed, including idempotent patch preparation.
- Targeted `pnpm exec vp lint` over all new/changed implementation, test and build files: passed.
- Parent and submodule `git diff --check`: passed.
- Production/staging JSONC, CI and existing secret-installation script diff against `672cadf`: no changes.
- Assertions: parked refs retained/matching; active branch correct; submodule HEAD exact pin; checked-in patch matches intentional shared diff; canonical skill/symlink match. Passed.

Expected workerd negative-path diagnostics are printed for denied grants/observers and ambiguous writes; there are no failed tests or unhandled Vitest errors.

### Still separately gated, not deferred interface features

No hosted registration/redirect, credentials, consent, tenant mutation policy, billing, infrastructure, live mutation, deployment, push or commit was performed. Real hosted delegated identity, remote policy behavior, denied/revoked access, bytes, normal-use cost and education/privacy/contract suitability need approved live verification. Provider-native operations do not inherit the parked Graph save-as/revision contract. Disconnect retires local credentials, not a guarantee of global Entra token/consent revocation. Native bounds remain explicit, especially 1 MiB transport versus WorkIQ's 4 MB raw-file allowance.

Next: review/checkpoint the complete local implementation, then separately approve hosted setup and real-user staging verification. Earlier Router/partial-staging state must be resolved before release; no production promotion is inferred.
