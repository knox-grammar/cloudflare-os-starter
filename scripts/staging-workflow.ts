import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { parse } from "jsonc-parser";
import { assertStagingDeploymentReady, assertStagingIsolation } from "./deploy.ts";
import type { DeploymentConfig } from "./deployment-config.ts";

export function approvedReleaseConfig(staging: DeploymentConfig, production: DeploymentConfig): DeploymentConfig {
  assertStagingIsolation(staging, production);
  if (staging.staging!.bootstrapReady || staging.staging!.releaseReady) {
    throw new Error("Tracked staging mutation gates must be closed.");
  }
  const approved = structuredClone(staging);
  approved.staging!.releaseReady = true;
  assertStagingDeploymentReady(approved, false);
  return approved;
}

export function deploymentSummary(raw: unknown): { deploymentId: string; versions: unknown[] } {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("No deployments found.");
  // Wrangler lists deployments in ascending date order; select the latest explicitly.
  const latest = raw.toSorted((a, b) => String(b.created_on).localeCompare(String(a.created_on)))[0];
  if (typeof latest.id !== "string" || !Array.isArray(latest.versions) || !latest.versions.length) {
    throw new Error("Malformed deployment evidence.");
  }
  return { deploymentId: latest.id, versions: latest.versions.map((version: any) => {
    if (typeof version.version_id !== "string" || typeof version.percentage !== "number") {
      throw new Error("Malformed version evidence.");
    }
    return { versionId: version.version_id, percentage: version.percentage };
  }) };
}

export function isAccessChallenge(status: number, location: string | null): boolean {
  if (![302, 303, 307, 308].includes(status) || !location) return false;
  try {
    const url = new URL(location);
    return url.protocol === "https:" && url.hostname === "knoxgrammar.cloudflareaccess.com" &&
      url.pathname.startsWith("/cdn-cgi/access/login");
  } catch { return false; }
}

function command(args: string[]): string {
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8", timeout: 60_000 });
  // Never propagate API responses or stderr into the evidence artifact.
  if (result.error || result.status !== 0) throw new Error("Read-only inventory command failed.");
  return result.stdout.trim();
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (!["deploy", "evidence"].includes(mode) || process.argv.length !== 3) {
    throw new Error("Usage: node scripts/staging-workflow.ts deploy|evidence");
  }
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== "refs/heads/main" ||
      process.env.GITHUB_REPOSITORY !== "knox-grammar/cloudflare-os-starter") {
    throw new Error("This entrypoint requires the approved main-branch GitHub workflow.");
  }
  if (process.env.CLOUDFLARE_ACCOUNT_ID !== "2ddaede0fbdd479a6bf410a5f1eb76ad" ||
      !process.env.CLOUDFLARE_API_TOKEN) throw new Error("Missing approved staging account/token.");
  const original = await readFile("deployment.staging.jsonc", "utf8");
  const staging = parse(original, [], { allowTrailingComma: true }) as DeploymentConfig;
  const production = parse(await readFile("deployment.jsonc", "utf8"), [],
    { allowTrailingComma: true }) as DeploymentConfig;
  const approved = approvedReleaseConfig(staging, production);
  if (mode === "deploy") {
    // This workflow updates an existing stack, never bootstraps missing Workers or credentials.
    for (const worker of Object.values(staging.workers)) {
      deploymentSummary(JSON.parse(command(["pnpm", "exec", "wrangler", "deployments", "list",
        "--name", worker.name, "--json"])));
    }
    const secrets = JSON.parse(command(["pnpm", "exec", "wrangler", "secret", "list",
      "--name", staging.workers.gatekeeperMicrosoft!.name]));
    if (!["CLIENT_ID", "CLIENT_SECRET"].every(name => secrets.some((entry: any) => entry.name === name))) {
      throw new Error("Staging Microsoft credential names are missing.");
    }
    try {
      await writeFile("deployment.staging.jsonc", JSON.stringify(approved, null, 2) + "\n");
      const result = spawnSync("pnpm", ["deploy:staging"], { stdio: "inherit" });
      if (result.error || result.status !== 0) throw new Error("Staging deployment failed; do not retry automatically.");
    } finally { await writeFile("deployment.staging.jsonc", original); }
    return;
  }
  const evidence: Record<string, any> = {
    sourceSha: command(["git", "rev-parse", "HEAD"]),
    submoduleSha: command(["git", "-C", "cloudflare-os", "rev-parse", "HEAD"]),
    runId: process.env.GITHUB_RUN_ID,
    accountId: staging.accountId,
    hostname: "os-staging.knoxi.dev",
    workers: {}, probes: [], manualVerification: "pending", migrationRehearsal: "not-proven",
  };
  let failed = false;
  for (const worker of Object.values(staging.workers)) {
    try {
      evidence.workers[worker.name] = deploymentSummary(JSON.parse(command([
        "pnpm", "exec", "wrangler", "deployments", "list", "--name", worker.name, "--json",
      ])));
    } catch { evidence.workers[worker.name] = { error: "inventory-failed" }; failed = true; }
  }
  for (const path of ["/", "/admin", "/api", "/gatekeeper/microsoft/oauth"]) {
    try {
      const response = await fetch("https://os-staging.knoxi.dev" + path,
        { redirect: "manual", signal: AbortSignal.timeout(20_000) });
      const protectedByAccess = isAccessChallenge(response.status, response.headers.get("location"));
      evidence.probes.push({ path, status: response.status, protectedByAccess });
      await response.body?.cancel();
      if (!protectedByAccess) failed = true;
    } catch { evidence.probes.push({ path, error: "probe-failed" }); failed = true; }
  }
  await writeFile("staging-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
  if (failed) throw new Error("Staging evidence contains failures; inspect the sanitized artifact.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
