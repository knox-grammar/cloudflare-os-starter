import { afterEach, expect, it, vi } from "vitest";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/client";
import { registeredWorkIQProvider } from "../src/oauth.js";
import { KNOX_TENANT, WORKIQ_ENDPOINT, WORKIQ_SCOPE } from "../src/policy.js";

const issuer = `https://login.microsoftonline.com/${KNOX_TENANT}/v2.0`;

function baseProvider() {
  let client: unknown;
  let discovery: unknown;
  let verifier = "";
  let tokens: unknown;
  let redirect: URL | undefined;
  const provider: OAuthClientProvider = {
    redirectUrl: "https://stage.example/gatekeeper/workiq/oauth",
    clientMetadata: { redirect_uris: ["https://stage.example/gatekeeper/workiq/oauth"] },
    clientInformation: () => client as never,
    saveClientInformation: value => { client = value; },
    discoveryState: () => discovery as never,
    saveDiscoveryState: value => { discovery = value; },
    tokens: () => tokens as never,
    saveTokens: value => { tokens = value; },
    saveCodeVerifier: value => { verifier = value; },
    codeVerifier: () => verifier,
    state: () => "fixture-state",
    redirectToAuthorization: url => { redirect = url; },
  };
  return { provider, redirect: () => redirect, client: () => client, discovery: () => discovery };
}

afterEach(() => vi.unstubAllGlobals());

it("uses a registered confidential client and the exact tenant-scoped authorization-code flow", async () => {
  const base = baseProvider();
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    if (String(url) === "https://workiq.svc.cloud.microsoft/.well-known/oauth-protected-resource/mcp") {
      return Response.json({ resource: WORKIQ_ENDPOINT, authorization_servers: [issuer] });
    }
    expect(String(url)).toBe(`https://login.microsoftonline.com/${KNOX_TENANT}/oauth2/v2.0/token`);
    return Response.json({ access_token: "fixture-token", token_type: "Bearer", expires_in: 3600 });
  });
  const provider = registeredWorkIQProvider(base.provider, {
    clientId: "fixture-client", clientSecret: "fixture-secret",
  });
  await expect(auth(provider, { serverUrl: WORKIQ_ENDPOINT })).resolves.toBe("REDIRECT");
  const url = base.redirect()!;
  expect(url.origin + url.pathname).toBe(`https://login.microsoftonline.com/${KNOX_TENANT}/oauth2/v2.0/authorize`);
  expect(url.searchParams.get("scope")).toBe(WORKIQ_SCOPE);
  expect(url.searchParams.get("client_id")).toBe("fixture-client");
  expect(url.searchParams.get("redirect_uri")).toBe("https://stage.example/gatekeeper/workiq/oauth");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("state")).toBe("fixture-state");
  expect(calls).toHaveLength(0);
  expect(base.discovery()).toMatchObject({ authorizationServerUrl: issuer,
    resourceMetadata: { scopes_supported: WORKIQ_SCOPE.split(" ") } });
  await expect(auth(provider, { serverUrl: WORKIQ_ENDPOINT, authorizationCode: "fixture-code", iss: issuer }))
    .resolves.toBe("AUTHORIZED");
  expect(calls).toHaveLength(1);
  const body = new URLSearchParams(calls[0].body);
  expect(body.get("client_secret")).toBe("fixture-secret");
  expect(body.get("grant_type")).toBe("authorization_code");
  expect(body.get("code_verifier")).toBeTruthy();
  expect(base.client()).toMatchObject({ client_id: "fixture-client", client_secret: "fixture-secret" });
});

it("supports registered public clients without falling back to Microsoft's localhost client", async () => {
  const base = baseProvider();
  vi.stubGlobal("fetch", async () => Response.json({ resource: WORKIQ_ENDPOINT }));
  const provider = registeredWorkIQProvider(base.provider, { clientId: "fixture-public" });
  await expect(auth(provider, { serverUrl: WORKIQ_ENDPOINT })).resolves.toBe("REDIRECT");
  expect(base.client()).toMatchObject({ client_id: "fixture-public", token_endpoint_auth_method: "none" });
});

it("retains the base account generation fence before reading or saving registered credentials", async () => {
  const base = baseProvider();
  const save = vi.spyOn(base.provider, "saveClientInformation");
  base.provider.clientInformation = () => { throw new Error("replaced connection"); };
  const provider = registeredWorkIQProvider(base.provider, { clientId: "fixture-client" });
  await expect(provider.clientInformation({ issuer })).rejects.toThrow("replaced connection");
  expect(save).not.toHaveBeenCalled();
});

it("refuses another issuer, endpoint, resource or poisoned saved discovery", async () => {
  const base = baseProvider();
  const provider = registeredWorkIQProvider(base.provider, { clientId: "fixture-client" });
  await expect(provider.clientInformation({ issuer: "https://other.example" })).rejects.toThrow("issuer");
  await expect(provider.validateResourceURL!("https://other.example/mcp")).rejects.toThrow("endpoint");
  await expect(provider.validateResourceURL!(WORKIQ_ENDPOINT, "https://other.example")).rejects.toThrow("resource");
  base.provider.discoveryState = () => ({ authorizationServerUrl: "https://other.example" });
  await expect(provider.discoveryState!()).rejects.toThrow("issuer");
});

it("fails closed when no registered client is configured", () => {
  expect(() => registeredWorkIQProvider(baseProvider().provider, { clientId: "" })).toThrow("WORKIQ_CLIENT_ID");
});

it("ignores cached scope advertisements and requests only the configured WorkIQ/offline scope", async () => {
  const base = baseProvider();
  base.provider.discoveryState = () => ({ authorizationServerUrl: issuer,
    resourceMetadata: { resource: WORKIQ_ENDPOINT, scopes_supported: ["Sites.ReadWrite.All"] } });
  const provider = registeredWorkIQProvider(base.provider, { clientId: "fixture-client" });
  await expect(auth(provider, { serverUrl: WORKIQ_ENDPOINT })).resolves.toBe("REDIRECT");
  expect(base.redirect()!.searchParams.get("scope")).toBe(WORKIQ_SCOPE);
});
