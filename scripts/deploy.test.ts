import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse, type ParseError } from "jsonc-parser";
import {
  aiGatewayPlan,
  assertMicrosoftIsolation,
  assertStagingDeploymentReady,
  assertStagingIsolation,
  assertSubmoduleCommit,
  buildCommands,
  deploymentOrder,
  generateConfigs,
  parseDeploymentArgs,
  validateConfig,
} from "./deploy.ts";
import type {
  BaseConfigs,
  DeploymentConfig,
  GeneratedConfigs,
  ProdWranglerConfig,
} from "./deployment-config.ts";

const validConfig: DeploymentConfig = {
  accountId: "0123456789abcdef0123456789abcdef",
  publicBaseUrl: null,
  workers: {
    router: { name: "acme-cloudflare-os", route: { customDomain: "os.example.com" } },
    workshop: { name: "acme-cloudflare-os-backend" },
    context: { name: "acme-cloudflare-os-context" },
    scheduler: { name: "acme-cloudflare-os-scheduler" },
    customGatekeeper: { name: "acme-cloudflare-os-custom" },
    gatekeeperMicrosoft: { name: "acme-cloudflare-os-microsoft" },
    errorReporter: { name: "acme-cloudflare-os-errors" },
  },
  access: {
    issuer: "https://acme.cloudflareaccess.com",
    audience: "access-audience",
    admins: ["admin@example.com"],
  },
  aiGateway: {
    enabled: true,
    name: "cloudflare-os",
    accountId: null,
    providers: ["anthropic", "cloudflare"],
  },
  context: {
    sharingDomain: null,
    kvNamespaceId: "context-kv-id",
    artifacts: { enabled: true, namespace: "acme-context-collections" },
  },
  agent: { timeZone: "Australia/Sydney" },
  customGatekeeper: { name: "Acme", message: "Use the company handbook." },
  errorReporting: { enabled: true, environment: "production", release: "abc123" },
  resources: {
    blueprintsKvNamespaceId: "blueprints-kv-id",
    avatarsKvNamespaceId: "avatars-kv-id",
    blueprintContentBucket: "cloudflare-os-blueprints",
  },
  observability: {
    enabled: true,
    headSamplingRate: 0.5,
    logs: { invocationLogs: false },
    traces: { enabled: true, headSamplingRate: 0.25 },
  },
};

/**
 * A copy of {@link validConfig} with `mutate` applied, typed loosely on purpose.
 *
 * Most of these variants assign something `DeploymentConfig` forbids, which is exactly what
 * `validateConfig` exists to catch: `deployment.jsonc` is hand-edited JSONC with no schema behind
 * it, so the type describes the valid shape rather than guaranteeing what is on disk.
 */
function variant(mutate: (config: Record<string, any>) => void): DeploymentConfig {
  const config = structuredClone(validConfig) as Record<string, any>;
  mutate(config);
  return config as DeploymentConfig;
}

// Read from disk rather than inlined, including the Error Reporter's: deploy.ts derives every
// generated config from these files, so a copy here could drift from what actually ships.
async function baseConfigs(): Promise<BaseConfigs> {
  return {
    router: await baseConfig("../cloudflare-os/packages/router/wrangler.jsonc"),
    workshop: await baseConfig("../cloudflare-os/packages/workshop-backend/wrangler.jsonc"),
    context: await baseConfig("../cloudflare-os/packages/gatekeeper-context/wrangler.jsonc"),
    scheduler: await baseConfig("../cloudflare-os/packages/gatekeeper-scheduler/wrangler.jsonc"),
    customGatekeeper: await baseConfig("../packages/custom-gatekeeper/wrangler.jsonc"),
    gatekeeperMicrosoft: await baseConfig("../packages/gatekeeper-microsoft/wrangler.jsonc"),
    gatekeeperWorkIQ: await baseConfig("../packages/gatekeeper-workiq/wrangler.jsonc"),
    errorReporter: await baseConfig("../packages/error-reporter/wrangler.jsonc"),
  };
}

// Parsed the way `deploy.ts` parses it, errors included. Swallowing them would let a base config
// that the deploy cannot read still pass these tests on a best-effort parse -- which is how the
// Scheduler's trailing commas hid: nine parse errors, and a config object that still looked usable.
async function baseConfig(path: string): Promise<ProdWranglerConfig> {
  const errors: ParseError[] = [];
  const result = parse(
    await readFile(new URL(path, import.meta.url), "utf8"),
    errors,
    { allowTrailingComma: true },
  ) as ProdWranglerConfig;
  assert.deepEqual(errors, [], `${path} did not parse cleanly`);
  return result;
}

/** The Context data-isolation boundary carried by the Workshop's Gatekeeper binding. */
function sharingDomain(generated: GeneratedConfigs): unknown {
  return generated.workshop.services!
    .find((service) => service.binding === "GATEKEEPER_CONTEXT")!.props!.sharingDomain;
}

async function deploymentFile(path: string): Promise<DeploymentConfig> {
  const errors: ParseError[] = [];
  const config = parse(await readFile(new URL(path, import.meta.url), "utf8"),
    errors, { allowTrailingComma: true }) as DeploymentConfig;
  assert.deepEqual(errors, []);
  return config;
}

