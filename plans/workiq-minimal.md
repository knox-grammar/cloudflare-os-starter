# Minimal WorkIQ Gatekeeper

Status: complete MCP interface approved and implemented locally. No feature/tool subset deferred; no release performed.

## Decision and preserved baseline

Use the existing Cloudflare OS MCP connector, not another Microsoft workload SDK. The operator approved the native `listTools`, `callTool`, `getActionResult` surface plus generated named methods, and explicitly required the entire interface, including mutations.

Graph expansion is preserved on `archive/microsoft-graph-save-as` at `647eeff`, with `feat/microsoft-gatekeeper-next` retained. Active branch `feat/workiq-minimal` starts from merged baseline `672cadf`. Existing Graph production functionality, credentials and tenant grants are unchanged. Unrelated submodule scratch and root `AGENTS.md` remain intact. The committed submodule pin is still `32ce152654e8a205b54e094e31be932c620dbc52`.

## Implemented thin layer

- `packages/gatekeeper-workiq/src/workiq.ts` subclasses the native connector. Fixed endpoint, vendor/account identity, resource metadata, configurator classification and catalog policy are the provider-specific pieces. Sessions, tool generation, transport, actions, observations, owner-only sharing and reconnect lifecycle remain native.
- `src/policy.ts` marks documented structured reads as observations. Every other tool is available through approval, including `ask`, mutations, actions, functions and future tools. Server annotations cannot auto-approve a write or turn `ask` into a read. Named grants stay bounded; whole-endpoint grants intentionally follow future tools.
- `src/oauth.ts` adds the registered Microsoft client/Knox issuer configuration while preserving native generation fences, PKCE and staged credentials. Both public and confidential registrations are supported. No DCR, admin/app-only fallback, Graph token or Pi credential bridge.
- Portable [routing skill](../.pi/skills/knox-workiq/SKILL.md): Copilot interpretation versus structured evidence versus actual bytes, exact operation approval, downstream statuses, denial handling and truthful recovery. One canonical skill is linked into Pi and included with the Workshop binding's generated types, not asserted as a security fence.
- Optional deployment-wrapper support generates a private WorkIQ Worker, Router callback route and vendor binding. Neither actual deployment configuration enables it.
- The build validates imported native RPC classes, with explicit generated-source aliases and a production-bundle startup regression check.

Two small shared-source edits add a protected OAuth-provider hook and truthful deployment-policy approval prose. They are distributed explicitly through `patches/workiq-native-mcp.patch`, with exact-pin checks and idempotent clean application. No reset of unrelated submodule work, pin upgrade or commit.

## Bounds and authority

Owner-only service/tool grant, not document confinement. `fileUrls` is context. `ask` approval covers delegation, not independent approval of steps inside Copilot. Direct operations show the exact payload through the native queue. No actions are auto-approvable, and no outcome-unknown call is blindly replayed.

Keep native bounded transport/catalog/arguments/results. WorkIQ's 4 MB raw-file allowance does not override the 1 MiB transport cap. Oversized results are explicit. No file cache, SDK fork, custom Office generator, content replacement or durable byte store. Remote tools that Microsoft has not released cannot be implemented by pretending their schemas exist.

## Tasks

### W0. Park Graph expansion, complete

Preserved refs, restored merged baseline, unchanged deployment files and pin verified; original 35 wrapper tests passed.

### W1. Review complete native interface, complete

Operator approved MCP, with no deferred interface capabilities. [Review declaration](workiq-minimal-interface.d.ts); actual per-tool types are generated from discovered schemas. Implementation is not permission for any specific live mutation.

### W2. Implement and locally prove hosted OAuth, implemented

Registered public/confidential flows and issuer/resource isolation are tested with the real SDK. Workerd verifies hosted initiation, single-use code redemption and reconnect tokens remaining staged until commit. A real hosted Knox registration/sign-in still requires separately approved setup; localhost Pi success is not that evidence.

### W3. Implement complete adapter, skill and optional wiring, implemented

All catalog operations, generated methods, native approval application/rejection, observation authorization, named grants, owner-only sharing and ambiguous no-replay behavior are covered. Imported RPC classes are validated in the production build, not only in Vite tests.

### W4. Real-user verification and release, separately gated

Authorize hosted registration/credentials and required consent/policy/billing separately. Test actual read, interpretation, tiny decoded bytes, denial/revocation/identity and response-limit behavior. Any live mutation needs an approved exact fixture target/payload/effects; do not infer that authorization from implementation approval. Confirm school/education/privacy/contract/cost conditions. No synthetic performance test without contractual clearance. Resolve earlier partial staging/Router failure before a separately approved staging release; production promotion remains separate.

See [progress](workiq-minimal.progress.md) for exact checks and residual risks and [package README](../packages/gatekeeper-workiq/README.md) for configuration/build details.
