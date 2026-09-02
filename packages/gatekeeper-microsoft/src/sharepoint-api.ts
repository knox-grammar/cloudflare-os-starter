import { fetchWithAuthRetry, type AccessTokenProvider } from "./auth-retry.js";
import type { SharePointDocumentResource } from "./sharepoint-resources.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_READ_BYTES = 5 * 1024 * 1024;

export type SharePointItemMetadata = {
  id: string;
  name: string;
  kind: "file" | "folder";
  webUrl: string;
  size: number;
  eTag?: string;
  mimeType?: string;
  modifiedAt: string;
  modifiedBy?: string;
};

export type SharePointLibrary = {
  id: string;
  name: string;
  webUrl: string;
};

export type SharePointItemPage = {
  items: SharePointItemMetadata[];
  cursor?: string;
};

type GraphDriveItem = {
  id?: string;
  name?: string;
  webUrl?: string;
  size?: number;
  eTag?: string;
  lastModifiedDateTime?: string;
  lastModifiedBy?: { user?: { displayName?: string } };
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  parentReference?: { id?: string; siteId?: string; driveId?: string };
};

export class SharePointGraphError extends Error {
  readonly status: number;

  constructor(operation: string, status: number) {
    super(`Microsoft Graph ${operation} failed with status ${status}.`);
    this.name = "SharePointGraphError";
    this.status = status;
  }
}