test("selects staging and private bootstrap explicitly", () => {
  assert.deepEqual(parseDeploymentArgs([]),
    { target: "production", check: false, bootstrap: false });
  assert.deepEqual(parseDeploymentArgs(["--target", "staging", "--check"]),
    { target: "staging", check: true, bootstrap: false });
  assert.deepEqual(parseDeploymentArgs(["--bootstrap", "--target", "staging", "--check"]),
    { target: "staging", check: true, bootstrap: true });
  assert.throws(() => parseDeploymentArgs(["--bootstrap"]), /only available for staging/);
  assert.throws(() => parseDeploymentArgs(["--bootstrap", "--target", "staging", "--bootstrap"]),
    /Unsupported deploy argument/);
  assert.throws(() => parseDeploymentArgs(["--target", "production"]), /Unsupported deploy argument/);
  assert.throws(() => parseDeploymentArgs(["--check", "--check"]), /Unsupported deploy argument/);
});

test("private bootstrap excludes Router while full deploy keeps it last", async () => {
  const staging = await deploymentFile("../deployment.staging.jsonc");
  assert.equal(staging.staging!.bootstrapReady, false);
  assert.equal(staging.staging!.releaseReady, false);
  assert.throws(() => assertStagingDeploymentReady(staging, true), /separate provisioning approval/);
  assert.throws(() => assertStagingDeploymentReady(staging, false), /blocked until Access/);
  const enabled = structuredClone(staging);
  enabled.staging!.bootstrapReady = true;
  assert.doesNotThrow(() => assertStagingDeploymentReady(enabled, true));
  enabled.staging!.releaseReady = true;
  enabled.context.kvNamespaceId = null;
  assert.throws(() => assertStagingDeploymentReady(enabled, false), /Pin all four/);
  enabled.context.kvNamespaceId = "stage-context-kv";
  enabled.resources.blueprintsKvNamespaceId = "stage-blueprints-kv";
  enabled.resources.avatarsKvNamespaceId = "stage-avatars-kv";
  enabled.resources.blueprintContentBucket = "stage-blueprint-bucket";
  assert.doesNotThrow(() => assertStagingDeploymentReady(enabled, false));
  assert.deepEqual(deploymentOrder(staging, true), [
    "errorReporter", "context", "scheduler", "customGatekeeper", "gatekeeperMicrosoft", "gatekeeperWorkIQ", "workshop",
  ]);
  assert.deepEqual(deploymentOrder(staging, false), [
    ...deploymentOrder(staging, true), "router",
  ]);
});

test("staging keeps all eight Workers and data bindings away from production", async () => {
  const production = await deploymentFile("../deployment.jsonc");
  const staging = await deploymentFile("../deployment.staging.jsonc");
  assert.doesNotThrow(() => assertStagingIsolation(staging, production));
  const bases = await baseConfigs();
  const prod = generateConfigs(production, bases);
  const stage = generateConfigs(staging, bases);
  const stageNames = new Set(Object.values(stage).map((worker) => worker.name));
  const prodNames = new Set(Object.values(prod).map((worker) => worker.name));
  assert.equal(stageNames.size, 8);
  assert.equal(prodNames.size, 7);
  assert.equal(prod.gatekeeperWorkIQ, undefined);
  assert.equal(stage.gatekeeperWorkIQ!.vars!.BASE_URL, "https://os-staging.knoxi.dev/gatekeeper/workiq");
  assert.deepEqual(stage.gatekeeperWorkIQ!.secrets!.required, ["WORKIQ_CLIENT_ID"]);
  for (const name of stageNames) assert.equal(prodNames.has(name), false);
  for (const service of [...stage.router.services!, ...stage.workshop.services!]) {
    assert.ok(stageNames.has(service.service), `binding ${service.binding} reached ${service.service}`);
  }
  assert.deepEqual(stage.router.routes, [{ pattern: "os-staging.knoxi.dev", custom_domain: true }]);
  assert.equal(stage.workshop.vars!.CF_ACCESS_AUD, staging.access.audience);
  assert.equal(stage.workshop.vars!.PUBLIC_BASE_URL, "https://os-staging.knoxi.dev");
  assert.equal(sharingDomain(stage), "https://os-staging.knoxi.dev");
  assert.deepEqual(stage.workshop.migrations, prod.workshop.migrations);
  assert.equal(stage.gatekeeperMicrosoft.vars!.TENANT_ID,
    prod.gatekeeperMicrosoft.vars!.TENANT_ID);
  assert.equal(stage.gatekeeperMicrosoft.vars!.SHAREPOINT_ASSIGNED_SITE_URL,
    prod.gatekeeperMicrosoft.vars!.SHAREPOINT_ASSIGNED_SITE_URL);
  assert.equal(stage.workshop.vars!.CF_AI_GATEWAY, "default");
  assert.equal(stage.workshop.vars!.CF_AI_GATEWAY, prod.workshop.vars!.CF_AI_GATEWAY);
  assert.equal(stage.gatekeeperMicrosoft.vars!.BASE_URL,
    "https://os-staging.knoxi.dev/gatekeeper/microsoft");
  assert.doesNotThrow(() => assertMicrosoftIsolation(stage.gatekeeperMicrosoft,
    prod.gatekeeperMicrosoft, true));
  for (const [key, worker] of Object.entries(stage)) {
    assert.equal(worker.preview_urls, false, `${key} has a public preview URL`);
    if (key !== "router") {
      assert.equal(worker.workers_dev, false);
      assert.equal(worker.routes, undefined);
    }
  }
  assert.deepEqual(stage.workshop.kv_namespaces!.map((kv) => kv.id), [
    staging.resources.blueprintsKvNamespaceId, staging.resources.avatarsKvNamespaceId,
  ]);
  assert.equal(stage.context.kv_namespaces![0].id, staging.context.kvNamespaceId);
  assert.equal(stage.workshop.r2_buckets![0].bucket_name,
    staging.resources.blueprintContentBucket);
});

