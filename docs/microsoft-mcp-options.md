# Microsoft Work IQ MCP options for coding agents

_Research date: 2026-09-02. Sources are limited to primary Microsoft Learn documentation and this repository. The three principal Microsoft pages were last updated August 4–10, 2026._

## Executive recommendation

Treat Work IQ SharePoint and Word MCP as a separate, preview integration path—not as an extension of the existing Microsoft Graph token flow. Microsoft hosts tenant-specific remote MCP servers. A Cloudflare Worker Gatekeeper would be an MCP client and policy adapter: it should obtain separate Work IQ credentials, discover the live tool schemas, restrict resources and tools, and wrap reads and writes in Cloudflare OS observation and approval controls. Do not send existing Microsoft Graph tokens to Work IQ or assume Graph permissions authorize these servers; Microsoft documents a distinct Agent 365 permission and consent model for Work IQ servers ([Work IQ overview](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview)).

Because the services and tool contracts are preview and explicitly not intended for production, keep an adapter disabled by default and fail closed on schema drift. A direct Graph-backed implementation remains the safer production path when narrow, stable Graph permissions can satisfy the use case.

## Current service endpoints

Microsoft documents tenant-level, Microsoft-hosted endpoints under `agent365.svc.cloud.microsoft`:

| Service | Server ID | Endpoint |
| --- | --- | --- |
| SharePoint | `mcp_SharePointRemoteServer` | `https://agent365.svc.cloud.microsoft/agents/tenants/{tenantId}/servers/mcp_SharePointRemoteServer` |
| Word | `mcp_WordServer` | `https://agent365.svc.cloud.microsoft/agents/tenants/{tenantId}/servers/mcp_WordServer` |

Sources: [SharePoint reference](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-sharepoint-tools), [Word reference](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-word-tools).

