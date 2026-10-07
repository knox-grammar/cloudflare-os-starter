import type { OAuthClientProvider, OAuthDiscoveryState } from "@modelcontextprotocol/client";
import { KNOX_TENANT, WORKIQ_ENDPOINT, WORKIQ_SCOPE } from "./policy.js";

const issuer = `https://login.microsoftonline.com/${KNOX_TENANT}/v2.0`;
const endpoints = `https://login.microsoftonline.com/${KNOX_TENANT}/oauth2/v2.0`;

export function registeredWorkIQProvider(
  base: OAuthClientProvider,
  config: { clientId: string; clientSecret?: string },
): OAuthClientProvider {
  if (!config.clientId.trim()) throw new Error("WORKIQ_CLIENT_ID is not configured.");
  const method = config.clientSecret ? "client_secret_post" : "none";
  const metadata = {
    ...base.clientMetadata,
    scope: WORKIQ_SCOPE,
    token_endpoint_auth_method: method,
  };
  const discovery: OAuthDiscoveryState = {
    authorizationServerUrl: issuer,
    // This is configured policy, not a copy of remote discovery. The SDK otherwise prefers
    // resource-advertised scopes over client metadata and can silently drop offline_access.
    resourceMetadata: { resource: WORKIQ_ENDPOINT, authorization_servers: [issuer],
      scopes_supported: WORKIQ_SCOPE.split(" ") },
    authorizationServerMetadata: {
      issuer,
      authorization_endpoint: `${endpoints}/authorize`,
      token_endpoint: `${endpoints}/token`,
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    },
  };
  function assertDiscovery(state: OAuthDiscoveryState) {
    if (state.authorizationServerUrl !== issuer ||
      (state.authorizationServerMetadata && (
        state.authorizationServerMetadata.issuer !== issuer ||
        state.authorizationServerMetadata.authorization_endpoint !== `${endpoints}/authorize` ||
        state.authorizationServerMetadata.token_endpoint !== `${endpoints}/token`
      ))) throw new Error("WorkIQ OAuth issuer or endpoints do not match the Knox tenant.");
  }

  return {
    ...base,
    clientMetadata: metadata,
    clientInformation: async context => {
      // Even a configured client must pass the account's live generation fence first.
      await base.clientInformation(context);
      if (context?.issuer && context.issuer !== issuer) throw new Error("WorkIQ OAuth issuer mismatch.");
      const client = { ...metadata, client_id: config.clientId,
        client_secret: config.clientSecret, issuer };
      await base.saveClientInformation?.(client, context);
      return client;
    },
    discoveryState: async () => {
      const saved = await base.discoveryState?.();
      if (saved) assertDiscovery(saved);
      await base.saveDiscoveryState?.(discovery);
      return discovery;
    },
    saveDiscoveryState: async state => {
      assertDiscovery(state);
      await base.saveDiscoveryState?.(state);
    },
    validateResourceURL: async (server, resource) => {
      if (String(server) !== WORKIQ_ENDPOINT) throw new Error("WorkIQ OAuth endpoint mismatch.");
      if (resource && resource !== WORKIQ_ENDPOINT && resource !== "api://workiq.svc.cloud.microsoft") {
        throw new Error("WorkIQ OAuth resource mismatch.");
      }
      // Entra v2 selects the audience through the exact resource-qualified scope, not RFC 8707.
      return undefined;
    },
  };
}
