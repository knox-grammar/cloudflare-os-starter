import { describe, expect, it } from "vitest";
import {
  OUTLOOK_CALENDAR_RESOURCE,
  OUTLOOK_MAIL_RESOURCE,
  SHAREPOINT_DOCUMENT_RESOURCE,
  grantedResourcesFromScopes,
  resourceUrlPatternsToOAuthScopes,
} from "./microsoft-scopes";

const allResourcePatterns = [
  OUTLOOK_MAIL_RESOURCE.urlPattern,
  OUTLOOK_CALENDAR_RESOURCE.urlPattern,
];

describe("resourceUrlPatternsToOAuthScopes", () => {
  it("requests only delegated Sites.Selected for a SharePoint document connection", () => {
    expect(resourceUrlPatternsToOAuthScopes([
      SHAREPOINT_DOCUMENT_RESOURCE.urlPattern,
    ])).toEqual([
      "openid",
      "profile",
      "email",
      "User.Read",
      "offline_access",
      "https://graph.microsoft.com/Sites.Selected",
    ]);
  });
});

describe("grantedResourcesFromScopes", () => {
  it("recognizes Microsoft Graph's short delegated scopes from an OAuth token response", () => {
    expect(
      grantedResourcesFromScopes([
        "openid", "profile", "offline_access", "Mail.ReadWrite", "Calendars.ReadWrite",
      ]),
    ).toEqual(allResourcePatterns);
  });

  it("recognizes Microsoft's short Sites.Selected scope as a SharePoint grant", () => {
    expect(grantedResourcesFromScopes(["Sites.Selected"]))
      .toContain(SHAREPOINT_DOCUMENT_RESOURCE.urlPattern);
  });

  it("also recognizes the fully-qualified Graph scopes sent in an authorize request", () => {
    expect(
      grantedResourcesFromScopes([
        "https://graph.microsoft.com/Mail.ReadWrite",
        "https://graph.microsoft.com/Calendars.ReadWrite",
      ]),
    ).toEqual(allResourcePatterns);
  });
});
