import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parse } from "jsonc-parser";
import { approvedReleaseConfig, assertStagingPrerequisites, deploymentSummary, isAccessChallenge, stagingProbePaths } from "./staging-workflow.ts";
import type { DeploymentConfig } from "./deployment-config.ts";

test("workflow enables only public release in memory and requires pinned storage", async () => {
  const staging = parse(await readFile("deployment.staging.jsonc", "utf8")) as DeploymentConfig;
  const production = parse(await readFile("deployment.jsonc", "utf8")) as DeploymentConfig;
  const approved = approvedReleaseConfig(staging, production);
  assert.equal(approved.staging!.releaseReady, true);
  assert.equal(approved.staging!.bootstrapReady, false);
  assert.equal(staging.staging!.releaseReady, false);
  staging.context.kvNamespaceId = null;
  assert.throws(() => approvedReleaseConfig(staging, production), /Pin all four/);
  staging.staging!.bootstrapReady = true;
  assert.throws(() => approvedReleaseConfig(staging, production), /must be closed/);
});

test("staging preflight refuses WorkIQ without its own registered client credential", async () => {
  const staging = parse(await readFile("deployment.staging.jsonc", "utf8")) as DeploymentConfig;
  staging.workers.gatekeeperWorkIQ = { name: "knox-os-staging-gatekeeper-workiq" };
  assert.throws(() => assertStagingPrerequisites(staging, {
    deployments: () => [{ id: "existing", versions: [{ version_id: "v1", percentage: 100 }] }],
    secrets: name => name === staging.workers.gatekeeperMicrosoft.name
      ? [{ name: "CLIENT_ID" }, { name: "CLIENT_SECRET" }] : [],
  }), /WorkIQ credential names/);
});

test("staging preflight requires every existing identity before checking credentials", async () => {
  const staging = parse(await readFile("deployment.staging.jsonc", "utf8")) as DeploymentConfig;
  const credentialReads: string[] = [];
  assert.throws(() => assertStagingPrerequisites(staging, {
    deployments: name => name === staging.workers.gatekeeperWorkIQ!.name ? []
      : [{ id: "existing", versions: [{ version_id: "v1", percentage: 100 }] }],
    secrets: name => { credentialReads.push(name); return []; },
  }), /knox-os-staging-gatekeeper-workiq is not ready/);
  assert.deepEqual(credentialReads, []);
});

test("staging preflight supports registered public clients and the unchanged Graph-only stack", async () => {
  const staging = parse(await readFile("deployment.staging.jsonc", "utf8")) as DeploymentConfig;
  const credentialReads: string[] = [];
  const inventory = {
    deployments: () => [{ id: "existing", versions: [{ version_id: "v1", percentage: 100 }] }],
    secrets: (name: string) => {
      credentialReads.push(name);
      return name === staging.workers.gatekeeperMicrosoft.name
        ? [{ name: "CLIENT_ID" }, { name: "CLIENT_SECRET" }]
        : [{ name: "WORKIQ_CLIENT_ID" }];
    },
  };
  assert.doesNotThrow(() => assertStagingPrerequisites(staging, inventory));
  assert.deepEqual(credentialReads, ["knox-os-staging-gatekeeper-microsoft", "knox-os-staging-gatekeeper-workiq"]);
  delete staging.workers.gatekeeperWorkIQ;
  credentialReads.length = 0;
  assert.doesNotThrow(() => assertStagingPrerequisites(staging, inventory));
  assert.deepEqual(credentialReads, ["knox-os-staging-gatekeeper-microsoft"]);
});

test("unavailable or malformed credential inventory is refused without remote diagnostics", async () => {
  const staging = parse(await readFile("deployment.staging.jsonc", "utf8")) as DeploymentConfig;
  for (const secrets of [() => null, () => [null, {}], () => ({ name: "CLIENT_ID" }),
    () => { throw new Error("private remote diagnostic fixture"); }]) {
    assert.throws(() => assertStagingPrerequisites(staging, {
      deployments: () => [{ id: "existing", versions: [{ version_id: "v1", percentage: 100 }] }], secrets,
    }), (error: unknown) => error instanceof Error &&
      error.message === "Staging Microsoft credential names are missing or could not be verified.");
  }
});