test("staging refuses production trust, resource and Microsoft authority", async () => {
  const production = await deploymentFile("../deployment.jsonc");
  const staging = await deploymentFile("../deployment.staging.jsonc");
  const altered = (mutate: (config: DeploymentConfig) => void) => {
    const config = structuredClone(staging);
    mutate(config);
    return config;
  };
  for (const mutate of [
    (c: DeploymentConfig) => { c.workers.workshop.name = production.workers.workshop.name; },
    (c: DeploymentConfig) => { c.access.audience = production.access.audience; },
    (c: DeploymentConfig) => { c.access.admins.push("other@example.com"); },
    (c: DeploymentConfig) => { c.context.sharingDomain = "https://os.knoxi.dev"; },
    (c: DeploymentConfig) => { c.resources.blueprintContentBucket = "shared-bucket"; },
    (c: DeploymentConfig) => { c.staging!.sharedProductionMicrosoft = false; },
    (c: DeploymentConfig) => { c.staging!.sharedProductionAiGateway = false; },
  ]) {
    const config = altered(mutate);
    if (config.resources.blueprintContentBucket === "shared-bucket") {
      config.context.kvNamespaceId = "shared-bucket";
    }
    assert.throws(() => assertStagingIsolation(config, production));
  }
  assert.throws(() => validateConfig(altered((c) => {
    c.microsoft = { enabled: false, tenantId: "3b951541-2eca-412c-9d5f-ffb43008c700" };
  })), /Disabled Microsoft integration/);
  const enabled = altered((c) => {
    c.microsoft = {
      enabled: true,
      tenantId: "11111111-2222-3333-4444-555555555555",
      assignedSiteUrl: "https://example.sharepoint.com/sites/test-site",
    };
  });
  const bases = await baseConfigs();
  assert.throws(() => assertMicrosoftIsolation(
    generateConfigs(enabled, bases).gatekeeperMicrosoft,
    generateConfigs(production, bases).gatekeeperMicrosoft, true),
    /TENANT_ID disagrees with approved sharing mode/);
  enabled.microsoft!.tenantId = production.workers.gatekeeperMicrosoft.name;
  assert.throws(() => validateConfig(enabled), /tenant UUID/);
  enabled.microsoft!.tenantId = "3b951541-2eca-412c-9d5f-ffb43008c700";
  enabled.microsoft!.assignedSiteUrl = "https://knoxnswedu.sharepoint.com/sites/digital-utilities";
  assert.doesNotThrow(() => assertMicrosoftIsolation(
    generateConfigs(enabled, bases).gatekeeperMicrosoft,
    generateConfigs(production, bases).gatekeeperMicrosoft, true));
  assert.throws(() => assertMicrosoftIsolation(
    generateConfigs(enabled, bases).gatekeeperMicrosoft,
    generateConfigs(production, bases).gatekeeperMicrosoft, false),
    /TENANT_ID disagrees with approved sharing mode/);
});

test("requires the reviewed cloudflare-os gitlink", () => {
  assert.doesNotThrow(() => assertSubmoduleCommit("abc123", "abc123"));
  assert.throws(
    () => assertSubmoduleCommit("abc123", "def456"),
    /checked out at def456.*pins abc123.*git submodule update --init/s,
  );
});

test("rejects deployment placeholders", () => {
  assert.throws(
    () => validateConfig(variant((c) => { c.accountId = "<CLOUDFLARE_ACCOUNT_ID>"; })),
    /placeholder/i);
});

test("rejects destructive or malformed deployment values", () => {
  const duplicateWorkers = structuredClone(validConfig);
  duplicateWorkers.workers.context.name = duplicateWorkers.workers.workshop.name;
  assert.throws(() => validateConfig(duplicateWorkers), /unique/i);

  assert.throws(
    () => validateConfig(variant((c) => { c.observability.enabled = "true"; })), /boolean/i);

  assert.throws(
    () => validateConfig(variant((c) => {
      c.workers.router.route.customDomain = "os.example.com/path";
    })), /hostname/i);

  assert.throws(
    () => validateConfig(variant((c) => { c.context.sharingDomain = ""; })),
    /sharingDomain must be null or a non-empty string/i);

  assert.throws(
    () => validateConfig(variant((c) => { c.access.issuer += "/team"; })), /issuer.*origin/i);

  assert.throws(
    () => validateConfig(variant((c) => { c.access.audience = "   "; })), /audience/i);

  assert.throws(
    () => validateConfig(variant((c) => { c.access.audience = " access-audience "; })), /audience/i);

  assert.throws(
    () => validateConfig(variant((c) => { c.access.admins = ["bad-address"]; })), /email/i);

  assert.throws(
    () => validateConfig(variant((c) => {
      c.observability.traces.headSamplingRate = 2;
    })), /sampling/i);

  assert.throws(
    () => validateConfig(variant((c) => { c.context.artifacts.enabled = "true"; })),
    /Artifacts enabled.*boolean/i);

  assert.throws(
    () => validateConfig(variant((c) => { c.context.artifacts = null; })),
    /Artifacts configuration.*object/i);

  assert.throws(
    () => validateConfig(variant((c) => { c.context.artifacts = []; })),
    /Artifacts configuration.*object/i);

  assert.throws(
    () => validateConfig(variant((c) => { c.context.artifacts.namespace = null; })),
    /namespace must be omitted/i);

  assert.throws(
    () => validateConfig(variant((c) => { c.context.artifacts.namespace = "context/collections"; })),
    /namespace must be omitted/i);
});

