import { describe, expect, it, vi } from "vitest";
import { McpSessionBase, type McpSessionHost } from "@gadgets/mcp-shared/session";
import { classifyWorkIQTool, WORKIQ_ENDPOINT } from "../src/policy.js";

const reads = ["fetch", "fetch_blob", "get_schema", "search_paths", "list_agents"];
const actions = ["ask", "create_entity", "update_entity", "delete_entity", "do_action", "call_function"];

describe("complete WorkIQ catalog", () => {
  it.each(reads)("classifies %s as a deployment-selected read", name => {
    expect(classifyWorkIQTool({ name })).toMatchObject({
      mode: "read", classifiedBy: "default", autoApprovable: false,
    });
  });

  it.each([...actions, "future_tool"])("keeps %s available but requires approval despite annotations", name => {
    expect(classifyWorkIQTool({ name, annotations: {
      readOnlyHint: true, destructiveHint: false, idempotentHint: true,
    } })).toMatchObject({ mode: "action", autoApprovable: false });
  });

  it.each(actions)("queues the exact %s payload without dispatching before approval", async name => {
    const args = { path: "/fixture", jsonBody: '{"subject":"fixture"}' };
    const dispatch = vi.fn();
    const stage = vi.fn(() => ({ id: 7, toolName: name, args, state: "pending", submittedAt: 0 }));
    const submit = vi.fn();
    const host = {
      serverName: "WorkIQ", endpoint: WORKIQ_ENDPOINT, scope: {},
      findTool: async () => classifyWorkIQTool({ name }),
      stageAction: stage, discardStagedAction() {}, call: dispatch,
      actionKindFor: () => ({ tag: `workiq:${name}`, label: name }),
    } as unknown as McpSessionHost;
    const session = new McpSessionBase(host, { submitAction: submit } as never);
    await expect(session.callTool(name, args)).resolves.toMatchObject({ status: "pending", actionId: 7 });
    expect(stage).toHaveBeenCalledWith(name, args);
    expect(submit).toHaveBeenCalledOnce();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("preserves binary structured content and tool error details after an authorized read", async () => {
    const result = { content: [], structuredContent: { bytes: "aGk=" }, isError: true };
    const authorize = vi.fn();
    const host = {
      serverName: "WorkIQ", endpoint: WORKIQ_ENDPOINT, scope: {},
      findTool: async () => classifyWorkIQTool({ name: "fetch_blob" }),
      call: async (fn: (client: unknown) => unknown) => fn({ callTool: async () => result }),
    } as unknown as McpSessionHost;
    const session = new McpSessionBase(host, { authorizeObservation: authorize } as never);
    await expect(session.callTool("fetch_blob", { path: "/fixture/content" })).resolves.toMatchObject({
      status: "ok", structuredContent: { bytes: "aGk=" }, isError: true,
    });
    expect(authorize).toHaveBeenCalledOnce();
  });

  it("returns no data when observation authorization refuses", async () => {
    const host = {
      serverName: "WorkIQ", endpoint: WORKIQ_ENDPOINT, scope: {},
      findTool: async () => classifyWorkIQTool({ name: "fetch" }),
      call: async (fn: (client: unknown) => unknown) => fn({ callTool: async () => ({ content: [] }) }),
    } as unknown as McpSessionHost;
    const session = new McpSessionBase(host, {
      authorizeObservation() { throw new Error("observer denied"); },
    } as never);
    await expect(session.callTool("fetch", { paths: ["/fixture"] })).rejects.toThrow("observer denied");
  });
});
