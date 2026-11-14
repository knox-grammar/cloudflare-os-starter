# WorkIQ owner-only beta

Status: staging target and pipeline implementation approved by the operator. Live setup and release remain separately gated.

Target: existing Access-protected `https://os-staging.knoxi.dev`, with owner-only WorkIQ connections. Preserve the existing Access group, sole administrator, storage identities and production configuration. Complete MCP interface remains available through native grants and approval; no tool subset is deferred.

## Slices

### B1: staging wiring and fail-closed CI/CD preflight

Reuse the existing deployment-config generation and protected staging workflow seams. Add a proposed private Worker identity, `knox-os-staging-gatekeeper-workiq`, to the local staging configuration only. Its ownership and provisioning still need live inventory and explicit approval.

Prepare the exact-pin native extension before CI checks. Type-check deployment scripts and WorkIQ explicitly. Before changing any staging Worker, require existing deployment evidence for every configured Worker and required credential names for both Microsoft connectors. Include the WorkIQ callback in sanitized anonymous Access probes. Secret-name presence is not evidence of credential validity, confidential-client configuration, consent or successful hosted sign-in.

Acceptance: wrapper/preflight regression tests, script and WorkIQ types, real staging build/dry-runs including the eighth Worker, generated configuration cleanup, unchanged production configuration and submodule pin. Neither tracked mutation gate is opened. No live writes.

### B2: inventory and resolve actual staging state

Read-only inventory: current Worker versions, route/zone and Access boundaries, proposed Worker-name collision/ownership, credential names and protected GitHub environment. Reconcile the previous Router failure and partial release before proposing any repair. Record sanitized evidence and the exact next mutation summary. No blind retry.

### B3: separately approved private Worker and hosted OAuth setup

Approve the exact Worker identity, Knox-owned registration, redirect `https://os-staging.knoxi.dev/gatekeeper/workiq/oauth`, credential installation and any required consent/billing. Do not change Microsoft's localhost client or bridge Pi/Graph tokens. Provision only the approved private identity; the release workflow must not silently bootstrap it.

### B4: separately approved staged release and real-user evidence

Publish/review the branch and merge through CI, then approve the exact-SHA staging environment release. Verify hosted delegated sign-in/reconnect, owner/denial/revocation behavior, bounded reads, interpretation and independently decoded tiny bytes. Live mutations need exact fixture/payload/effects approval. `ask` approval covers delegation, not per-step approval inside Copilot. Enabling remote entity writes is a separate tenant-wide decision and can take up to 24 hours.

School-wide eligibility, education/minor terms, privacy/residency and budget controls remain rollout gates. No synthetic WorkIQ performance tests without written clearance. A successful deployment or Access redirect is not successful OAuth, operation completion or a persisted-data upgrade rehearsal.

## Recovery

Deployments are not atomic. Inventory old/new versions before a release and retain failure evidence. Do not delete credentials, storage or Worker identities as cleanup. Rollback code alone does not undo Durable Object changes or remote Microsoft effects. Production promotion is separate.
