import type { McpTool } from "@gadgets/mcp-shared/client";
import type { ClassifiedTool } from "@gadgets/mcp-shared/tools";

export const WORKIQ_ENDPOINT = "https://workiq.svc.cloud.microsoft/mcp";
export const KNOX_TENANT = "3b951541-2eca-412c-9d5f-ffb43008c700";
export const WORKIQ_SCOPE = "fdcc1f02-fc51-4226-8753-f668596af7f7/WorkIQAgent.Ask offline_access";

// Names backed by the service contract, not mutable server annotations. Unknown tools stay callable.
const READS = new Set(["fetch", "fetch_blob", "get_schema", "search_paths", "list_agents"]);

const ASK_WARNING = "Copilot delegation can include downstream reads and writes. Approval covers " +
  "this delegated request, not separate approval of each step inside Copilot.";

export function classifyWorkIQTool(tool: McpTool): ClassifiedTool {
  const described = tool.name === "ask" && !tool.description?.startsWith(ASK_WARNING)
    ? { ...tool, description: `${ASK_WARNING}\n\n${tool.description ?? ""}` } : tool;
  return { tool: described, mode: READS.has(tool.name) ? "read" : "action",
    autoApprovable: false, classifiedBy: "default" };
}