test("rejects AI Gateway keys that no longer do anything", () => {
  // A silently-ignored workersAi block is how a deploy succeeds with an empty model picker.
  assert.throws(
    () => validateConfig(variant((c) => { c.aiGateway.workersAi = { mode: "gateway" }; })),
    /aiGateway\.workersAi does nothing/i);
  // Even with AI off: the key means the operator believes it still does something.
  assert.throws(
    () => validateConfig(variant((c) => {
      c.aiGateway = { enabled: false, workersAi: { mode: "direct" } };
    })),
    /aiGateway\.workersAi does nothing/i);
});

test("rejects malformed AI Gateway providers and account", () => {
  assert.throws(
    () => validateConfig(variant((c) => { c.aiGateway.providers = []; })),
    /Missing required deployment value: aiGateway.providers/);

  assert.throws(
    () => validateConfig(variant((c) => { c.aiGateway.providers = ["anthropic", "mistral"]; })),
    /providers must be a non-empty subset/i);

  assert.throws(
    () => validateConfig(variant((c) => { c.aiGateway.accountId = "not-an-account"; })),
    /aiGateway.accountId must be null or 32 hexadecimal/i);
});

test("generates Access-mode Workshop, Context, and custom Gatekeeper configs", async () => {
  const generated = generateConfigs(validConfig, await baseConfigs());
  const vars = generated.workshop.vars!;

  assert.equal(generated.workshop.name, "acme-cloudflare-os-backend");
  assert.deepEqual(vars.ADMINS, ["admin@example.com"]);
  assert.equal(vars.CF_ACCESS_ISS, validConfig.access.issuer);
  assert.equal(vars.CF_ACCESS_AUD, validConfig.access.audience);
  assert.equal(vars.PUBLIC_BASE_URL, "https://os.example.com");
  assert.equal(vars.AGENT_TIME_ZONE, "Australia/Sydney");
  assert.equal(vars.CF_AI_GATEWAY, "cloudflare-os");
  assert.equal(vars.CF_AI_GATEWAY_PROVIDERS, "anthropic,cloudflare");
  assert.deepEqual(generated.workshop.ai, { binding: "WORKERS_AI" });
  assert.deepEqual(generated.workshop.services, [
    {
      binding: "ERROR_REPORTER",
      service: "acme-cloudflare-os-errors",
      entrypoint: "ErrorReporter",
      props: {
        service: "acme-cloudflare-os-backend",
        environment: "production",
        release: "abc123",
      },
    },
    {
      binding: "GATEKEEPER_CONTEXT",
      service: "acme-cloudflare-os-context",
      entrypoint: "GatekeeperVendor",
      props: { sharingDomain: "https://os.example.com" },
    },
    {
      binding: "GATEKEEPER_SCHEDULER",
      service: "acme-cloudflare-os-scheduler",
      entrypoint: "GatekeeperVendor",
    },
    {
      binding: "GATEKEEPER_CUSTOM",
      service: "acme-cloudflare-os-custom",
      entrypoint: "GatekeeperVendor",
    },
    {
      binding: "GATEKEEPER_MICROSOFT",
      service: "acme-cloudflare-os-microsoft",
      entrypoint: "GatekeeperVendor",
    },
  ]);
  assert.deepEqual(generated.workshop.kv_namespaces, [
    { binding: "BLUEPRINTS", id: "blueprints-kv-id" },
    { binding: "AVATARS", id: "avatars-kv-id" },
  ]);
  assert.equal(generated.workshop.r2_buckets![0].bucket_name, "cloudflare-os-blueprints");
  assert.equal(generated.context.name, "acme-cloudflare-os-context");
  assert.equal(generated.context.kv_namespaces![0].id, "context-kv-id");
  assert.deepEqual(generated.context.artifacts, [{
    binding: "ARTIFACTS",
    namespace: "acme-context-collections",
  }]);
  assert.equal(generated.customGatekeeper.name, "acme-cloudflare-os-custom");
  assert.deepEqual(generated.customGatekeeper.vars, {
    CUSTOM_NAME: "Acme",
    CUSTOM_MESSAGE: "Use the company handbook.",
  });
  assert.equal(generated.errorReporter!.name, "acme-cloudflare-os-errors");
  assert.deepEqual(generated.workshop.observability!.logs, {
    invocation_logs: false,
  });
  assert.deepEqual(generated.workshop.observability!.traces, {
    enabled: true,
    head_sampling_rate: 0.25,
  });
  assert.equal(generated.workshop.services!.some(
    (service) => service.binding === "FRONTEND_ERROR_REPORTER"), false);
});

