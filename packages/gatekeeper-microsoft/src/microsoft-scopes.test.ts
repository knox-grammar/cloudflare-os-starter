import { describe, expect, it } from "vitest";
import {
  OUTLOOK_CALENDAR_RESOURCE,
  OUTLOOK_MAIL_RESOURCE,
  grantedResourcesFromScopes,
} from "./microsoft-scopes";

const allResourcePatterns = [
  OUTLOOK_MAIL_RESOURCE.urlPattern,
  OUTLOOK_CALENDAR_RESOURCE.urlPattern,
];

describe("grantedResourcesFromScopes", () => {
  it("recognizes Microsoft Graph's short delegated scopes from an OAuth token response", () => {
    expect(
      grantedResourcesFromScopes([
        "openid", "profile", "offline_access", "Mail.ReadWrite", "Calendars.ReadWrite",
      ]),
    ).toEqual(allResourcePatterns);
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
