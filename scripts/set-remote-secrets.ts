/**
 * Pushes one Worker's production secrets to Cloudflare from 1Password.
 *
 * A `.prod.env` file (tracked in git, safe to commit) holds `op://` references, not raw values,
 * one line per secret. Loading it never touches disk for the decoded values: each reference is
 * resolved live through the 1Password SDK and pushed straight to Cloudflare.
 *
 * Requires OP_SERVICE_ACCOUNT_TOKEN, CLOUDFLARE_API_TOKEN, and CLOUDFLARE_ACCOUNT_ID in the
 * environment. CLOUDFLARE_API_TOKEN must be a real Cloudflare API token (Account -> Workers
 * Scripts -> Edit is enough) -- not the interactive `wrangler login` OAuth session, which isn't
 * meant for unattended/scripted use. Scope it to the account, or to the specific Worker if the
 * token type supports per-resource scoping.
 *
 * Run this after the target Worker has been deployed at least once -- the per-secret endpoint
 * needs the script to already exist -- never before.
 *
 * Usage:
 *   node scripts/set-remote-secrets.ts <worker-script-name> <path-to-.prod.env>
 *
 * Example, for this repo's Microsoft gatekeeper:
 *   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... OP_SERVICE_ACCOUNT_TOKEN=... \
 *     node scripts/set-remote-secrets.ts knox-os-gatekeeper-microsoft \
 *     packages/gatekeeper-microsoft/.prod.env
 *
 * Ported from Reviewer's (and, before that, Knoxi Apps') set-remote-secrets.ts, generalized to
 * take the script name and env file as arguments rather than hardcoding one Worker: this repo
 * deploys several, and different Workers need different secrets at different times -- only
 * gatekeeper-microsoft needs CLIENT_ID/CLIENT_SECRET right now; the AI Gateway token, when a
 * configuration needs one at all, goes on the Workshop instead (see
 * docs/customization.md#ai-models).
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@1password/sdk";
import { pushSecrets } from "./lib/push-secrets.ts";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

interface EncodedSecret {
  key: string;
  encodedValue: string;
}

function parseEnvFile(text: string): EncodedSecret[] {
  const secrets: EncodedSecret[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const [key, ...valueParts] = trimmed.split("=");
    const encodedValue = valueParts.join("=").trim();
    if (!key?.trim() || !encodedValue) continue;

    secrets.push({ key: key.trim(), encodedValue });
  }
  return secrets;
}

async function main() {
  const [scriptName, envFileArg] = process.argv.slice(2);
  if (!scriptName || !envFileArg) {
    throw new Error(
      "Usage: node scripts/set-remote-secrets.ts <worker-script-name> <path-to-.prod.env>");
  }
  const envFilePath = resolve(process.cwd(), envFileArg);

  const opToken = requireEnv("OP_SERVICE_ACCOUNT_TOKEN");
  const apiToken = requireEnv("CLOUDFLARE_API_TOKEN");
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");

  let envFileText: string;
  try {
    envFileText = await readFile(envFilePath, "utf8");
  } catch {
    throw new Error(`Could not read ${envFilePath}`);
  }
  const encodedSecrets = parseEnvFile(envFileText);
  console.log(`Loaded ${encodedSecrets.length} secret reference(s) from ${envFilePath}`);

  const client = await createClient({
    auth: opToken,
    integrationName: "cloudflare-os-starter",
    integrationVersion: "0.0.1",
  });

  const secrets: Record<string, string> = {};
  for (const { key, encodedValue } of encodedSecrets) {
    secrets[key] = encodedValue.startsWith("op://")
      ? await client.secrets.resolve(encodedValue)
      : encodedValue;
  }

  console.log(`Setting ${Object.keys(secrets).length} secret(s) on ${scriptName}...`);
  const result = await pushSecrets({ accountId, scriptName, apiToken, secrets });

  if (!result.ok) {
    for (const { name, error } of result.errors) {
      console.error(`  failed ${name}: ${error}`);
    }
    throw new Error(
        `${result.errors.length} of ${result.written + result.errors.length} secrets failed`);
  }
  console.log(`${result.written} secret(s) set.`);
}

await main();