test("gives the router the public route, the frontend, and every service binding", async () => {
  const bases = await baseConfigs();
  const generated = generateConfigs(validConfig, bases);

  assert.equal(generated.router.name, "acme-cloudflare-os");
  assert.equal(generated.router.workers_dev, false);
  assert.deepEqual(generated.router.routes, [{ pattern: "os.example.com", custom_domain: true }]);
  // No entrypoint on any of the four: the router forwards whole HTTP requests rather than making
  // vendor RPC calls, and the binding name is what selects the /gatekeeper/<name> path.
  assert.deepEqual(generated.router.services, [
    { binding: "WORKSHOP_BACKEND", service: "acme-cloudflare-os-backend" },
    { binding: "GATEKEEPER_CONTEXT", service: "acme-cloudflare-os-context" },
    { binding: "GATEKEEPER_SCHEDULER", service: "acme-cloudflare-os-scheduler" },
    { binding: "GATEKEEPER_CUSTOM", service: "acme-cloudflare-os-custom" },
    { binding: "GATEKEEPER_MICROSOFT", service: "acme-cloudflare-os-microsoft" },
  ]);
  // Inherited untouched: the base config already carries the ASSETS binding, the SPA fallback, and
  // the /gatekeeper/* prefix an OAuth Gatekeeper redirect needs.
  assert.deepEqual(generated.router.assets, bases.router.assets);
  assert.equal(generated.router.assets!.binding, "ASSETS");
  assert.equal(generated.router.assets!.directory, "../workshop-frontend/dist");
  assert.ok(generated.router.assets!.run_worker_first!.includes("/gatekeeper/*"),
    JSON.stringify(generated.router.assets));
});

/**
 * The hosted deploy preinstalls this one on every fresh instance (`PREINSTALL` in
 * cloudflare-os/scripts/release/manifest-lib.ts), so a starter that skipped it would not be the same
 * topology: a migrated instance would show none of its existing schedules, and the
 * Durable Objects holding them would be orphaned behind a Worker nothing is bound to.
 */
test("deploys the ambient Scheduler Gatekeeper the hosted flow preinstalls", async () => {
  const bases = await baseConfigs();
  const generated = generateConfigs(validConfig, bases);

  assert.equal(generated.scheduler.name, "acme-cloudflare-os-scheduler");
  // Reached by both, for the two different things a Gatekeeper does: vendor RPC from the backend,
  // and whole HTTP requests under /gatekeeper/scheduler from the router.
  assert.deepEqual(
    generated.workshop.services!.find((service) => service.binding === "GATEKEEPER_SCHEDULER"),
    {
      binding: "GATEKEEPER_SCHEDULER",
      service: "acme-cloudflare-os-scheduler",
      entrypoint: "GatekeeperVendor",
    });
  assert.deepEqual(
    generated.router.services!.find((service) => service.binding === "GATEKEEPER_SCHEDULER"),
    { binding: "GATEKEEPER_SCHEDULER", service: "acme-cloudflare-os-scheduler" });

  // Its Durable Object history has to arrive verbatim: those classes are where the schedules live.
  assert.deepEqual(generated.scheduler.migrations, bases.scheduler.migrations);
  assert.ok(generated.scheduler.migrations!.length > 0, "scheduler lost its DO migrations");
  // No configuration surface of its own -- which is what makes it installable with no user input
  // upstream, and deployable here from nothing but a Worker name.
  assert.equal(generated.scheduler.vars, undefined);
  assert.equal(generated.scheduler.kv_namespaces, undefined);
  assert.equal(generated.scheduler.secrets, undefined);

  const builds = buildCommands(validConfig)
    .map(({ args }) => args)
    .filter((args) => args.includes("@gadgets/gatekeeper-scheduler"));
  assert.deepEqual(builds.map((args) => args.at(-1)), ["build:app", "build"]);
});

test("keeps every Worker behind the router off the public internet", async () => {
  const generated = generateConfigs(validConfig, await baseConfigs());
  const workers = Object.entries(generated) as [string, ProdWranglerConfig][];

  for (const [name, worker] of workers) {
    if (name !== "router") {
      assert.equal(worker.workers_dev, false, `${name} answers on workers.dev`);
      assert.equal(worker.routes, undefined, `${name} carries a public route`);
    }
    // A preview URL is an unauthenticated path around the Access-protected origin.
    assert.equal(worker.preview_urls, false, `${name} leaves preview URLs enabled`);
  }
  // The router serves the frontend, so the backend uploads no assets of its own.
  assert.equal(generated.workshop.assets, undefined);
});