Microsoft’s coding-agent example uses Mail at `https://agent365.svc.cloud.microsoft/agents/tenants/{tenantId}/servers/mcp_MailTools`; the same endpoint pattern and client registration model applies to Work IQ servers generally ([coding-agent setup](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview#set-up-work-iq-mcp-servers-for-coding-agents)). Customers configure a remote server URL; they do not deploy these Work IQ servers themselves.

## Authentication, discovery, and prerequisites

### Documented coding-agent flow

1. The user needs a Microsoft Entra account and a **Microsoft 365 Copilot license**.
2. Register an Entra application to act as the MCP client; record its client ID and tenant ID.
3. Add and consent the Agent 365 application permission corresponding to each requested Work IQ MCP server. Microsoft’s only explicit example is `WorkIQ-MailServer` for Mail.
4. Configure the app as a **Mobile and Desktop application** (public client). The primary example redirect is `http://localhost:8080/callback`; Microsoft also lists `http://127.0.0.1`, `http://vscode.dev/redirect`, `https://localhost`, and an AAD Broker URI.
5. Configure the coding agent with the tenant-specific server URL and client ID, connect, and complete interactive Microsoft sign-in.
6. After authentication, the client can ask the MCP server for its tools. Microsoft’s samples use Claude Code `/mcp`, GitHub Copilot CLI discovery from `.mcp.json`, or VS Code discovery from `.vscode/mcp.json`.

Microsoft documents Claude Code, GitHub Copilot CLI **1.0.40+**, and VS Code **1.118+** examples. Claude Code additionally requires its own subscription; GitHub Copilot CLI requires a Copilot plan ([coding-agent setup](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview#set-up-work-iq-mcp-servers-for-coding-agents)).

### Tenant and administrator gates

- By default, Entra users can register and manage their own applications, but tenant policy can disable app registration or user consent; an administrator must then perform or enable those actions.
- Each Work IQ MCP server corresponds to a permission on the Agent 365 application and is unavailable until consent is granted.
- Microsoft 365 administrators can activate or block servers organization-wide under **Agents and Tools**. Microsoft warns this control might not yet be available in every region.
- Microsoft says Agent 365 supports agentic user identity or delegated On-Behalf-Of authentication in its developer experiences, but the coding-agent instructions specifically show an interactive public-client flow.

Source: [Work IQ overview and coding-agent prerequisites](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview).

### Permission names and OAuth discovery: unresolved in current docs

The reviewed Microsoft pages **do not publish the exact Agent 365 permission identifiers for SharePoint or Word**. They name only the Mail example, `WorkIQ-MailServer`. Do not infer `WorkIQ-SharePointServer`, `WorkIQ-WordServer`, Microsoft Graph scopes, or permission GUIDs. Confirm the actual entries in the Entra API-permission picker or Agent 365 catalog for the target tenant before implementation ([coding-agent setup](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview#set-up-work-iq-mcp-servers-for-coding-agents)).

Likewise, these pages do not disclose authorization-server metadata URLs, protected-resource metadata URLs, token audiences/scopes, PKCE requirements, refresh behavior, or whether dynamic client registration is supported. The documented clients perform authentication after receiving only a server URL and pre-registered client ID, so discovery is client-managed, but the underlying discovery exchanges are not specified in the reviewed Microsoft documentation. A Worker implementation must capture and validate the live HTTP authentication challenge and metadata in a test tenant rather than hard-code guessed endpoints.

## Protocol and transport

Microsoft identifies these as MCP servers and configures all three coding agents with server type `http` and an HTTPS URL. The SharePoint and Word pages expose named tools with structured parameters. However, the reviewed Microsoft pages do **not** state an MCP protocol-version date, explicitly name Streamable HTTP versus legacy HTTP/SSE, document session headers, or describe retry/resumption behavior ([coding-agent setup](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview#set-up-work-iq-mcp-servers-for-coding-agents), [SharePoint reference](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-sharepoint-tools), [Word reference](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-word-tools)).

Therefore, an adapter should use a maintained MCP client implementation compatible with Workers where possible, negotiate rather than assume a protocol version, support live tool discovery, and verify the actual response/streaming behavior against the tenant endpoint before relying on it.

## SharePoint MCP tool surface

The current [SharePoint reference](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-sharepoint-tools) lists **35 tools**:

- **Sites:** `findSite`, `getSiteByPath`, `listSubsites`.
- **Libraries and discovery:** `listDocumentLibrariesInSite`, `getDefaultDocumentLibraryInSite`, `getFolderChildren`, `findFileOrFolder`, `getFileOrFolderMetadata`, `getFileOrFolderMetadataByUrl`.
- **File/folder content and mutation:** `readSmallTextFile`, `readSmallBinaryFile`, `createSmallTextFile`, `createSmallBinaryFile`, `createFolder`, `renameFileOrFolder`, `deleteFileOrFolder`, `moveFileOrFolder`, `copyFileOrFolder`, `checkOperationStatus`, `uploadFileFromUrl`.
- **Sharing/compliance:** `shareFileOrFolder`, `setSensitivityLabelOnFile`.
- **Lists/items:** `listLists`, `createList`, `deleteList`, `sendInviteForList`, `listListItems`, `getListItem`, `createListItem`, `updateListItem`, `deleteListItem`.
- **Columns:** `listColumns`, `createColumn`, `updateColumn`, `deleteColumn`.

Consumers should still trust live tool discovery over a cached inventory because Microsoft explicitly warns that preview tool names and parameters can change.

### SharePoint boundaries and risks

- Upload/download tools are limited to files **smaller than 5 MB**; binary reads return base64.
- Folder enumeration and default searches return up to 20 results.
- Cross-library copy and move are asynchronous and require `checkOperationStatus`.
- A sharing URL does not redeem access for `getFileOrFolderMetadataByUrl`; the user must already have explicit access.
- `deleteList` is irreversible; `deleteColumn` removes all data in that column.
- Tools can grant file/folder/list access, alter sensitivity labels, delete content, and search across all sites and libraries accessible to the signed-in user.

Source: [SharePoint reference](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-sharepoint-tools).

## Word MCP tool surface

The current [Word reference](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-word-tools) lists four tools:

- `WordCreateNewDocument`: creates a DOCX in the **root of the signed-in user’s OneDrive** from HTML or plain text and returns Microsoft Graph `DriveItem` JSON.
- `WordGetDocumentContent`: accepts a SharePoint or OneDrive sharing URL and returns filename, size, drive/document IDs, extracted plain text, and **all comments**.
- `WordCreateNewComment`: adds a comment using `driveId` and `documentId`.
- `WordReplyToComment`: replies using `commentId`, `driveId`, and `documentId`.

The documented surface does not edit or replace an existing document body, choose the creation destination, move/delete documents, or resolve comments. It is still write-capable, and retrieval can disclose the whole document text and all comments rather than a selected passage.

## Preview, stability, and data implications

Both reference pages explicitly label the tools **preview**, restricted, not intended for production, and subject to Microsoft’s supplemental preview terms. Microsoft may change tool names and parameters and tells clients to avoid hard-coded dependencies while saying it intends to preserve scenario support ([SharePoint reference](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-sharepoint-tools), [Word reference](https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-word-tools)). The overview provides no SLA, GA date, exhaustive region matrix, or stable schema guarantee ([Work IQ overview](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview)).

Microsoft states that the Agent 365 control plane provides scoped permissions, policy enforcement, payload checks/security scans, rate limits, and runtime observability. Administrators can inspect tool-call traces—including tool names, parameters, and outcomes—in Microsoft Defender Advanced Hunting ([security and compliance](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview#security-and-compliance)). Consequently:

- Prompts, tool arguments, resource identifiers, and outcomes may become Microsoft tenant audit/trace data.
- SharePoint and Word results can contain confidential file content, comments, list data, sharing recipients, and sensitivity-label information.
- Effective data reach appears bounded by the consented server permission and signed-in user’s accessible resources, but Microsoft does not document the exact SharePoint/Word permission scope on these pages.
- Microsoft-side governance does not replace Cloudflare-side authorization, approval, logging, retention, egress controls, or Durable Object credential protection.

Organizations should confirm preview terms, regional availability, Defender retention/access, data residency, and compliance treatment with their Microsoft administrator before testing with real content; those details are not resolved by the reviewed pages.

## Cloudflare Worker Gatekeeper integration

The existing `packages/gatekeeper-microsoft` architecture is a Graph-backed Cloudflare OS Gatekeeper, not an MCP client. It uses delegated Graph tokens and applies observation authorization to reads and explicit approval to writes. Work IQ should remain a separate trust and token boundary.

Recommended adapter design:

1. **Separate registration and credentials.** Use a dedicated Entra public-client registration for Work IQ permissions. Never forward Graph access/refresh tokens to `agent365.svc.cloud.microsoft`, and do not use Work IQ credentials for Graph calls.
2. **Server-side callback validation.** The Microsoft coding-agent examples use loopback/native redirects. A deployed Worker needs a redirect URI and OAuth client behavior supported by both Entra and the Work IQ endpoint; verify this in a test tenant because Microsoft does not document a Worker/confidential-web-client recipe for these servers.
3. **Per-user isolation.** Store Work IQ authorization/session state separately per tenant and user, encrypted and inaccessible to model-visible tool output. Bind every call to the expected tenant and canonical server URL.
4. **Dynamic discovery with an allowlist.** Discover tools at connection time, compare names and input schemas with an approved scenario manifest, and disable unknown or changed tools. Never automatically expose newly added Microsoft tools.
5. **Read-first resource binding.** Initially expose only site/file discovery, metadata, small-file reads, and Word retrieval. Require an operator-selected site/library/document boundary; do not default to tenant-wide search.
6. **Gatekeeper semantics around every call.** Run reads through `authorizeObservation()`. Queue writes for human approval with exact tenant, site/library/document, recipient, label, and destructive impact. Treat tool outputs as untrusted external data and enforce size/content limits.
7. **Initially block high-risk tools.** Omit deletion, sharing/invitation, sensitivity-label changes, list/schema mutation, and cross-library copy/move until each has precise policy, approval text, audit correlation, and postcondition checks.
8. **Operational safeguards.** Add short timeouts, bounded retries, idempotency/concurrency handling where available, 5 MB/base64 memory guards, asynchronous-operation polling limits, schema-drift alerts, token revocation handling, and correlation between Cloudflare approvals and Microsoft Defender traces.
9. **Preview kill switch.** Keep the integration disabled by default and support tenant-wide immediate disablement independent of Microsoft’s regional admin-center control.

These are architectural recommendations inferred from the documented service behavior and this repository’s Gatekeeper model, not a Microsoft-published Cloudflare integration pattern.

## Open uncertainties to resolve in a test tenant

1. Exact SharePoint and Word Agent 365 permission display names, permission GUIDs, and consent type.
2. OAuth protected-resource/authorization metadata, requested scopes/resource audience, PKCE and refresh-token behavior, and support for a Worker HTTPS callback.
3. Negotiated MCP protocol version, concrete HTTP streaming/session behavior, request limits, throttling, timeout guidance, and error contracts.
4. Whether SharePoint/Word are available in the target tenant’s region and admin-center catalog, and whether additional Agent 365 licensing or enrollment beyond Microsoft 365 Copilot is enforced.
5. The precise intersection of server permission, user ACLs, sharing links, sensitivity labels, Conditional Access, and other tenant policies.
6. Defender trace fields, retention, data residency, and whether content or only metadata is captured.
7. Live tool inventory and schemas—the current SharePoint page’s named tool list should be compared with runtime discovery before coding mappings.

## Bottom line

Work IQ provides a broad SharePoint read/write surface and a narrow but useful Word surface through Microsoft-hosted tenant endpoints. It is technically plausible for a Worker to consume as a remote MCP client, but it is not drop-in compatible with the current Graph Gatekeeper. The missing SharePoint/Word permission identifiers and undocumented low-level OAuth/transport details require tenant testing, while preview status and powerful destructive/sharing operations argue for a separate, read-first, disabled-by-default adapter with strict Cloudflare-side policy enforcement.
