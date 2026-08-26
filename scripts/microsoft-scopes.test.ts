import assert from "node:assert/strict";
import test from "node:test";
import {
  OUTLOOK_CALENDAR_RESOURCE,
  OUTLOOK_MAIL_RESOURCE,
  grantedResourcesFromScopes,
} from "../packages/gatekeeper-microsoft/src/microsoft-scopes.ts";

const allResourcePatterns = [
  OUTLOOK_MAIL_RESOURCE.urlPattern,
  OUTLOOK_CALENDAR_RESOURCE.urlPattern,
];

test("recognizes Microsoft Graph's short delegated scopes from an OAuth token response", () => {
  assert.deepEqual(
    grantedResourcesFromScopes(["openid", "profile", "offline_access", "Mail.ReadWrite", "Calendars.ReadWrite"]),
    allResourcePatterns,
  );
});

test("also recognizes the fully-qualified Graph scopes sent in an authorize request", () => {
  assert.deepEqual(
    grantedResourcesFromScopes([
      "https://graph.microsoft.com/Mail.ReadWrite",
      "https://graph.microsoft.com/Calendars.ReadWrite",
    ]),
    allResourcePatterns,
  );
});
