import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeAuthCode, pkceChallenge, refreshAccessToken } from "./microsoft-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Microsoft OAuth PKCE", () => {
  it("derives the RFC 7636 S256 challenge without base64 padding", async () => {
    expect(await pkceChallenge(
      "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
    )).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("Microsoft OAuth refresh", () => {
  it("returns Microsoft's rotated refresh token with the new access token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      access_token: "new-access-token",
      refresh_token: "rotated-refresh-token",
      expires_in: 3600,
    })));

    let result = await refreshAccessToken(
      "tenant-id", "old-refresh-token", "client-id", "client-secret",
    );

    expect(result).toMatchObject({
      ok: true,
      token: { token: "new-access-token" },
      refreshToken: "rotated-refresh-token",
    });
  });
});

describe("Microsoft OAuth authorization-code exchange", () => {
  it("binds the token exchange to the PKCE verifier from the authorization request", async () => {
    let requestBody: URLSearchParams | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = new URLSearchParams(String(init?.body));
      return Response.json({
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "openid User.Read",
      });
    }));

    await exchangeAuthCode(
      "tenant-id",
      "authorization-code",
      "client-id",
      "client-secret",
      "https://os.example.test/gatekeeper/microsoft/oauth",
      "pkce-verifier",
    );

    expect(requestBody?.get("code_verifier")).toBe("pkce-verifier");
  });
});
