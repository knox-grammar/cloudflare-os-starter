import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Miniflare, convertV4MiniflareOptions, type ModuleDefinition } from "miniflare";

const directory = resolve(".wrangler/dry-run");
const modules: ModuleDefinition[] = [
  { type: "ESModule", path: resolve(directory, "workiq.js") },
  ...readdirSync(directory).filter(name => /\.(svg|txt|md)$/.test(name)).map(name => ({
    type: "Text" as const, path: resolve(directory, name),
  })),
];
const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [
  {
    name: "inspect", modules: true, compatibilityDate: "2026-09-04",
    script: `export default {async fetch(request, env) {
      const types = await env.VENDOR.getTypeScriptTypes();
      const resources = await env.VENDOR.getSupportedResources();
      return Response.json({nativeTypes: types.includes("McpCallResult"), resources: resources.length});
    }}`,
    serviceBindings: { VENDOR: { name: "workiq", entrypoint: "GatekeeperVendor" } },
  },
  {
    name: "workiq", modulesRoot: directory, modules, compatibilityDate: "2026-09-04",
    compatibilityFlags: ["allow_irrevocable_stub_storage", "global_fetch_strictly_public"],
    durableObjects: {
      MCP_ACCOUNT: { className: "McpAccount", useSQLite: true },
      MCP_GATEKEEPER: { className: "McpGatekeeperImpl", useSQLite: true },
    },
    bindings: { BASE_URL: "https://fixture.example/gatekeeper/workiq", WORKIQ_CLIENT_ID: "fixture-client" },
  },
] }));
try {
  const response = await runtime.dispatchFetch("https://fixture.example/");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { nativeTypes: true, resources: 1 });
  console.log("PASS: actual production bundle startup and inherited native RPC");
} finally {
  await runtime.dispose();
}
