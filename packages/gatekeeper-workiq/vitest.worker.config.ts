import { readFileSync } from "node:fs";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import capnwebValidate from "capnweb-validate/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [{
    name: "workiq-skill-text",
    load(id) {
      if (id.endsWith("/skill.md")) return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
    },
  }, capnwebValidate(), cloudflareTest({
    main: "./__tests__/worker.ts",
    miniflare: {
      compatibilityDate: "2026-09-04",
      compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_compat"],
      bindings: { BASE_URL: "https://stage.example/gatekeeper/workiq", WORKIQ_CLIENT_ID: "fixture-client" },
      durableObjects: {
        MCP_ACCOUNT: { className: "McpAccount", useSQLite: true },
        MCP_GATEKEEPER: { className: "McpGatekeeperImpl", useSQLite: true },
        TEST_HOOKS: { className: "TestHooks", useSQLite: true },
      },
    },
  })],
  test: { include: ["__tests__/workerd/*.test.ts"], setupFiles: ["../../cloudflare-os/scripts/assert-workerd.ts"] },
});
