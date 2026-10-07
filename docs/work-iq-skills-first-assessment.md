# WorkIQ MCP: skills-first reassessment

Status: historical assessment. The operator subsequently approved the WorkIQ-first pivot and the complete native MCP interface, now implemented locally in [the minimal WorkIQ plan](../plans/workiq-minimal.md). Tenant setup, credentials, billing and deployment remain separately gated; Graph/save-as work is preserved on its archive branch.

The read-first sequencing and narrower operation recommendations below record the assessment at the time. The approved complete MCP implementation supersedes that sequencing, not the licensing, policy, privacy or contractual caveats.

## Recommendation

Evaluate WorkIQ as the primary Microsoft 365 workflow surface, with Knox-specific skills on top, rather than continuing to implement every workload operation ourselves. Start with personal, read-only workflows and controlled draft/event actions. Keep direct Graph only where a demonstrated gap requires it.

This is now commercially plausible for the school-wide population: Microsoft's current WorkIQ overview explicitly says API access is independent of Microsoft 365 Copilot licensing. Usage is metered, including custom applications serving Copilot-licensed users. This corrects the earlier blanket Copilot-licence assumption, but does not establish Knox tenant eligibility, education-specific contractual suitability, cost, or rollout readiness. [S4, S9]

Skills can encode good workflows. They are not an enforceable authorization boundary and cannot replace Cloudflare OS observations, approved actions, resource confinement, or observer checks.

## What the supplied pages establish

WorkIQ exposes generic verbs against relative resource paths, with runtime path/schema discovery. This is a much smaller surface than independently modelling every Graph operation. Examples include reading `/me/messages`, creating `/me/events`, and invoking `/me/sendMail`. Entity paths map to Graph endpoints; this is a managed tool/governance layer, not evidence that underlying file concurrency contracts have changed. [S1–S3]

The reference covers `fetch`, `fetch_blob`, `create_entity`, `update_entity`, `delete_entity`, `do_action`, `call_function`, `ask`, `list_agents`, `get_schema`, and `search_paths`. Important contracts: [S3]

- JSON mutation bodies are **JSON-encoded strings**, not objects.
- `fetch` can batch paths; inspect every per-path `statusCode`, not just MCP transport success.
- Collection reads default to `$top=25`, cap at 100; chat messages cap at 10. `$skip` and `$skiptoken` are blocked. A bounded page is not a complete inventory, and example `nextLink` values are not permission to bypass these limits.
- `fetch_blob` returns Base64 in `structuredContent`, with a default **4 MB raw-file limit**, configurable per path. The docs do not specify the exact byte interpretation of MB. Decode and store bytes outside model context; don't claim a file was materialized without doing so.
- `ask` returns another agent's answer and supports conversation continuation, file context, and an IANA time zone. File context is not documented as an exclusive resource-access boundary.
- Schema discovery currently covers Graph v1.0 and lists `fetch`, `create`, and `update` operation types. Discovery alone does not establish authorization or successful execution.
- The service does not retry automatically. Clients receive downstream status, `Retry-After`, and correlation IDs. Do not blindly replay ambiguous mutations.
- A `202` action response is acceptance, not proof of completed delivery.

Tool classification must use operation semantics, not name alone: creating a draft persists data; free/busy can use `do_action` without modifying data. [S12]

## Current product versus the older research

The supplied unified WorkIQ MCP is not just a rename of the older workload-specific Agent 365/SharePoint/Word servers. Microsoft's Copilot Studio documentation explicitly distinguishes the unified experience from those legacy tools and their runtime/billing models. Do not carry the old per-workload tool inventories, licence assumptions, or OAuth audiences across without verification. [S10]

The official remote endpoint is `https://workiq.svc.cloud.microsoft/mcp`. The GitHub Copilot CLI quickstart installs Microsoft's plugin and its accompanying skills. Microsoft's repository already provides a public `workiq` routing skill, a separate `workiq-preview` skill, and ten read-only productivity skills. These are good starting references, not a reason to duplicate a complete generic Microsoft skill. [S11, S12]

The preview variant distinguishes caller-owned retrieval from delegated answering: use preview `retrieve` when available for evidence the caller will synthesize; use `ask` for intentional delegation. Retrieval is tenant-dependent and absent from the supplied tool reference. No automatic `ask` fallback should hide unavailable retrieval or broaden denied scope. The public skill has a different, ask-oriented synthesis policy. Select one deliberate routing policy rather than loading contradictory instructions. [S12]

