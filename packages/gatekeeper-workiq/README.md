# Knox WorkIQ Gatekeeper

A thin adapter over the pinned Cloudflare OS MCP connector. No Microsoft workload SDK or custom read/write transport.

## Complete interface

The native session exposes `listTools`, `callTool`, `getActionResult` and schema-generated named methods. Every discovered tool remains callable within its grant, including create/update/delete, actions, functions, Copilot `ask` and future tools. There is no read-only rollout subset or deferred mutation implementation.

`fetch`, `fetch_blob`, `get_schema`, `search_paths` and `list_agents` are deployment-classified observations. Other tools require approval, regardless of server annotations. No actions are auto-approvable. `ask` approval covers a delegated request that may perform downstream effects, not separate approvals inside Copilot. Its warning appears in connection, configurator and approval descriptions.

Remote operations retain Microsoft's own semantics. This generic interface does not inherit the parked Graph provider's save-as or whole-item revision guarantees.

Whole-endpoint grants include future tools; named-tool grants do not. Accounts are owner-only, and observations use the native authorization queue. A failed/unknown action is not blindly replayed. Approved calls retain the original MCP content and structured result, including tool errors; downstream HTTP statuses must still be inspected by the caller. MCP completion does not establish the completion of a downstream asynchronous operation.

## Hosted OAuth

The endpoint and Knox tenant are fixed in `src/policy.ts`. A registered client supplies the exact WorkIQ scope. Native PKCE, nonce/issuer/generation checks, stored credentials, refresh, expiry notification, revocation and staged reconnects are reused. No dynamic registration, borrowed Pi credentials, Graph token, shared service token or app-only fallback.

Required deployment configuration:

- `BASE_URL`: the hosted connector URL, ending in `/gatekeeper/workiq`. The wrapper generates this from the selected public origin.
- `WORKIQ_CLIENT_ID`: an appropriately registered client whose redirect matches `${BASE_URL}/oauth`.
- `WORKIQ_CLIENT_SECRET`: only for a registered confidential client; otherwise the registered public-client flow is used. Credentials stay outside repository files.

Disconnect removes the locally held connection and credentials; it does not promise that Entra has revoked every issued token or consent. No remote revoke-session operation is performed.

The demonstrated Microsoft-owned localhost client is not a hosted registration. No registration, consent, credential installation or tenant policy change has been performed. Live sign-in, WorkIQ policy, school eligibility and ordinary-use cost remain release prerequisites. The generic MCP lifecycle does not prove the signed-in user's email; do not turn its null identity into a fabricated profile.

## Build and verify

```sh
pnpm --filter @knox/gatekeeper-workiq run types:check
pnpm --filter @knox/gatekeeper-workiq run test:run
pnpm --filter @knox/gatekeeper-workiq exec vitest run -c vitest.worker.config.ts
pnpm --filter @knox/gatekeeper-workiq run test:bundle
```

The normal Vite+ test task runs all three checks, including an actual dry-run bundle startup and inherited RPC check. `scripts/build-workiq.ts` validates both the adapter and the imported decorated connector classes. The Wrangler aliases point to those validated classes; a package-scoped transform alone silently skips imported classes and cannot ship correctly.

Two small shared-source changes expose the native protected OAuth-provider hook and use deployment-neutral approval prose. `patches/workiq-native-mcp.patch` distributes these explicitly. Preparation checks the exact pin and clean patch applicability, accepts an already-applied patch, and never resets unrelated changes. A partial or incompatible patch fails closed. The committed submodule gitlink is unchanged; no upstream upgrade or SDK copy.

## Bounds

Existing native bounds remain: 1,048,576 bytes per buffered transport response; 98,304 bytes per described catalog; 65,536 bytes per staged argument payload; 131,072 bytes per retained action result; 50 pending and 100 retained actions. Catalogs can be discovered progressively through native lookup/search. Oversized transport responses fail, not truncate; oversized retained action results explicitly report that omission after the remote call completes.

WorkIQ's documented 4 MB raw file allowance is not the wrapper's supported raw download size. Base64 and JSON consume the transport budget. No binary cache, upload service or Office-file generation is added. Unsupported remote operations stay unsupported; the adapter does not manufacture a tool Microsoft has not released.

## Optional deployment wiring

`workers.gatekeeperWorkIQ: { "name": "<separately-approved-worker-name>" }` opts into wrapper generation of the private Worker, Router path, vendor service binding and deployment order. Without it the existing seven-Worker configuration stays unchanged. Production remains opted out. The local staging file proposes `knox-os-staging-gatekeeper-workiq` for beta, with both live mutation gates closed; this does not provision or release the Worker.

Enablement, hosted credentials, infrastructure and releases require separate approval. Staging uses its own Worker identity. Resolve the earlier partial-staging/Router problem before a live release. No deployment or live Microsoft mutation was performed during implementation.

Portable workflow guidance: `skill.md`, linked from `.pi/skills/knox-workiq/SKILL.md` for Pi and included in the Workshop binding's generated TypeScript documentation. One source, no separate manual. It guides tool use and is not a security boundary.
