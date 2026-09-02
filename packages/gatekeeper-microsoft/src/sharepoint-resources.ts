export type SharePointDocumentResource = {
  siteId: string;
  driveId: string;
  itemId: string;
};

const RESOURCE_ORIGIN = "https://sharepoint.microsoft.com";

function encodeId(id: string, name: string): string {
  if (!id || id.includes("/")) throw new Error(`Invalid SharePoint ${name}.`);
  return encodeURIComponent(id);
}

export function formatSharePointDocumentResource(resource: SharePointDocumentResource): string {
  return `${RESOURCE_ORIGIN}/site/${encodeId(resource.siteId, "site ID")}` +
    `/drive/${encodeId(resource.driveId, "drive ID")}` +
    `/item/${encodeId(resource.itemId, "item ID")}`;
}

export function parseSharePointDocumentResource(url: string): SharePointDocumentResource {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid SharePoint resource URL.");
  }
  if (parsed.origin !== RESOURCE_ORIGIN || parsed.username || parsed.password ||
      parsed.search || parsed.hash) {
    throw new Error("Invalid SharePoint resource URL.");
  }

  let parts = parsed.pathname.split("/");
  if (parts.length !== 7 || parts[1] !== "site" || parts[3] !== "drive" ||
      parts[5] !== "item") {
    throw new Error("Invalid SharePoint resource URL.");
  }

  let ids: string[];
  try {
    ids = [decodeURIComponent(parts[2]), decodeURIComponent(parts[4]), decodeURIComponent(parts[6])];
  } catch {
    throw new Error("Invalid SharePoint resource URL.");
  }
  if (ids.some(id => !id || id.includes("/"))) {
    throw new Error("Invalid SharePoint resource URL.");
  }
  return { siteId: ids[0], driveId: ids[1], itemId: ids[2] };
}