test("scopes PUBLIC_BASE_URL and Context sharing to the public origin", async () => {
  const onWorkersDev = variant((c) => {
    c.workers.router.route = { workersDev: true };
    c.publicBaseUrl = "https://acme-cloudflare-os.acme.workers.dev";
  });

  const derived = generateConfigs(validConfig, await baseConfigs());
  const explicit = generateConfigs(onWorkersDev, await baseConfigs());

  assert.equal(derived.workshop.vars!.PUBLIC_BASE_URL, "https://os.example.com");
  assert.equal(
    explicit.workshop.vars!.PUBLIC_BASE_URL, "https://acme-cloudflare-os.acme.workers.dev");
  assert.equal(explicit.router.workers_dev, true);
  assert.equal(explicit.router.routes, undefined);

  // sharingDomain: null follows the public origin, which is what the hosted deploy sets it to.
  assert.equal(sharingDomain(derived), "https://os.example.com");
  assert.equal(sharingDomain(explicit), "https://acme-cloudflare-os.acme.workers.dev");

  // A pinned literal keeps the boundary stable across a hostname change, so it wins.
  const pinned = generateConfigs(
    variant((c) => { c.context.sharingDomain = "production"; }), await baseConfigs());
  assert.equal(sharingDomain(pinned), "production");
  assert.equal(pinned.workshop.vars!.PUBLIC_BASE_URL, "https://os.example.com");
});

test("rejects a public origin it cannot derive or cannot trust", async () => {
  // Nothing in deployment.jsonc names the account's workers.dev subdomain, and PUBLIC_BASE_URL and
  // the Context sharing boundary both need an origin, so this cannot be left to a fallback.
  assert.throws(
    () => validateConfig(variant((c) => { c.workers.router.route = { workersDev: true }; })),
    /publicBaseUrl is required on a workersDev route/i);

  // Scoping Context data to a hostname the deployment does not answer on hides its collections.
  assert.throws(
    () => validateConfig(variant((c) => { c.publicBaseUrl = "https://other.example.com"; })),
    /does not match workers.router.route.customDomain/i);

  assert.throws(
    () => validateConfig(variant((c) => { c.publicBaseUrl = "https://os.example.com/"; })),
    /HTTPS origin only/i);

  assert.throws(
    () => validateConfig(variant((c) => { c.publicBaseUrl = "http://os.example.com"; })),
    /HTTPS origin only/i);

  assert.throws(
    () => validateConfig(variant((c) => { delete c.publicBaseUrl; })),
    /publicBaseUrl must be present/i);
});

test("rejects a workersDev origin that is not the router's own", async () => {
  const onWorkersDev = (publicBaseUrl: string) => variant((c) => {
    c.workers.router.route = { workersDev: true };
    c.publicBaseUrl = publicBaseUrl;
  });

  // The account's workers.dev subdomain is unknowable here, but the rest of the hostname is not: a
  // typo in the Worker label, or an unrelated host, would silently become both PUBLIC_BASE_URL and
  // the Context isolation boundary.
  assert.throws(
    () => validateConfig(onWorkersDev("https://acme-cloudflare-o.acme.workers.dev")),
    /names Worker "acme-cloudflare-o", but the router is "acme-cloudflare-os"/);

  assert.throws(
    () => validateConfig(onWorkersDev("https://os.example.com")),
    /not a workers.dev origin/i);

  // A deeper name is a preview URL or an unrelated host, not the route wrangler serves.
  assert.throws(
    () => validateConfig(onWorkersDev("https://staging.acme-cloudflare-os.acme.workers.dev")),
    /not a workers.dev origin/i);

  // The shape wrangler actually serves stays valid, whatever the account subdomain is.
  const generated = generateConfigs(
    onWorkersDev("https://acme-cloudflare-os.some-account.workers.dev"), await baseConfigs());
  assert.equal(
    generated.workshop.vars!.PUBLIC_BASE_URL, "https://acme-cloudflare-os.some-account.workers.dev");

  // The rule is scoped to the workersDev route. A custom domain has its own hostname, unrelated to
  // any Worker name, and is checked against `customDomain` instead -- both spellings stay valid.
  assert.equal(
    validateConfig(variant((c) => { c.publicBaseUrl = "https://os.example.com"; })).publicBaseUrl,
    "https://os.example.com");
  assert.equal(validateConfig(validConfig).publicBaseUrl, null);
});

test("routes AI Gateway over the Workers AI binding without an API token", async () => {
  const generated = generateConfigs(validConfig, await baseConfigs());
  const vars = generated.workshop.vars!;

  assert.equal(vars.CF_AI_GATEWAY_ACCOUNT_ID, validConfig.accountId);
  // Absent, not "true": the backend takes the binding whenever it is bound, and the binding is
  // pre-authenticated inside the deployment's own account.
  assert.equal(vars.CF_AI_GATEWAY_USE_BINDING, undefined);
  assert.equal(generated.workshop.secrets, undefined);
  assert.deepEqual(aiGatewayPlan(validConfig), {
    gatewayAccountId: validConfig.accountId,
    crossAccount: false,
    needsToken: false,
    tokenReasons: [],
  });
});

test("requires a token for a gateway in another account", async () => {
  const config = variant((c) => { c.aiGateway.accountId = "fedcba9876543210fedcba9876543210"; });
  const generated = generateConfigs(config, await baseConfigs());
  const vars = generated.workshop.vars!;

  assert.equal(vars.CF_AI_GATEWAY_ACCOUNT_ID, "fedcba9876543210fedcba9876543210");
  assert.equal(vars.CF_AI_GATEWAY_USE_BINDING, "false");
  assert.deepEqual(generated.workshop.secrets, { required: ["CF_AI_GATEWAY_API_TOKEN"] });
  // The Workers AI binding stays bound: webFetch's toMarkdown() runs on it too.
  assert.deepEqual(generated.workshop.ai, { binding: "WORKERS_AI" });
  assert.equal(aiGatewayPlan(config)!.tokenReasons.length, 1);
});

