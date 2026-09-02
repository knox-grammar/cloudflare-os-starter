import type { SupportedResource } from "@gadgets/workshop-shared/gatekeeper";

export const IDENTITY_SCOPES = ["openid", "profile", "email", "User.Read", "offline_access"];

export const OUTLOOK_MAIL_RESOURCE: SupportedResource = {
  urlPattern: "https://outlook.office.com/mail/*",
  title: "Outlook Mailbox",
  description: "Read email, organise it, and draft replies.",
  grantable: true,
};

export const OUTLOOK_CALENDAR_RESOURCE: SupportedResource = {
  urlPattern: "https://outlook.office.com/calendar/:calendarId/*",
  title: "Outlook Calendar",
  description: "Read and manage a single Outlook calendar.",
  grantable: true,
};

export const SHAREPOINT_DOCUMENT_RESOURCE: SupportedResource = {
  urlPattern: "https://sharepoint.microsoft.com/site/:siteId/drive/:driveId/item/:itemId",
  title: "SharePoint File or Folder",
  description: "Read one file or browse and search within one folder on an approved SharePoint site.",
  grantable: true,
};

export const RESOURCE_SCOPES: { resource: SupportedResource; scopes: string[] }[] = [
  { resource: OUTLOOK_MAIL_RESOURCE, scopes: ["https://graph.microsoft.com/Mail.ReadWrite"] },
  { resource: OUTLOOK_CALENDAR_RESOURCE, scopes: ["https://graph.microsoft.com/Calendars.ReadWrite"] },
  { resource: SHAREPOINT_DOCUMENT_RESOURCE, scopes: ["https://graph.microsoft.com/Sites.Selected"] },
];

export const SUPPORTED_RESOURCES: SupportedResource[] = RESOURCE_SCOPES.map(entry => entry.resource);

export function validateResourceUrlPatterns(resourceUrlPatterns?: string[]): void {
  if (resourceUrlPatterns === undefined) return;
  const known = new Set(RESOURCE_SCOPES.map(entry => entry.resource.urlPattern));
  const unknown = resourceUrlPatterns.filter(pattern => !known.has(pattern));
  if (unknown.length > 0) {
    throw new Error(`Unknown grantable resource URL pattern(s): ${unknown.join(", ")}`);
  }
}

export function resourceUrlPatternsToOAuthScopes(resourceUrlPatterns?: string[]): string[] {
  validateResourceUrlPatterns(resourceUrlPatterns);
  const scopes = new Set(IDENTITY_SCOPES);
  for (const entry of RESOURCE_SCOPES) {
    if (resourceUrlPatterns === undefined || resourceUrlPatterns.includes(entry.resource.urlPattern)) {
      for (const scope of entry.scopes) scopes.add(scope);
    }
  }
  return [...scopes];
}

const GRAPH_SCOPE_PREFIX = "https://graph.microsoft.com/";

/**
 * Entra accepts fully-qualified Graph scopes in the authorize request, but its token response
 * reports the same delegated permission in short form (for example `Calendars.ReadWrite`). Treat
 * only those two equivalent Graph forms as the same grant; anything else remains distinct so this
 * mapping still fails closed for an unknown audience or scope.
 */
function normalizedGraphScope(scope: string): string {
  const lower = scope.toLowerCase();
  return lower.startsWith(GRAPH_SCOPE_PREFIX)
    ? lower.slice(GRAPH_SCOPE_PREFIX.length)
    : lower;
}

export function grantedResourcesFromScopes(grantedOAuthScopes: string[]): string[] {
  const granted = new Set(grantedOAuthScopes.map(normalizedGraphScope));
  return RESOURCE_SCOPES
    .filter(entry => entry.scopes.every(scope => granted.has(normalizedGraphScope(scope))))
    .map(entry => entry.resource.urlPattern);
}
