import { env, runInDurableObject, SELF } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KNOX_TENANT, WORKIQ_ENDPOINT, WORKIQ_SCOPE } from "../../src/policy.js";

const tools = ["fetch", "fetch_blob", "get_schema", "search_paths", "list_agents", "ask",
  "create_entity", "update_entity", "delete_entity", "do_action", "call_function", "future_tool"];
let dispatched: { name: string; arguments: unknown }[] = [];
let failWrite = false;
let tokenRequests: URLSearchParams[] = [];
let oversizedCatalog = false;

beforeEach(() => {
  dispatched = []; failWrite = false; tokenRequests = []; oversizedCatalog = false;
  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
    if (String(_url).includes("/.well-known/oauth-protected-resource")) {
      return Response.json({ resource: WORKIQ_ENDPOINT });
    }
    if (String(_url).endsWith("/oauth2/v2.0/token")) {
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      return Response.json({ access_token: "fresh-fixture-token", refresh_token: "fixture-refresh", token_type: "Bearer", expires_in: 3600 });
    }
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    const message = JSON.parse(String(init?.body));
    if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
    let result: unknown;
    if (message.method === "initialize") result = {
      protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "WorkIQ", version: "fixture" },
    };
    if (message.method === "tools/list") result = { tools: (oversizedCatalog
      ? [...Array.from({ length: 6 }, (_, i) => `padding_${i}`), "create_entity"] : tools).map(name => ({
      name, description: name, inputSchema: { type: "object",
        ...(name.startsWith("padding_") ? { description: "x".repeat(18_000) } : {}) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    })) };
    if (message.method === "tools/call") {
      dispatched.push(message.params);
      if (failWrite) throw new Error("fixture connection lost after dispatch");
      result = { content: [{ type: "text", text: "fixture" }], structuredContent: { fixture: true } };
    }
    return Response.json({ jsonrpc: "2.0", id: message.id, result });
  });
});
afterEach(() => vi.unstubAllGlobals());

async function account() {
  const id = env.MCP_ACCOUNT.newUniqueId();
  await runInDurableObject(env.MCP_ACCOUNT.get(id), (_instance, state) => {
    state.storage.kv.put("server", { endpoint: WORKIQ_ENDPOINT, serverId: "workiq",
      serverName: "WorkIQ", provenance: "deployment", auth: "oauth" });
    state.storage.kv.put("tokens", { access_token: "fixture-token", token_type: "Bearer", expiresAt: Date.now() + 3600000 });
  });
  return id.toString();
}
const hooks = env.TEST_HOOKS.getByName("hooks");

it("exposes every operation in listing, exact lookup, search and generated methods", async () => {
  const catalog = await hooks.catalog("catalog", await account());
  expect(catalog.all.map((t: { name: string }) => t.name)).toEqual(tools);
  expect(catalog.found[0].mode).toBe("action");
  expect(catalog.searched[0].mode).toBe("action");
  for (const name of tools) expect(catalog.types).toContain(`"${name}"`);
  expect(catalog.observations).toBe(3);
  expect(dispatched).toHaveLength(0);
});

it("keeps an annotated mutation approval-gated through both truncated-catalog lookup paths", async () => {
  oversizedCatalog = true;
  const catalog = await hooks.catalog("truncated", await account(), "create_entity");
  expect(catalog.all.length).toBeLessThan(6);
  expect(catalog.all.map((tool: { name: string }) => tool.name)).not.toContain("create_entity");
  for (const entries of [catalog.found, catalog.searched]) {
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: "create_entity", mode: "action" });
  }
  expect(dispatched).toHaveLength(0);
});

it.each(["ask", "create_entity", "update_entity", "delete_entity", "do_action", "call_function", "future_tool"])("dispatches approved %s once with the exact payload", async tool => {
    const args = { path: "/fixture", jsonBody: '{"fixture":true}' };
    const id = await account();
    const name = `apply-${tool}`;
    const outcome = await hooks.execute(name, id, tool, args, "approve", false);
    expect(outcome.result).toMatchObject({ status: "ok", structuredContent: { fixture: true } });
    expect(dispatched).toEqual([{ name: tool, arguments: args }]);
    expect(outcome.auto).toEqual([]);
    await hooks.replay(name, id, 1);
    expect(dispatched).toHaveLength(1);
  });

it("does not dispatch pending or rejected calls", async () => {
  for (const decision of ["pending", "reject"] as const) {
    const outcome = await hooks.execute(decision, await account(), "delete_entity", { path: "/fixture" }, decision, false);
    expect(outcome.result.status).toBe(decision === "reject" ? "rejected" : "pending");
  }
  expect(dispatched).toHaveLength(0);
});

it("dispatches generated named mutation methods through approval", async () => {
  const outcome = await hooks.execute("named", await account(), "createEntity", { path: "/fixture" }, "approve", true);
  expect(outcome.result.status).toBe("ok");
  expect(dispatched[0].name).toBe("create_entity");
});

