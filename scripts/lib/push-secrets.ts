/**
 * Pushes secrets to a Cloudflare Worker via the per-secret PUT endpoint.
 *
 * Ported unchanged from Reviewer's `apps/agents/scripts/lib/push-secrets.ts` (itself ported from
 * Knoxi Apps' `bulk-set-secrets.ts`): same tested idempotent upsert loop -- re-running recovers
 * from a partial failure -- same error shape, without the multi-app env-manifest and
 * wrangler-vars-scanning machinery that script sits behind, which this repo doesn't need.
 */

export interface PushSecretsInput {
  accountId: string;
  scriptName: string;
  apiToken: string;
  secrets: Record<string, string>;
}

export interface PushSecretsResult {
  ok: boolean;
  written: number;
  errors: Array<{ name: string; error: string }>;
}

interface CloudflareEnvelope {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: unknown[];
  result: unknown;
}

function formatCloudflareError(status: number, bodyText: string): string {
  if (!bodyText.trim()) return `HTTP ${status}`;

  try {
    const envelope = JSON.parse(bodyText) as Partial<CloudflareEnvelope>;
    const details = envelope.errors
      ?.map((error) => (error.code ? `${error.code}: ${error.message}` : error.message))
      .filter(Boolean)
      .join("; ");

    return details ? `HTTP ${status}, ${details}` : `HTTP ${status}`;
  } catch {
    return `HTTP ${status}, ${bodyText.slice(0, 500)}`;
  }
}

export async function pushSecrets(input: PushSecretsInput): Promise<PushSecretsResult> {
  const { accountId, scriptName, apiToken, secrets } = input;
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/secrets`;

  const errors: Array<{ name: string; error: string }> = [];
  const entries = Object.entries(secrets);
  let isFirstCall = true;

  for (const [name, text] of entries) {
    let response: Response;

    try {
      response = await fetch(baseUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, text, type: "secret_text" }),
      });
    } catch (err) {
      if (isFirstCall) throw err;
      errors.push({ name, error: String(err) });
      isFirstCall = false;
      continue;
    }

    if (response.status === 404 && isFirstCall) {
      throw new Error(
        `Worker script "${scriptName}" not found. Check that the worker has been deployed at least once.`,
      );
    }

    if (!response.ok) {
      const bodyText = await response.text();
      const message =
        response.status === 404
          ? "script not found (404)"
          : formatCloudflareError(response.status, bodyText);
      errors.push({ name, error: message });
      isFirstCall = false;
      continue;
    }

    let envelope: CloudflareEnvelope;
    try {
      envelope = (await response.json()) as CloudflareEnvelope;
    } catch {
      errors.push({ name, error: "failed to parse response JSON" });
      isFirstCall = false;
      continue;
    }

    if (!envelope.success) {
      const detail = envelope.errors.map((e) => e.message).join("; ") || "unknown error";
      errors.push({ name, error: detail });
      isFirstCall = false;
      continue;
    }

    console.log(`  ok ${name}`);
    isFirstCall = false;
  }

  return {
    ok: errors.length === 0,
    written: entries.length - errors.length,
    errors,
  };
}