test("Access evidence includes WorkIQ only when its private Worker is configured", async () => {
  const staging = parse(await readFile("deployment.staging.jsonc", "utf8")) as DeploymentConfig;
  assert.deepEqual(stagingProbePaths(staging), ["/", "/admin", "/api", "/gatekeeper/microsoft/oauth", "/gatekeeper/workiq/oauth"]);
  delete staging.workers.gatekeeperWorkIQ;
  assert.deepEqual(stagingProbePaths(staging), ["/", "/admin", "/api", "/gatekeeper/microsoft/oauth"]);
});

test("deployment evidence picks latest and omits author and annotations", () => {
  const record = deploymentSummary([
    { id: "new", created_on: "2026-09-29", author_email: "private@example.test",
      annotations: { sensitive: "not retained" }, versions: [{ version_id: "v2", percentage: 100 }] },
    { id: "old", created_on: "2026-09-28", versions: [{ version_id: "v1", percentage: 100 }] },
  ]);
  assert.deepEqual(record, { deploymentId: "new", versions: [{ versionId: "v2", percentage: 100 }] });
  assert.throws(() => deploymentSummary([]), /No deployments/);
  assert.throws(() => deploymentSummary([{ id: "bad", versions: [{}] }]), /Malformed version/);
});

test("Access probe requires HTTPS redirect to the exact team login path", () => {
  assert.equal(isAccessChallenge(302, "https://knoxgrammar.cloudflareaccess.com/cdn-cgi/access/login/test"), true);
  for (const location of [null, "/login", "https://evil.test/cdn-cgi/access/login",
    "http://knoxgrammar.cloudflareaccess.com/cdn-cgi/access/login",
    "https://knoxgrammar.cloudflareaccess.com/unrelated"]) {
    assert.equal(isAccessChallenge(302, location), false);
  }
  assert.equal(isAccessChallenge(200, "https://knoxgrammar.cloudflareaccess.com/cdn-cgi/access/login"), false);
});

test("combined workflow checks PRs but only main push/manual runs request staging approval", async () => {
  const workflow = await readFile(".github/workflows/check.yml", "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:\n    branches: \[main\]/);
  assert.match(workflow, /github.event_name == 'push' \|\| github.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /staging-preflight:\n    needs: check/);
  assert.match(workflow, /deploy:\n    needs: staging-preflight/);
  assert.match(workflow, /deploy:\n    needs: staging-preflight\n    concurrency:/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.equal((workflow.match(/run: pnpm check\n/g) ?? []).length, 1);
  assert.equal((workflow.match(/run: pnpm check:staging\n/g) ?? []).length, 1);
  assert.equal((workflow.match(/ref: \$\{\{ github.sha \}\}/g) ?? []).length, 2);
  assert.doesNotMatch(workflow, /inputs.approved_sha/);
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /name: staging/);
  assert.match(workflow, /secrets.STAGING_CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(workflow, /secrets.CLOUDFLARE_API_TOKEN|name: production|pnpm deploy\n/);
  assert.match(workflow, /required_reviewers/);
  assert.equal((workflow.match(/node scripts\/prepare-workiq.ts/g) ?? []).length, 2);
  assert.match(workflow, /pnpm run types:scripts/);
  assert.match(workflow, /pnpm --filter @knox\/gatekeeper-workiq run types:check/);
  assert.match(workflow, /Secret-name presence and anonymous Access redirects do not prove connector readiness/);
  assert.match(workflow, /if: always\(\) && !cancelled\(\)/);
  assert.match(workflow, /retention-days: 30/);
});