test("treats a differently-cased account ID as the same account", async () => {
  const config = variant((c) => { c.aiGateway.accountId = c.accountId.toUpperCase(); });
  const generated = generateConfigs(config, await baseConfigs());

  // Same account written two ways, which the hex pattern accepts: the binding reaches this gateway,
  // so no CF_AI_GATEWAY_USE_BINDING opt-out and no token.
  assert.equal(generated.workshop.vars!.CF_AI_GATEWAY_ACCOUNT_ID, validConfig.accountId);
  assert.equal(generated.workshop.vars!.CF_AI_GATEWAY_USE_BINDING, undefined);
  assert.equal(generated.workshop.secrets, undefined);
  assert.equal(aiGatewayPlan(config)!.crossAccount, false);
  assert.deepEqual(aiGatewayPlan(config)!.tokenReasons, []);
});

test("requires a token for the google provider", async () => {
  const config = variant((c) => { c.aiGateway.providers = ["cloudflare", "google"]; });
  const generated = generateConfigs(config, await baseConfigs());

  assert.deepEqual(generated.workshop.secrets, { required: ["CF_AI_GATEWAY_API_TOKEN"] });
  // Same account, so the binding still carries every other provider.
  assert.equal(generated.workshop.vars!.CF_AI_GATEWAY_USE_BINDING, undefined);
  assert.match(aiGatewayPlan(config)!.tokenReasons[0], /google/i);
});

test("omits disabled backend error reporting", async () => {
  const config = variant((c) => {
    c.errorReporting = { enabled: false, environment: "<ENVIRONMENT>", release: "<RELEASE>" };
  });

  const generated = generateConfigs(config, await baseConfigs());

  assert.equal(generated.errorReporter, undefined);
  assert.equal(generated.workshop.services!.some(
    (service) => service.binding === "ERROR_REPORTER"), false);
});

test("omits dormant AI Gateway configuration", async () => {
  const config = variant((c) => {
    c.aiGateway = {
      enabled: false,
      name: "<AI_GATEWAY_NAME>",
      accountId: "<AI_GATEWAY_ACCOUNT_ID>",
      providers: [],
    };
  });

  const generated = generateConfigs(config, await baseConfigs());
  const vars = generated.workshop.vars!;

  assert.equal(vars.CF_AI_GATEWAY, undefined);
  assert.equal(vars.CF_AI_GATEWAY_ACCOUNT_ID, undefined);
  assert.equal(vars.CF_AI_GATEWAY_PROVIDERS, undefined);
  assert.equal(generated.workshop.secrets, undefined);
  // Still bound: it is what webFetch's toMarkdown() runs on, independent of the model catalog.
  assert.deepEqual(generated.workshop.ai, { binding: "WORKERS_AI" });
  assert.equal(aiGatewayPlan(config), null);
});

test("uses the default Context Artifacts namespace when omitted", async () => {
  const config = variant((c) => { delete c.context.artifacts.namespace; });

  const generated = generateConfigs(config, await baseConfigs());

  assert.deepEqual(generated.context.artifacts, [{
    binding: "ARTIFACTS",
    namespace: "gatekeeper-context-collections",
  }]);
});

test("omits disabled Context Artifacts configuration", async () => {
  const config = variant((c) => { c.context.artifacts = {}; });
  const bases = await baseConfigs();
  bases.context.artifacts = [{ binding: "ARTIFACTS", namespace: "upstream-default" }];

  const generated = generateConfigs(config, bases);

  assert.equal(generated.context.artifacts, undefined);
});

test("defaults Context Artifacts to disabled when configuration is omitted", async () => {
  const config = variant((c) => { delete c.context.artifacts; });

  const generated = generateConfigs(config, await baseConfigs());

  assert.equal(generated.context.artifacts, undefined);
});

test("generates binding-only storage for automatic provisioning", async () => {
  const config = variant((c) => {
    c.context.kvNamespaceId = null;
    c.resources = {
      blueprintsKvNamespaceId: null,
      avatarsKvNamespaceId: null,
      blueprintContentBucket: null,
    };
  });

  const generated = generateConfigs(config, await baseConfigs());

  assert.deepEqual(generated.workshop.kv_namespaces, [
    { binding: "BLUEPRINTS" },
    { binding: "AVATARS" },
  ]);
  assert.deepEqual(generated.workshop.r2_buckets, [{ binding: "BLUEPRINT_CONTENT" }]);
  assert.deepEqual(generated.context.kv_namespaces, [{ binding: "CONTEXT_COLLECTIONS" }]);
});

/**
 * The equivalent, for this repository, of upstream's `deploy-scripts.test.ts`. That one
 * auto-discovers per-package `deploy` scripts; here deploying is centralised in `deploy.ts`, so the
 * same invariant has to be asserted against the commands it spawns.
 *
 * Both halves are silent failures: a replayed cache hit and a dropped build-time flag each exit
 * zero and each still deploy.
 */
