import { describe, expect, it } from "vitest";
import {
  formatSharePointDocumentResource,
  parseSharePointDocumentResource,
} from "./sharepoint-resources.js";

const resource = {
  siteId: "knoxnswedu.sharepoint.com,site-collection-id,web-id",
  driveId: "b!drive-id",
  itemId: "01ABCDEF23456789",
};

describe("SharePoint document resource identity", () => {
  it("round-trips immutable Graph IDs through the canonical capability URL", () => {
    let url = formatSharePointDocumentResource(resource);

    expect(url).toBe(
      "https://sharepoint.microsoft.com/site/" +
      "knoxnswedu.sharepoint.com%2Csite-collection-id%2Cweb-id/" +
      "drive/b!drive-id/item/01ABCDEF23456789",
    );
    expect(parseSharePointDocumentResource(url)).toEqual(resource);
  });

  it.each([
    "https://knoxnswedu.sharepoint.com/sites/ICT/Shared%20Documents/example.docx",
    "https://evil.example/site/site-id/drive/drive-id/item/item-id",
    "http://sharepoint.microsoft.com/site/site-id/drive/drive-id/item/item-id",
    "https://sharepoint.microsoft.com/site/site-id/drive/drive-id",
    "https://sharepoint.microsoft.com/site//drive/drive-id/item/item-id",
    "https://sharepoint.microsoft.com/site/site-id/drive/drive-id/item/item-id?other=1",
  ])("rejects non-canonical or malformed resource URL %s", (url) => {
    expect(() => parseSharePointDocumentResource(url)).toThrow(/SharePoint resource URL/i);
  });
});