it("keeps an ambiguous action failed and does not replay it", async () => {
  failWrite = true;
  const id = await account();
  const outcome = await hooks.execute("unknown", id, "update_entity", { path: "/fixture" }, "approve", false);
  expect(outcome.result.status).toBe("failed");
  expect(dispatched).toHaveLength(1);
  await hooks.replay("unknown", id, 1);
  expect(dispatched).toHaveLength(1);
});

it("refuses tools outside a named grant and refuses another observer", async () => {
  const id = await account();
  expect((await hooks.execute("scoped", id, "delete_entity", {}, "approve", false, ["fetch"])).error)
    .toMatch(/does not grant/);
  expect(await hooks.observer("private", id)).toMatch(/only be opened by its owner/s);
  expect(dispatched).toHaveLength(0);
});

it("records structured reads as observations without approval", async () => {
  const result = await hooks.execute("read", await account(), "fetch", { paths: ["/fixture"] }, "pending", false);
  expect(result.result.status).toBe("ok");
  expect(result.observations).toHaveLength(1);
  expect(result.actions).toHaveLength(0);
});


it("refreshes expired WorkIQ credentials without an RFC 8707 resource parameter", async () => {
  const id = await account();
  const connected = env.MCP_ACCOUNT.get(env.MCP_ACCOUNT.idFromString(id));
  const issuer = `https://login.microsoftonline.com/${KNOX_TENANT}/v2.0`;
  await runInDurableObject(connected, (_instance, context) => {
    context.storage.kv.put("tokens", { access_token: "expired-fixture-token", refresh_token: "fixture-refresh",
      token_type: "Bearer", expiresAt: 0, issuer });
    context.storage.kv.put("oauthClient", { client_id: "fixture-client", token_endpoint_auth_method: "none", issuer });
    context.storage.kv.put("oauthDiscovery", { authorizationServerUrl: issuer,
      authorizationServerMetadata: { issuer, token_endpoint: `https://login.microsoftonline.com/${KNOX_TENANT}/oauth2/v2.0/token`,
        token_endpoint_auth_methods_supported: ["none"] },
      resourceMetadata: { resource: WORKIQ_ENDPOINT } });
  });
  expect((await connected.getConnection(WORKIQ_ENDPOINT)).authorization).toBe("fresh-fixture-token");
  expect(tokenRequests).toHaveLength(1);
  expect(tokenRequests[0].get("grant_type")).toBe("refresh_token");
  expect(tokenRequests[0].get("refresh_token")).toBe("fixture-refresh");
  expect(tokenRequests[0].get("client_id")).toBe("fixture-client");
  expect(tokenRequests[0].has("resource")).toBe(false);
  expect((await connected.getConnection(WORKIQ_ENDPOINT)).authorization).toBe("fresh-fixture-token");
  expect(tokenRequests).toHaveLength(1);
});

it("starts hosted registered-client OAuth, redeems once and stages reconnect without replacing live tokens", async () => {
  const id = env.MCP_ACCOUNT.newUniqueId();
  const nonce = await hooks.initiate(id.toString());
  const start = await SELF.fetch(`https://stage.example/gatekeeper/workiq/${id}/${nonce}`, { redirect: "manual" });
  expect(start.status).toBe(302);
  const url = new URL(start.headers.get("location")!);
  expect(url.origin + url.pathname).toBe(`https://login.microsoftonline.com/${KNOX_TENANT}/oauth2/v2.0/authorize`);
  expect(url.searchParams.get("client_id")).toBe("fixture-client");
  expect(url.searchParams.get("scope")).toBe(WORKIQ_SCOPE);
  expect(url.searchParams.get("redirect_uri")).toBe("https://stage.example/gatekeeper/workiq/oauth");
  const state = url.searchParams.get("state")!.split(":")[1];
  const issuer = `https://login.microsoftonline.com/${KNOX_TENANT}/v2.0`;
  expect(await hooks.finish(id.toString(), state, issuer)).toHaveProperty("ticket");
  expect(await hooks.finish(id.toString(), state, issuer)).toBeNull();
  const connectedAccount = env.MCP_ACCOUNT.get(id);
  const readToken = () => runInDurableObject(connectedAccount, (_instance, context) =>
    context.storage.kv.get<{ access_token: string }>("tokens")?.access_token);
  expect(await readToken()).toBe("fresh-fixture-token");
  await runInDurableObject(connectedAccount, (_instance, context) => {
    context.storage.kv.put("tokens", { access_token: "old-fixture-token", token_type: "Bearer", expiresAt: Date.now() + 3600000 });
  });
  const reconnectNonce = "b".repeat(64);
  await connectedAccount.prepareReconnect(reconnectNonce);
  const reconnect = await SELF.fetch(`https://stage.example/gatekeeper/workiq/${id}/${reconnectNonce}`, { redirect: "manual" });
  const reconnectState = new URL(reconnect.headers.get("location")!).searchParams.get("state")!.split(":")[1];
  const handoff = await hooks.finish(id.toString(), reconnectState, issuer);
  expect(await readToken()).toBe("old-fixture-token");
  await connectedAccount.commitReconnect(handoff!.ticket);
  expect(await readToken()).toBe("fresh-fixture-token");
});