The underlying API licensing announcement describes general availability, while the repository and Copilot Studio integration retain preview labels. Neither blanket 'everything is preview' nor 'every MCP feature is GA' is justified. Verify the exact endpoint/features selected for Knox. [S9, S10, S12]

## Licensing, cost and tenant prerequisites

Microsoft's overview says users without Copilot licences can use the API through usage-based billing. The licensing announcement says there is no separate WorkIQ subscription, SKU, or per-user licence. Normal licences for the Microsoft services being accessed are still required. [S4, S9, S13]

Published tool/action pricing is **0.1 Copilot Credits per API call**; chat/context reasoning is variable. This is not a blanket `ask` price and is not a dollar estimate. As arithmetic only, 4,000 users × 10 metered tool calls per day × 20 days is **80,000 Copilot Credits per month**, excluding chat/context, model/Cloudflare costs, and additional calls. Population is not concurrency; actual activity, credit purchasing terms and billable-call treatment need validation. [S9]

Tenant enablement requires usage-based billing, an Azure subscription/resource group, a user assigned to the billing plan, and a Global Administrator for one-time setup. Cost governance documents cover service/group/user reporting and spending policies. The setup pages describe different administrative paths; verify the effective WorkIQ-specific spending policy rather than assuming an existing Copilot budget covers it. No setup was performed. [S6, S8, S10]

The Foundry quickstart still explicitly requires a Copilot licence per caller, despite the general API overview's independent-licensing statement. That may be integration-specific or stale documentation. It does not invalidate the documented general API model, but it prevents asserting that every host/integration has identical eligibility. [S4, S14]

## Security and governance still belong in the design

Authentication is delegated Microsoft Entra, with no app-only fallback. The API resource URI is `api://workiq.svc.cloud.microsoft`; the permission reference documents admin-consented `WorkIQAgent.Ask`, including accessible-agent read/write access on behalf of the signed-in user. Graph tokens and existing `Sites.Selected` assignments are not evidence of WorkIQ authority. [S5, S7]

The MCP overview describes four broad permissions, but the permission reference currently enumerates only `WorkIQAgent.Ask`. Discover protected-resource metadata and tenant consent requirements before selecting scopes; do not invent the other permission names or assume this one is the complete entity-tool contract. [S1, S7]

Mutations are **blocked by default**. Initial MCP policy control is **tenant-wide**, not per-user, per-app, per-agent, or per-scenario templates; changes can take **up to 24 hours**. Enabling supported writes is a separate tenant-wide governance decision, not merely enabling one Knox skill. Fine-grained Rego capabilities do not mean all those controls are exposed in the initial admin interface. [S5]

For Cloudflare OS, retain a small executable Gatekeeper boundary:

1. Separate tenant-pinned WorkIQ connection and credentials; no Graph-token reuse.
2. Explicit tool/path/body allowlists, validated live schemas, response bounds and drift handling. Runtime discovery must never silently grant new capabilities.
3. Observation-authorized reads; private owner-only results initially. The signed-in owner's permission trimming does not authorize a Gadget's other observers.
4. Durable exact-payload approval before external mutation, including recipient/audience effects and persisted drafts. Skill instructions alone cannot enforce this.
5. Per-user conversation isolation, untrusted-content handling, sanitized audit correlation, bounded cancellation and truthful unknown-outcome reporting.
6. Block policy administration, deletion, sharing/ACL changes and broad traversal until independently designed and reviewed.

These are Knox architectural recommendations, not promises made by WorkIQ documentation. Broad `ask` access also needs explicit consideration: prompt wording is not a document confinement mechanism, and access to an agent with actions must not bypass local approval.

## The SharePoint gap remains concrete

The supplied reference documents binary **download**, not binary upload. Microsoft's preview plugin explicitly says **`upload_blob` is not released** and separates creating an upload session from sending bytes. A session-created response does not mean a file was saved or replaced. [S3, S12]

Therefore a skills pivot does not yet replace the existing new-file byte transport, create Office documents by itself, or resolve the failed whole-item revision contract. For reviewed document workflows, prefer analysis plus suggested changes or an Office-native link initially. Add save-as through a separately validated transport only when needed. Never describe `update_entity` as a proven atomic file-replacement workaround.

## Proposed Knox skills and evaluation

Keep one small shared WorkIQ routing reference, then add workflow skills with clear outcomes:

1. **Daily brief:** bounded inbox/calendar/Teams evidence, source links, Australia/Sydney time handling and explicit incomplete-results notices. No writes.
2. **Meeting follow-up:** summarize decisions and proposed actions from accessible evidence; distinguish facts from suggestions. Preview reply text or an event before asking for mutation approval.
3. **Reviewed communication:** draft, show exact recipients/content/audience, obtain specific approval, execute once and distinguish draft-created, accepted, completed, blocked and unknown outcomes.

Later: curriculum/document review and 'save updated copy' once file transport is proven. Do not promise complete mailbox inventories or migrations through the bounded MCP collection interface.

First evaluation should use a normal delegated operator account with synthetic/approved data and read-only policy. Verify actual catalog/schemas, a licensed underlying Microsoft 365 account without a Copilot add-on, denied resources, revocation, response caps, latency, actual credit consumption and conversation separation. Then review a small approved draft/event mutation. Do not enable tenant writes, grant consent, install an OAuth connection, or deploy without approval.

For school-wide rollout, confirm education/minor-user eligibility, privacy/data handling and residency for the chosen features, effective billing restrictions and host-specific licensing. Documentation does not establish these for Knox. Shared-user/observer access requires its own evidence before enabling collaborative Gadgets.

**Contractual warning:** the linked Microsoft IQ terms prohibit API performance testing without Microsoft's written permission, prohibit using the APIs for migration to non-Microsoft products/services, and restrict redistribution/resale/sublicensing of obtained data and licence circumvention. The fetched page defaulted to the Microsoft Customer Agreement; confirm Knox's actual programme terms. Do not run the planned synthetic scale/load tests against WorkIQ without contractual clearance. These limits do not by themselves establish a prohibition on ordinary internal workflow use. [S13]

## Documentation inconsistencies to resolve in discovery

The supplied pages say '10 tools', while the reference contains eleven named tool sections including `fetch_blob`. Examples use `list_agent` instead of documented `list_agents`, and `parentUrl` instead of `functionUrl` for `call_function`. The allowed-prefix summary omits paths referenced by other examples. Treat the live approved catalog and tested semantics as evidence; never copy an example typo or infer universal Graph coverage. [S1, S3, S12]

No live tenant inspection, OAuth/consent, billing activation, mutation, installation, load test, or deployment was performed in this assessment. Subsequent local discovery and the approved full-interface implementation are recorded separately in `plans/workiq-minimal.progress.md`; they do not establish beta release readiness.

## Primary sources

- **S1:** [WorkIQ MCP overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/overview)
- **S2:** [Entity model](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/entity-model)
- **S3:** [Tool reference](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/tool-reference)
- **S4:** [Current WorkIQ overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/)
- **S5:** [MCP policy governance](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/policy-governance-mcp)
- **S6:** [Enable WorkIQ](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/enable-work-iq)
- **S7:** [Permissions reference](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/permissions)
- **S8:** [Copilot Credit usage-based billing](https://learn.microsoft.com/en-us/microsoft-365/copilot/usage-based-billing-overview-copilot-credits)
- **S9:** [Microsoft's WorkIQ licensing announcement](https://aka.ms/WorkIQ/licensing)
- **S10:** [Unified versus legacy WorkIQ in Copilot Studio](https://learn.microsoft.com/en-us/microsoft-copilot-studio/use-work-iq)
- **S11:** [Remote MCP GitHub Copilot CLI quickstart](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/quickstart/github-copilot-cli)
- **S12:** [Microsoft's official plugin repository](https://github.com/microsoft/work-iq), [catalog](https://github.com/microsoft/work-iq/blob/main/PLUGINS.md), [public routing skill](https://github.com/microsoft/work-iq/blob/main/plugins/workiq/skills/workiq/SKILL.md), [preview README](https://github.com/microsoft/work-iq/blob/main/plugins/workiq-preview/README.md), [remote configuration](https://github.com/microsoft/work-iq/blob/main/plugins/workiq/.mcp.json). Repository main is a moving source, not a pinned dependency approved for installation.
- **S13:** [WorkIQ API terms link](https://learn.microsoft.com/en-us/legal/work-iq-apis/terms-of-use), resolved to Microsoft IQ Product Terms during inspection.
- **S14:** [Foundry-specific quickstart](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/quickstart/foundry)
- **S15:** [API overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/api-overview)
