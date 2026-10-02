import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parse } from "jsonc-parser";
import { approvedReleaseConfig, deploymentSummary, isAccessChallenge } from "./staging-workflow.ts";
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
  assert.match(workflow, /if: always\(\) && !cancelled\(\)/);
  assert.match(workflow, /retention-days: 30/);
});