function shareToken(url: string): string {
  let bytes = new TextEncoder().encode(url);
  let binary = "";
  for (let byte of bytes) binary += String.fromCharCode(byte);
  return "u!" + btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function assertWithinAssignedSite(url: string, assignedSiteUrl: string): URL {
  let target: URL;
  let site: URL;
  try {
    target = new URL(url);
    site = new URL(assignedSiteUrl);
  } catch {
    throw new Error("URL is not within the assigned SharePoint site.");
  }
  let sitePath = site.pathname.replace(/\/+$/, "");
  if (site.protocol !== "https:" || site.search || site.hash || site.username || site.password ||
      target.protocol !== "https:" || target.origin !== site.origin || target.username ||
      target.password || target.hash ||
      !(target.pathname === sitePath || target.pathname.startsWith(sitePath + "/"))) {
    throw new Error("URL is not within the assigned SharePoint site.");
  }
  return target;
}

function itemPath(resource: SharePointDocumentResource): string {
  return `/sites/${encodeURIComponent(resource.siteId)}` +
    `/drives/${encodeURIComponent(resource.driveId)}` +
    `/items/${encodeURIComponent(resource.itemId)}`;
}

function normalizeItem(item: GraphDriveItem): SharePointItemMetadata {
  if (!item.id || !item.name || !item.webUrl || typeof item.size !== "number" ||
      !item.lastModifiedDateTime || (!item.file && !item.folder)) {
    throw new Error("Microsoft Graph returned malformed SharePoint item metadata.");
  }
  return {
    id: item.id,
    name: item.name,
    kind: item.folder ? "folder" : "file",
    webUrl: item.webUrl,
    size: item.size,
    ...(item.eTag ? { eTag: item.eTag } : {}),
    ...(item.file?.mimeType ? { mimeType: item.file.mimeType } : {}),
    modifiedAt: item.lastModifiedDateTime,
    ...(item.lastModifiedBy?.user?.displayName
      ? { modifiedBy: item.lastModifiedBy.user.displayName }
      : {}),
  };
}

function childrenUrl(resource: SharePointDocumentResource): string {
  return `${GRAPH_BASE}${itemPath(resource)}/children`;
}

function isBoundChildrenUrl(url: string, resource: SharePointDocumentResource): boolean {
  try {
    let parsed = new URL(url);
    let expected = new URL(childrenUrl(resource));
    return parsed.origin === expected.origin && parsed.pathname === expected.pathname &&
      !parsed.username && !parsed.password && !parsed.hash;
  } catch {
    return false;
  }
}

function searchUrl(resource: SharePointDocumentResource, query: string): string {
  let encodedQuery = encodeURIComponent(query).replace(/'/g, "%27");
  return `${GRAPH_BASE}${itemPath(resource)}/search(q='${encodedQuery}')`;
}

function isBoundSearchUrl(
  url: string,
  resource: SharePointDocumentResource,
  query: string,
): boolean {
  try {
    let parsed = new URL(url);
    let expected = new URL(searchUrl(resource, query));
    return parsed.origin === expected.origin && parsed.pathname === expected.pathname &&
      !parsed.username && !parsed.password && !parsed.hash;
  } catch {
    return false;
  }
}

export class SharePointApi {
  readonly #getAccessToken: AccessTokenProvider;

  constructor(getAccessToken: AccessTokenProvider) {
    this.#getAccessToken = getAccessToken;
  }

  async listLibraries(assignedSiteUrl: string): Promise<SharePointLibrary[]> {
    let siteUrl = assertWithinAssignedSite(assignedSiteUrl, assignedSiteUrl);
    let siteResponse = await fetchWithAuthRetry(
      `${GRAPH_BASE}/sites/${siteUrl.hostname}:${siteUrl.pathname.replace(/\/+$/, "")}`,
      { headers: { Accept: "application/json" } },
      this.#getAccessToken,
      { timeoutMs: 20_000 },
    );
    if (!siteResponse.ok) {
      siteResponse.body?.cancel();
      throw new SharePointGraphError("assigned site resolution", siteResponse.status);
    }
    let site = await siteResponse.json<{ id?: string; webUrl?: string }>();
    if (!site.id || !site.webUrl) {
      throw new Error("Microsoft Graph returned malformed assigned SharePoint site metadata.");
    }
    assertWithinAssignedSite(site.webUrl, assignedSiteUrl);

    let drivesResponse = await fetchWithAuthRetry(
      `${GRAPH_BASE}/sites/${encodeURIComponent(site.id)}/drives`,
      { headers: { Accept: "application/json" } },
      this.#getAccessToken,
      { timeoutMs: 20_000 },
    );
    if (!drivesResponse.ok) {
      drivesResponse.body?.cancel();
      throw new SharePointGraphError("document library request", drivesResponse.status);
    }
    let data = await drivesResponse.json<{
      value?: { id?: string; name?: string; webUrl?: string; driveType?: string }[];
    }>();
    if (!Array.isArray(data.value)) {
      throw new Error("Microsoft Graph returned a malformed document library list.");
    }
    return data.value
      .filter(drive => drive.driveType === "documentLibrary")
      .map(drive => {
        if (!drive.id || !drive.name || !drive.webUrl) {
          throw new Error("Microsoft Graph returned malformed document library metadata.");
        }
        assertWithinAssignedSite(drive.webUrl, assignedSiteUrl);
        return { id: drive.id, name: drive.name, webUrl: drive.webUrl };
      });
  }

  async resolveDocumentUrl(
    url: string,
    assignedSiteUrl: string,
  ): Promise<{ resource: SharePointDocumentResource; metadata: SharePointItemMetadata }> {
    let target = assertWithinAssignedSite(url, assignedSiteUrl);
    let response = await fetchWithAuthRetry(
      `${GRAPH_BASE}/shares/${shareToken(target.href)}/driveItem`,
      { headers: { Accept: "application/json" } },
      this.#getAccessToken,
      { timeoutMs: 20_000 },
    );
    if (!response.ok) {
      response.body?.cancel();
      throw new SharePointGraphError("URL resolution", response.status);
    }
    let item = await response.json<GraphDriveItem>();
    let metadata = normalizeItem(item);
    assertWithinAssignedSite(metadata.webUrl, assignedSiteUrl);
    let siteId = item.parentReference?.siteId;
    let driveId = item.parentReference?.driveId;
    if (!siteId || !driveId) {
      throw new Error("Microsoft Graph returned malformed SharePoint resource identity.");
    }
    return {
      resource: { siteId, driveId, itemId: metadata.id },
      metadata,
    };
  }

  async read(
    resource: SharePointDocumentResource,
    options: { offset?: number; length?: number } = {},
  ): Promise<ArrayBuffer> {
    let metadata = await this.getItem(resource);
    if (metadata.kind !== "file") throw new Error("Cannot read bytes from a SharePoint folder.");
    if (metadata.size > MAX_FILE_BYTES) {
      throw new Error("SharePoint files larger than 50 MB cannot be read.");
    }

    let offset = options.offset ?? 0;
    let remaining = metadata.size - offset;
    let length = options.length ?? Math.min(MAX_READ_BYTES, remaining);
    if (!Number.isInteger(offset) || offset < 0 || offset > metadata.size) {
      throw new Error("SharePoint read offset is outside the file.");
    }
    if (!Number.isInteger(length) || length < 0 || length > MAX_READ_BYTES || length > remaining) {
      throw new Error("SharePoint read length must be within the file and no larger than 5 MB.");
    }
    if (length === 0) return new ArrayBuffer(0);

    let graphResponse = await fetchWithAuthRetry(
      `${GRAPH_BASE}${itemPath(resource)}/content`,
      { redirect: "manual" },
      this.#getAccessToken,
      { timeoutMs: 20_000 },
    );
    let location = graphResponse.headers.get("Location");
    graphResponse.body?.cancel();
    if (graphResponse.status < 300 || graphResponse.status > 399 || !location) {
      throw new SharePointGraphError("content redirect request", graphResponse.status);
    }

    let downloadUrl: URL;
    try {
      downloadUrl = new URL(location);
    } catch {
      throw new Error("Microsoft Graph returned an invalid SharePoint download redirect.");
    }
    if (downloadUrl.protocol !== "https:" || downloadUrl.username || downloadUrl.password) {
      throw new Error("Microsoft Graph returned an unsafe SharePoint download redirect.");
    }

    let download = await fetch(downloadUrl, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (download.status !== 200 && download.status !== 206) {
      download.body?.cancel();
      throw new SharePointGraphError("content download", download.status);
    }
    let declaredLength = Number(download.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > length) {
      download.body?.cancel();
      throw new Error("SharePoint content response exceeded the requested range.");
    }
    let bytes = await download.arrayBuffer();
    if (bytes.byteLength > length) {
      throw new Error("SharePoint content response exceeded the requested range.");
    }
    return bytes;
  }

  async search(
    resource: SharePointDocumentResource,
    query: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<SharePointItemPage> {
    if (!query.trim() || query.length > 200) {
      throw new Error("SharePoint search query must contain 1 to 200 characters.");
    }
    let limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("SharePoint search page limit must be an integer from 1 to 100.");
    }
    if (options.cursor && !isBoundSearchUrl(options.cursor, resource, query)) {
      throw new Error("SharePoint cursor does not belong to the bound folder search.");
    }
    let url = options.cursor ?? `${searchUrl(resource, query)}?$top=${limit}`;
    let response = await fetchWithAuthRetry(
      url,
      { headers: { Accept: "application/json" } },
      this.#getAccessToken,
      { timeoutMs: 20_000 },
    );
    if (!response.ok) {
      response.body?.cancel();
      throw new SharePointGraphError("folder search request", response.status);
    }
    let data = await response.json<{ value?: GraphDriveItem[]; "@odata.nextLink"?: string }>();
    if (!Array.isArray(data.value)) {
      throw new Error("Microsoft Graph returned a malformed SharePoint search page.");
    }
    let cursor = data["@odata.nextLink"];
    if (cursor && !isBoundSearchUrl(cursor, resource, query)) {
      throw new Error("Microsoft Graph returned a cursor outside the bound folder search.");
    }
    return {
      items: data.value.map(normalizeItem),
      ...(cursor ? { cursor } : {}),
    };
  }

  async listChildren(
    resource: SharePointDocumentResource,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<SharePointItemPage> {
    let limit = options.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("SharePoint folder page limit must be an integer from 1 to 100.");
    }
    if (options.cursor && !isBoundChildrenUrl(options.cursor, resource)) {
      throw new Error("SharePoint cursor does not belong to the bound folder.");
    }
    let url = options.cursor ?? `${childrenUrl(resource)}?$top=${limit}`;
    let response = await fetchWithAuthRetry(
      url,
      { headers: { Accept: "application/json" } },
      this.#getAccessToken,
      { timeoutMs: 20_000 },
    );
    if (!response.ok) {
      response.body?.cancel();
      throw new SharePointGraphError("folder children request", response.status);
    }
    let data = await response.json<{ value?: GraphDriveItem[]; "@odata.nextLink"?: string }>();
    if (!Array.isArray(data.value)) {
      throw new Error("Microsoft Graph returned a malformed SharePoint folder page.");
    }
    let cursor = data["@odata.nextLink"];
    if (cursor && !isBoundChildrenUrl(cursor, resource)) {
      throw new Error("Microsoft Graph returned a cursor outside the bound folder.");
    }
    return {
      items: data.value.map(normalizeItem),
      ...(cursor ? { cursor } : {}),
    };
  }

  async assertDescendant(
    root: SharePointDocumentResource,
    candidateItemId: string,
  ): Promise<SharePointDocumentResource> {
    if (!candidateItemId || candidateItemId.includes("/")) {
      throw new Error("Invalid SharePoint item ID.");
    }
    let current = candidateItemId;
    let visited = new Set<string>();
    for (let depth = 0; depth < 100; depth++) {
      if (current === root.itemId) {
        if (candidateItemId === root.itemId) {
          throw new Error("SharePoint item is not beneath the bound folder.");
        }
        return { siteId: root.siteId, driveId: root.driveId, itemId: candidateItemId };
      }
      if (visited.has(current)) {
        throw new Error("Microsoft Graph returned cyclic SharePoint ancestry.");
      }
      visited.add(current);
      let identity = await this.#getItemIdentity({ ...root, itemId: current });
      if (!identity.parentId) {
        throw new Error("SharePoint item is not beneath the bound folder.");
      }
      current = identity.parentId;
    }
    throw new Error("SharePoint item ancestry exceeded the supported depth.");
  }

  async #getItemIdentity(resource: SharePointDocumentResource): Promise<{
    metadata: SharePointItemMetadata;
    parentId?: string;
  }> {
    let response = await fetchWithAuthRetry(
      `${GRAPH_BASE}${itemPath(resource)}`,
      { headers: { Accept: "application/json" } },
      this.#getAccessToken,
      { timeoutMs: 20_000 },
    );
    if (!response.ok) {
      response.body?.cancel();
      throw new SharePointGraphError("item metadata request", response.status);
    }
    let item = await response.json<GraphDriveItem>();
    return {
      metadata: normalizeItem(item),
      ...(item.parentReference?.id ? { parentId: item.parentReference.id } : {}),
    };
  }

  async getItem(resource: SharePointDocumentResource): Promise<SharePointItemMetadata> {
    return (await this.#getItemIdentity(resource)).metadata;
  }
}
