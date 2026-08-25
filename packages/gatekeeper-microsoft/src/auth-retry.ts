// Shared fetch helper for the Microsoft gatekeeper's API clients.
//
// Ported unchanged from gatekeeper-google/src/auth-retry.ts -- nothing in this file is
// Google-specific. See that copy's header comment for the full reasoning; summarized here:
//
//   1. Auth (401). The cached access token can be stale or invalidated before its recorded expiry.
//      On a 401 we mint a fresh token via `getAccessToken({ forceRefresh: true })` and retry
//      exactly once. Safe on any HTTP method: a 401 is rejected before the request takes effect.
//   2. Transient failures (429 / 5xx / network timeout). Retried with exponential backoff plus
//      full jitter, honoring `Retry-After` when present, on idempotent GETs only.

/**
 * Options for requesting an access token.
 *
 * `forceRefresh` means "do not serve me a cached token" -- the caller saw a 401, so any token
 * cached against its recorded expiry is known-bad.
 */
export type AccessTokenRequest = {
  forceRefresh?: boolean;
  /** The token the caller just had rejected. Never log this. */
  staleToken?: string;
};

export type AccessTokenProvider = (opts?: AccessTokenRequest) => Promise<string>;

export type FetchWithAuthRetryOptions = {
  /**
   * Total attempts for transient failures, including the first. Defaults to 3. The one-shot 401
   * refresh does not consume this budget, so the worst case is `retries + 1` requests.
   */
  retries?: number;
  /** Per-attempt abort timeout in milliseconds. Omitted means no timeout is imposed. */
  timeoutMs?: number;
};

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 10_000;

/**
 * Whether a transient failure status is worth replaying for this method.
 *
 * Neither a 429 nor a 5xx tells us whether the request took effect before the response, so both
 * are only replayed for idempotent GETs.
 */
function canRetry(status: number, method: string): boolean {
  if (status === 429 || (status >= 500 && status <= 599)) return method === "GET";
  return false;
}

function backoffDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    let seconds = parseInt(retryAfter, 10);
    if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, MAX_DELAY_MS);
  }
  let capped = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return Math.random() * capped;
}

/**
 * Perform an authenticated fetch, injecting a Bearer token and applying both retry concerns
 * described at the top of this file. The `Authorization` header is set from the (possibly
 * refreshed) token on every attempt, so callers must NOT set it themselves; any other headers in
 * `init.headers` are preserved.
 */
export async function fetchWithAuthRetry(
  url: string,
  init: RequestInit,
  getAccessToken: AccessTokenProvider,
  opts: FetchWithAuthRetryOptions = {},
): Promise<Response> {
  let method = (init.method ?? "GET").toUpperCase();
  let retries = opts.retries ?? 3;

  let replayable = init.body === undefined || init.body === null || typeof init.body === "string";

  let refreshed = false;
  let token = await getAccessToken();
  let attempt = 0;

  while (true) {
    let signals: AbortSignal[] = [];
    if (opts.timeoutMs !== undefined) signals.push(AbortSignal.timeout(opts.timeoutMs));
    if (init.signal) signals.push(init.signal);
    let signal = signals.length > 0 ? AbortSignal.any(signals) : undefined;

    let headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (replayable && method === "GET" && attempt < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, backoffDelayMs(attempt, null)));
        attempt++;
        continue;
      }
      throw error;
    }

    if (response.status === 401 && !refreshed && replayable) {
      refreshed = true;
      await response.body?.cancel();
      token = await getAccessToken({ forceRefresh: true, staleToken: token });
      continue;
    }

    if (replayable && canRetry(response.status, method) && attempt < retries - 1) {
      let delay = backoffDelayMs(attempt, response.headers.get("Retry-After"));
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
      continue;
    }

    return response;
  }
}

/**
 * How far ahead of an access token's recorded expiry we treat it as already expired, so a token
 * doesn't lapse mid-request. Shared by `AccessTokenCache` and `UserAccount.getAccessToken`, which
 * must agree -- otherwise the caching layer happily serves a token the authoritative layer would
 * already have replaced.
 */
export const ACCESS_TOKEN_EXPIRY_SAFETY_MS = 60 * 1000;

export type MintedAccessToken = { token: string; expires: Date };

export type MintAccessToken = (opts?: AccessTokenRequest) => Promise<MintedAccessToken>;

/**
 * Per-Durable-Object memo of the access token minted by the `UserAccount`, so a gatekeeper doesn't
 * pay an RPC on every API call. The token is re-minted once it is within `skewMs` of expiring, and
 * `forceRefresh` discards it outright -- which is what makes the 401 retry in `fetchWithAuthRetry`
 * able to heal a token that Microsoft invalidated ahead of its recorded expiry.
 */
export class AccessTokenCache {
  #cached: MintedAccessToken | undefined;
  #mint: MintAccessToken;
  #skewMs: number;

  constructor(mint: MintAccessToken, skewMs: number = ACCESS_TOKEN_EXPIRY_SAFETY_MS) {
    this.#mint = mint;
    this.#skewMs = skewMs;
  }

  #satisfies(cached: MintedAccessToken | undefined, opts?: AccessTokenRequest)
      : cached is MintedAccessToken {
    if (!cached) return false;
    if (cached.expires.valueOf() <= Date.now() + this.#skewMs) return false;
    if (opts?.staleToken !== undefined) return cached.token !== opts.staleToken;
    return !opts?.forceRefresh;
  }

  async get(opts?: AccessTokenRequest): Promise<string> {
    let cached = this.#cached;
    if (!this.#satisfies(cached, opts)) {
      cached = await this.#mint(opts);
      this.#cached = cached;
    }
    return cached.token;
  }
}
