import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse, type ParseError } from "jsonc-parser";
import { publicOrigin, validateConfig } from "./deploy.ts";
import { deploymentSummary } from "./staging-workflow.ts";
import type { DeploymentConfig } from "./deployment-config.ts";

const accountId = "2ddaede0fbdd479a6bf410a5f1eb76ad";
const zoneId = "423dd6e3814250bf304de8812e22ce4a";
const workerNames = {
  router: "knox-os",
  workshop: "knox-os-workshop",
  context: "knox-os-context",
  scheduler: "knox-os-scheduler",
  customGatekeeper: "knox-os-gatekeeper",
  gatekeeperMicrosoft: "knox-os-gatekeeper-microsoft",
  gatekeeperWorkIQ: "knox-os-gatekeeper-workiq",
  errorReporter: "knox-os-error-reporter",
} as const;

export async function assertProductionPrerequisites(config: DeploymentConfig, token: string,
  fetcher: typeof fetch = fetch): Promise<{
    zoneReadable: true;
    routeInventoryReadable: true;
    workers: Record<string, ReturnType<typeof deploymentSummary>>;
  }> {
  validateConfig(config);
  if (config.accountId !== accountId || publicOrigin(config) !== "https://os.knoxi.dev" ||
      config.staging !== undefined || config.microsoft !== undefined ||
      config.access.issuer !== "https://knoxgrammar.cloudflareaccess.com" ||
      config.access.audience !== "8623541e237ab1d2eee15a213ba7539c45e20f9e8f922c62aa6f78571c9fad6a" ||
      JSON.stringify(config.access.admins) !== JSON.stringify(["carrickm@knox.nsw.edu.au"]) ||
      Object.keys(config.workers).length !== Object.keys(workerNames).length ||
      Object.entries(workerNames).some(([key, name]) =>
        config.workers[key as keyof typeof workerNames]?.name !== name) ||
      config.context.kvNamespaceId !== "41215b18a40b4d0e83ecd44efb1d8cde" ||
      config.resources.blueprintsKvNamespaceId !== "44cfaa3b0d634752abac0bfb7dd111fc" ||
      config.resources.avatarsKvNamespaceId !== "2e8610c47a5c4d0198a9d4c04d7645a7" ||
      config.resources.blueprintContentBucket !== "knox-os-workshop-blueprint-content") {
    throw new Error("Production configuration differs from the approved identities/storage; review it before release.");
  }
  if (!token) throw new Error("Missing production release token.");

  async function get(path: string, message: string): Promise<unknown> {
    try {
      const response = await fetcher(`https://api.cloudflare.com/client/v4${path}`, {
        method: "GET", redirect: "error", headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error("Read refused."); }
      const raw = await response.json() as { success?: boolean; result?: unknown };
      if (raw?.success !== true || raw.result === undefined) throw new Error("Malformed inventory.");
      return raw.result;
    } catch {
      // API diagnostics and credentials must never become CI logs or retained evidence.
      throw new Error(message);
    }
  }

  const zoneError = "Production zone-read preflight failed; verify the release token's access to the approved knoxi.dev zone before deploying.";
  const zones = await get(`/zones?name=knoxi.dev&account.id=${accountId}`, zoneError);
  const zone = Array.isArray(zones) ? zones[0] : undefined;
  if (!Array.isArray(zones) || zones.length !== 1 || zone?.id !== zoneId ||
      zone.name !== "knoxi.dev" || zone.status !== "active" || zone.account?.id !== accountId) {
    throw new Error(zoneError);
  }
  // Wrangler reads zone routes during target reconciliation, after code upload otherwise.
  // Read access is a prerequisite, not proof of route-write authority or isolated zone scope.
  const routeError = "Production route-read preflight failed; verify release-token access before uploading any Worker.";
  if (!Array.isArray(await get(`/zones/${zoneId}/workers/routes`, routeError))) {
    throw new Error(routeError);
  }
  const workers: Record<string, ReturnType<typeof deploymentSummary>> = {};
  for (const name of Object.values(workerNames)) {
    const message = `Production Worker ${name} is not ready; provision or reconcile it separately.`;
    const raw = await get(`/accounts/${accountId}/workers/scripts/${name}/deployments`, message) as
      { deployments?: unknown } | null;
    try { workers[name] = deploymentSummary(raw?.deployments); }
    catch { throw new Error(message); }
  }
  for (const requirement of [
    { name: workerNames.gatekeeperMicrosoft, names: ["CLIENT_ID", "CLIENT_SECRET"] },
    { name: workerNames.gatekeeperWorkIQ, names: ["WORKIQ_CLIENT_ID", "WORKIQ_CLIENT_SECRET"] },
  ]) {
    const message = `Production Worker ${requirement.name} credential names are missing or could not be verified.`;
    const raw = await get(`/accounts/${accountId}/workers/scripts/${requirement.name}/secrets`, message);
    if (!Array.isArray(raw) || !requirement.names.every(name =>
      raw.some(entry => entry !== null && typeof entry === "object" && entry.name === name))) {
      throw new Error(message);
    }
  }
  return { zoneReadable: true, routeInventoryReadable: true, workers };
}

async function main(): Promise<void> {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (process.argv.length !== 2 || process.env.GITHUB_ACTIONS !== "true" ||
      process.env.GITHUB_REF !== "refs/heads/main" ||
      process.env.GITHUB_REPOSITORY !== "knox-grammar/cloudflare-os-starter" ||
      process.env.GITHUB_SHA !== head || process.env.APPROVED_SHA !== head ||
      process.env.CLOUDFLARE_ACCOUNT_ID !== accountId) {
    throw new Error("Production preflight requires the approved exact-SHA main-branch workflow.");
  }
  const evidence: Record<string, unknown> = {
    sourceSha: head, accountId, hostname: "os.knoxi.dev",
    runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    passed: false,
  };
  try {
    const errors: ParseError[] = [];
    const config = parse(await readFile("deployment.jsonc", "utf8"), errors,
      { allowTrailingComma: true }) as DeploymentConfig;
    if (errors.length) throw new Error("Production configuration did not parse cleanly.");
    Object.assign(evidence, await assertProductionPrerequisites(config,
      process.env.CLOUDFLARE_API_TOKEN ?? ""), { passed: true });
    console.log("Production read-only prerequisites passed; no Worker has been uploaded yet.");
  } finally {
    await writeFile("production-preflight.json", JSON.stringify(evidence, null, 2) + "\n");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error((error as Error).message);
    console.error("Production preflight failed; no upload was started.");
    process.exitCode = 1;
  });
}
