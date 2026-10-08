import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "jsonc-parser";
import { assertProductionPrerequisites } from "./production-preflight.ts";
import type { DeploymentConfig } from "./deployment-config.ts";

const production = parse(await readFile("deployment.jsonc", "utf8")) as DeploymentConfig;
const zone = { id: "423dd6e3814250bf304de8812e22ce4a", name: "knoxi.dev", status: "active",
  account: { id: "2ddaede0fbdd479a6bf410a5f1eb76ad" } };

function inventory(url: URL): unknown {
  if (url.pathname === "/client/v4/zones") return [zone];
  if (url.pathname.endsWith("/workers/routes")) return [{ pattern: "private-route-fixture" }];
  if (url.pathname.endsWith("/deployments")) return { deployments: [
    { id: "old", created_on: "2026-09-01", versions: [{ version_id: "old-version", percentage: 100 }] },
    { id: "current", created_on: "2026-10-01", author_email: "private-author-fixture",
      annotations: { private: "private-annotation-fixture" },
      versions: [{ version_id: "current-version", percentage: 100 }] },
  ] };
  if (url.pathname.endsWith("/secrets")) return url.pathname.includes("gatekeeper-workiq/")
    ? [{ name: "WORKIQ_CLIENT_ID" }, { name: "WORKIQ_CLIENT_SECRET" }]
    : [{ name: "CLIENT_ID" }, { name: "CLIENT_SECRET" }];
  throw new Error("Unexpected inventory endpoint.");
}

test("production preflight uses the release token for only approved GET endpoints and retains no private metadata", async () => {
  const calls: string[] = [];
  const evidence = await assertProductionPrerequisites(production, "fixture-token", async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.cloudflare.com");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.deepEqual(init?.headers, { Authorization: "Bearer fixture-token" });
    assert.ok(init?.signal);
    calls.push(url.pathname);
    if (url.pathname === "/client/v4/zones") {
      assert.equal(url.searchParams.get("name"), "knoxi.dev");
      assert.equal(url.searchParams.get("account.id"), production.accountId);
    }
    return Response.json({ success: true, result: inventory(url) });
  });
  assert.equal(calls.length, 12);
  assert.equal(calls[1], `/client/v4/zones/${zone.id}/workers/routes`);
  assert.equal(evidence.zoneReadable, true);
  assert.equal(evidence.routeInventoryReadable, true);
  assert.equal(Object.keys(evidence.workers).length, 8);
  assert.deepEqual(evidence.workers["knox-os-gatekeeper-workiq"], {
    deploymentId: "current", versions: [{ versionId: "current-version", percentage: 100 }],
  });
  assert.doesNotMatch(JSON.stringify(evidence), /private-|fixture-token/);
});

test("production preflight refuses changed identities and storage before remote reads", async () => {
  for (const mutate of [
    (c: DeploymentConfig) => { c.workers.gatekeeperWorkIQ!.name += "-spare"; },
    (c: DeploymentConfig) => { c.workers.router.route.customDomain = "os-staging.knoxi.dev"; },
    (c: DeploymentConfig) => { c.context.kvNamespaceId = null; },
    (c: DeploymentConfig) => { c.resources.avatarsKvNamespaceId = "different-resource"; },
    (c: DeploymentConfig) => { c.access.admins.push("other@example.test"); },
    (c: DeploymentConfig) => { c.access.audience = "different-audience"; },
  ]) {
    const config = structuredClone(production); mutate(config);
    await assert.rejects(() => assertProductionPrerequisites(config, "fixture-token", async () => {
      assert.fail("Unexpected remote read.");
    }), /differs from the approved/);
  }
  await assert.rejects(() => assertProductionPrerequisites(production, "", async () => {
    assert.fail("Unexpected remote read.");
  }), /Missing production release token/);
});

test("production refuses wrong zone ownership and masks HTTP, transport and JSON diagnostics", async () => {
  for (const result of [[], [zone, zone], [{ ...zone, id: "other-zone" }],
    [{ ...zone, account: { id: "other-account" } }], [{ ...zone, status: "pending" }]]) {
    await assert.rejects(() => assertProductionPrerequisites(production, "fixture-token",
      async () => Response.json({ success: true, result })), /Production zone-read preflight failed/);
  }
  for (const fetcher of [
    async () => new Response("private HTTP fixture", { status: 403 }),
    async () => { throw new Error("private transport fixture"); },
    async () => new Response("private JSON fixture"),
  ]) {
    await assert.rejects(() => assertProductionPrerequisites(production, "fixture-token", fetcher),
      (error: unknown) => error instanceof Error && error.message.startsWith("Production zone-read preflight failed;") &&
        !error.message.includes("fixture"));
  }
});

test("route-read failure stops before Worker inventory, rather than failing after code upload", async () => {
  const calls: string[] = [];
  await assert.rejects(() => assertProductionPrerequisites(production, "fixture-token", async input => {
    const url = new URL(String(input)); calls.push(url.pathname);
    return url.pathname.endsWith("/workers/routes") ? new Response("private route fixture", { status: 403 })
      : Response.json({ success: true, result: inventory(url) });
  }), /Production route-read preflight failed/);
  assert.equal(calls.length, 2);
});

test("missing WorkIQ identity stops before any credential inventory", async () => {
  const calls: string[] = [];
  await assert.rejects(() => assertProductionPrerequisites(production, "fixture-token", async input => {
    const url = new URL(String(input)); calls.push(url.pathname);
    return Response.json({ success: true, result: url.pathname.includes("gatekeeper-workiq/deployments")
      ? { deployments: [] } : inventory(url) });
  }), /Production Worker knox-os-gatekeeper-workiq is not ready/);
  assert.ok(!calls.some(path => path.endsWith("/secrets")));
});

test("production requires a confidential WorkIQ credential, not just the public client ID", async () => {
  await assert.rejects(() => assertProductionPrerequisites(production, "fixture-token", async input => {
    const url = new URL(String(input));
    return Response.json({ success: true, result: url.pathname.includes("gatekeeper-workiq/secrets")
      ? [{ name: "WORKIQ_CLIENT_ID" }] : inventory(url) });
  }), /knox-os-gatekeeper-workiq credential names/);
});

test("protected production workflow matches SHA and runs read-only prerequisites before deployment", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");
  assert.match(workflow, /name: production/);
  assert.match(workflow, /needs: check/);
  assert.match(workflow, /APPROVED_SHA: \$\{\{ inputs.approved_sha \}\}/);
  assert.ok(workflow.indexOf("node scripts/production-preflight.ts") < workflow.indexOf("pnpm deploy"));
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /path: production-preflight.json/);
});
