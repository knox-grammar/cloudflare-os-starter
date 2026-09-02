import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import capnwebValidate from "capnweb-validate/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    capnwebValidate(),
    cloudflareTest({
      main: "./__tests__/worker.ts",
      miniflare: {
        compatibilityDate: "2026-08-04",
        compatibilityFlags: ["allow_irrevocable_stub_storage", "nodejs_compat"],
        bindings: {
          TENANT_ID: "test-tenant",
          CLIENT_ID: "test-client",
          CLIENT_SECRET: "test-secret",
          SHAREPOINT_ASSIGNED_SITE_URL: "https://knoxnswedu.sharepoint.com/sites/digital-utilities",
        },
        durableObjects: {
          USER_ACCOUNT: { className: "UserAccount", useSQLite: true },
          SHAREPOINT_GATEKEEPER: {
            className: "SharePointDocumentGatekeeperImpl",
            useSQLite: true,
          },
          TEST_HOOKS: { className: "TestHooks", useSQLite: true },
        },
      },
    }),
  ],
  test: {
    include: ["__tests__/workerd/*.test.ts"],
    setupFiles: ["../../cloudflare-os/scripts/assert-workerd.ts"],
  },
});