test("never lets a deploy replay a cached build artifact", () => {
  const commands = buildCommands(validConfig);
  assert.ok(commands.length > 0, "expected at least one build command");
  for (const { args } of commands) {
    const command = args.join(" ");
    // `pnpm --filter <pkg> build` cannot see a Vite+ task, and two of the three submodule targets
    // are now tasks rather than scripts. `vp run` runs both.
    assert.ok(command.includes("vp run"),
      `build step does not go through vp run: ${command}`);
    assert.ok(command.includes("--no-cache"),
      `build step runs a vp task while deploying without --no-cache: ${command}\n` +
      "Deploys must not replay a cached artifact -- add --no-cache.");
    // Everything after the task specifier is forwarded to the task's own command, so a trailing
    // flag reaches `tsc` as an unknown option instead of reaching vp.
    assert.ok(args.indexOf("--no-cache") < args.indexOf("run") + 4,
      `--no-cache must precede the task name, not follow it: ${command}`);
  }
});

test("rebuilds the Context configurator app rather than replaying it", () => {
  // `gatekeeper-context`'s `build` script spawns `vp run --cache build:app` of its own, which the
  // outer --no-cache does not reach. Without this step a deploy ships whatever app.txt the cache
  // last archived.
  const context = buildCommands(validConfig)
    .map(({ args }) => args)
    .filter((args) => args.includes("@gadgets/gatekeeper-context"));
  assert.deepEqual(context.map((args) => args.at(-1)), ["build:app", "build"]);
  assert.ok(context.every((args) => args.at(-2) === "--no-cache"), context.join("\n"));
});

test("passes VITE_CF_ACCESS_MODE explicitly rather than inheriting it", () => {
  const withAccessMode = buildCommands(validConfig).filter(({ env }) => env);
  assert.deepEqual(withAccessMode.map(({ env }) => env), [{ VITE_CF_ACCESS_MODE: "true" }]);
  // It has to reach the frontend, which inlines it into the bundle, and nothing else.
  assert.match(withAccessMode[0].args.join(" "), /@gadgets\/workshop-frontend/);
});

test("builds the frontend before the router", () => {
  const order = buildCommands(validConfig).map(({ args }) => args.join(" "));
  const frontend = order.findIndex((command) => command.includes("workshop-frontend"));
  const router = order.findIndex((command) => command.includes("@gadgets/router"));
  // The router deploy picks up ../workshop-frontend/dist as its assets.
  assert.ok(frontend >= 0 && router >= 0 && frontend < router, order.join("\n"));
});

test("skips the Error Reporter build when error reporting is disabled", () => {
  const config = variant((c) => {
    c.errorReporting = { enabled: false, environment: "<ENVIRONMENT>", release: null };
  });
  const commands = buildCommands(config).map(({ args }) => args.join(" "));
  assert.equal(commands.some((command) => command.includes("error-reporter")), false);
});

test("WorkIQ is absent by default and optional bindings use the fixed hosted callback", async () => {
  const bases = { ...await baseConfigs(),
    gatekeeperWorkIQ: await baseConfig("../packages/gatekeeper-workiq/wrangler.jsonc") };
  const original = generateConfigs(validConfig, bases);
  assert.equal(original.gatekeeperWorkIQ, undefined);
  assert.ok(!original.router.services?.some(binding => binding.binding === "GATEKEEPER_WORKIQ"));
  const config = variant(value => { value.workers.gatekeeperWorkIQ = { name: "acme-workiq" }; });
  const generated = generateConfigs(config, bases) as GeneratedConfigs & { gatekeeperWorkIQ: ProdWranglerConfig };
  assert.equal(generated.gatekeeperWorkIQ.name, "acme-workiq");
  assert.equal(generated.gatekeeperWorkIQ.vars?.BASE_URL, "https://os.example.com/gatekeeper/workiq");
  assert.deepEqual(generated.gatekeeperWorkIQ.secrets?.required, ["WORKIQ_CLIENT_ID"]);
  assert.ok(generated.router.services?.some(binding => binding.binding === "GATEKEEPER_WORKIQ" && binding.service === "acme-workiq" && !binding.entrypoint));
  assert.ok(generated.workshop.services?.some(binding => binding.binding === "GATEKEEPER_WORKIQ" && binding.entrypoint === "GatekeeperVendor"));
  assert.deepEqual(generated.gatekeeperMicrosoft, original.gatekeeperMicrosoft);
  assert.ok(deploymentOrder(config, true).includes("gatekeeperWorkIQ" as keyof GeneratedConfigs));
  assert.equal(deploymentOrder(config, false).at(-1), "router");
  assert.ok(buildCommands(config).some(command => command.args.includes("@knox/gatekeeper-workiq")));
});

test("WorkIQ activation requires a base config and an isolated Worker identity", async () => {
  const config = variant(value => { value.workers.gatekeeperWorkIQ = { name: "acme-workiq" }; });
  assert.throws(() => generateConfigs(config, {} as BaseConfigs), /WorkIQ base config/);
  const duplicate = variant(value => { value.workers.gatekeeperWorkIQ = { name: value.workers.gatekeeperMicrosoft.name }; });
  assert.throws(() => validateConfig(duplicate), /unique/);
  const staging = await deploymentFile("../deployment.staging.jsonc");
  const production = await deploymentFile("../deployment.jsonc");
  (staging.workers as Record<string, unknown>).gatekeeperWorkIQ = { name: "knox-os-workiq" };
  (production.workers as Record<string, unknown>).gatekeeperWorkIQ = { name: "knox-os-workiq" };
  assert.throws(() => assertStagingIsolation(staging, production), /WorkIQ.*isolated/);
});
