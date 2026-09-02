import { afterEach, describe, expect, it, vi } from "vitest";
import { SharePointApi } from "./sharepoint-api";

const resource = {
  siteId: "knoxnswedu.sharepoint.com,site-collection-id,web-id",
  driveId: "b!drive-id",
  itemId: "01ABCDEF23456789",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SharePointApi assigned-site libraries", () => {
  it("lists document libraries only from the exact assigned site", async () => {
    let calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      let url = String(input);
      calls.push(url);
      if (url.includes(":/sites/ICT")) {
        return Response.json({
          id: resource.siteId,
          displayName: "ICT",
          webUrl: "https://knoxnswedu.sharepoint.com/sites/ICT",
        });
      }
      return Response.json({ value: [{
        id: resource.driveId,
        name: "Shared Documents",
        webUrl: "https://knoxnswedu.sharepoint.com/sites/ICT/Shared%20Documents",
        driveType: "documentLibrary",
      }] });
    }));

    let api = new SharePointApi(async () => "access-token");
    await expect(api.listLibraries(
      "https://knoxnswedu.sharepoint.com/sites/ICT",
    )).resolves.toEqual([{
      id: resource.driveId,
      name: "Shared Documents",
      webUrl: "https://knoxnswedu.sharepoint.com/sites/ICT/Shared%20Documents",
    }]);
    expect(calls).toEqual([
      "https://graph.microsoft.com/v1.0/sites/knoxnswedu.sharepoint.com:/sites/ICT",
      `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(resource.siteId)}/drives`,
    ]);
  });
});

describe("SharePointApi browser URL resolution", () => {
  it("resolves an ICT site URL to immutable Graph IDs", async () => {
    let requestedUrl: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return Response.json({
        id: resource.itemId,
        name: "handbook.txt",
        webUrl: "https://knoxnswedu.sharepoint.com/sites/ICT/Shared%20Documents/handbook.txt",
        size: 12,
        lastModifiedDateTime: "2026-08-31T23:45:00Z",
        parentReference: {
          siteId: resource.siteId,
          driveId: resource.driveId,
        },
        file: { mimeType: "text/plain" },
      });
    }));

    let api = new SharePointApi(async () => "access-token");
    let resolved = await api.resolveDocumentUrl(
      "https://knoxnswedu.sharepoint.com/sites/ICT/Shared%20Documents/handbook.txt",
      "https://knoxnswedu.sharepoint.com/sites/ICT",
    );

    expect(resolved).toEqual({
      resource,
      metadata: {
        id: resource.itemId,
        name: "handbook.txt",
        kind: "file",
        webUrl: "https://knoxnswedu.sharepoint.com/sites/ICT/Shared%20Documents/handbook.txt",
        size: 12,
        mimeType: "text/plain",
        modifiedAt: "2026-08-31T23:45:00Z",
      },
    });
    expect(requestedUrl).toMatch(/^https:\/\/graph\.microsoft\.com\/v1\.0\/shares\/u![A-Za-z0-9_-]+\/driveItem$/);
  });

  it.each([
    "https://knoxnswedu.sharepoint.com/sites/HR/private.docx",
    "https://other.sharepoint.com/sites/ICT/file.docx",
    "http://knoxnswedu.sharepoint.com/sites/ICT/file.docx",
    "https://knoxnswedu.sharepoint.com/sites/ICT-archive/file.docx",
  ])("rejects a URL outside the assigned ICT site before calling Graph: %s", async (url) => {
    let fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let api = new SharePointApi(async () => "access-token");

    await expect(api.resolveDocumentUrl(
      url,
      "https://knoxnswedu.sharepoint.com/sites/ICT",
    )).rejects.toThrow(/assigned SharePoint site/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SharePointApi bounded content", () => {
  it("reads one bounded range without forwarding the Graph token to the download host", async () => {
    let requests: {
      url: string;
      authorization: string | null;
      range: string | null;
      redirect?: RequestInit["redirect"];
    }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.redirect && init.redirect !== "follow" && init.redirect !== "manual") {
        throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
      }
      let headers = new Headers(init?.headers);
      let url = String(input);
      requests.push({
        url,
        authorization: headers.get("Authorization"),
        range: headers.get("Range"),
        ...(init?.redirect ? { redirect: init.redirect } : {}),
      });
      if (url.endsWith(`/items/${resource.itemId}`)) {
        return Response.json({
          id: resource.itemId,
          name: "handbook.txt",
          webUrl: "https://knoxnswedu.sharepoint.com/sites/ICT/handbook.txt",
          size: 12,
          lastModifiedDateTime: "2026-08-31T23:45:00Z",
          file: { mimeType: "text/plain" },
        });
      }
      if (url.endsWith(`/items/${resource.itemId}/content`)) {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://download.example.microsoft/temporary-secret-url" },
        });
      }
      return new Response(new TextEncoder().encode("hello"), {
        status: 206,
        headers: { "Content-Length": "5" },
      });
    }));

    let api = new SharePointApi(async () => "access-token");
    let bytes = await api.read(resource, { offset: 2, length: 5 });

    expect(new TextDecoder().decode(bytes)).toBe("hello");
    expect(requests).toHaveLength(3);
    expect(requests[1]).toMatchObject({
      authorization: "Bearer access-token",
      range: null,
      redirect: "manual",
    });
    expect(requests[2]).toEqual({
      url: "https://download.example.microsoft/temporary-secret-url",
      authorization: null,
      range: "bytes=2-6",
      redirect: "manual",
    });
  });

  it("rejects files over 50 MB before requesting content", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      return Response.json({
        id: resource.itemId,
        name: "oversized.bin",
        webUrl: "https://knoxnswedu.sharepoint.com/sites/ICT/oversized.bin",
        size: 50 * 1024 * 1024 + 1,
        lastModifiedDateTime: "2026-08-31T23:45:00Z",
        file: { mimeType: "application/octet-stream" },
      });
    }));

    let api = new SharePointApi(async () => "access-token");
    await expect(api.read(resource)).rejects.toThrow(/50 MB/);
    expect(calls).toBe(1);
  });
});

describe("SharePointApi folder search", () => {
  it("encodes the query and confines result paging to the bound folder search", async () => {
    let calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json({ value: [], "@odata.nextLink": undefined });
    }));

    let api = new SharePointApi(async () => "access-token");
    await api.search(resource, "ICT policy", { limit: 10 });

    expect(calls).toEqual([
      "https://graph.microsoft.com/v1.0/sites/" +
      "knoxnswedu.sharepoint.com%2Csite-collection-id%2Cweb-id/drives/" +
      "b!drive-id/items/01ABCDEF23456789/search(q='ICT%20policy')?$top=10",
    ]);
  });

  it("rejects a search cursor for a different query", async () => {
    let api = new SharePointApi(async () => "access-token");

    await expect(api.search(resource, "approved query", {
      cursor: "https://graph.microsoft.com/v1.0/sites/" +
        "knoxnswedu.sharepoint.com%2Csite-collection-id%2Cweb-id/drives/" +
        "b!drive-id/items/01ABCDEF23456789/search(q='different')?$skiptoken=x",
    })).rejects.toThrow(/cursor.*bound folder search/i);
  });
});

describe("SharePointApi folder paging", () => {
  it("normalizes a page and follows only the bound folder's Graph nextLink", async () => {
    let calls: string[] = [];
    let firstPageUrl =
      "https://graph.microsoft.com/v1.0/sites/" +
      "knoxnswedu.sharepoint.com%2Csite-collection-id%2Cweb-id/drives/" +
      "b!drive-id/items/01ABCDEF23456789/children?$top=25";
    let nextPageUrl = firstPageUrl + "&$skiptoken=opaque-token";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json({
        value: [{
          id: "child-folder",
          name: "Policies",
          webUrl: "https://knoxnswedu.sharepoint.com/sites/ICT/Shared%20Documents/Policies",
          size: 0,
          lastModifiedDateTime: "2026-08-31T23:45:00Z",
          folder: { childCount: 2 },
        }],
        "@odata.nextLink": nextPageUrl,
      });
    }));

    let api = new SharePointApi(async () => "access-token");
    let page = await api.listChildren(resource, { limit: 25 });

    expect(page).toEqual({
      items: [{
        id: "child-folder",
        name: "Policies",
        kind: "folder",
        webUrl: "https://knoxnswedu.sharepoint.com/sites/ICT/Shared%20Documents/Policies",
        size: 0,
        modifiedAt: "2026-08-31T23:45:00Z",
      }],
      cursor: nextPageUrl,
    });
    await api.listChildren(resource, { cursor: page.cursor });
    expect(calls).toEqual([firstPageUrl, nextPageUrl]);
  });

  it("rejects a cursor outside the bound folder's children endpoint", async () => {
    let api = new SharePointApi(async () => "access-token");

    await expect(api.listChildren(resource, {
      cursor: "https://graph.microsoft.com/v1.0/sites/other/drives/other/items/other/children?$skiptoken=x",
    })).rejects.toThrow(/cursor.*bound folder/i);
  });
});

describe("SharePointApi failure handling", () => {
  it("returns a status-bearing error without Graph response content", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "private tenant diagnostic", { status: 403 },
    )));
    let api = new SharePointApi(async () => "access-token");

    await expect(api.getItem(resource)).rejects.toMatchObject({ status: 403 });
    await expect(api.getItem(resource)).rejects.not.toThrow(/private tenant diagnostic/);
  });

  it("retries a throttled metadata GET", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response(null, {
        status: 429,
        headers: { "Retry-After": "0" },
      });
      return Response.json({
        id: resource.itemId,
        name: "folder",
        webUrl: "https://knoxnswedu.sharepoint.com/sites/ICT/folder",
        size: 0,
        lastModifiedDateTime: "2026-08-31T23:45:00Z",
        folder: { childCount: 0 },
      });
    }));
    let api = new SharePointApi(async () => "access-token");

    await expect(api.getItem(resource)).resolves.toMatchObject({ kind: "folder" });
    expect(calls).toBe(2);
  });

  it("fails closed on malformed item metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: resource.itemId })));
    let api = new SharePointApi(async () => "access-token");

    await expect(api.getItem(resource)).rejects.toThrow(/malformed/i);
  });
});

describe("SharePointApi descendant confinement", () => {
  function item(id: string, parentId?: string) {
    return {
      id,
      name: `${id}.txt`,
      webUrl: `https://knoxnswedu.sharepoint.com/sites/digital-utilities/${id}.txt`,
      size: 1,
      lastModifiedDateTime: "2026-09-01T00:00:00Z",
      file: {},
      ...(parentId ? { parentReference: { id: parentId } } : {}),
    };
  }

  it("accepts a nested descendant using immutable parent IDs", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const id = decodeURIComponent(String(input).split("/items/")[1]!);
      return Response.json(id === "child" ? item("child", "middle") : item("middle", resource.itemId));
    }));
    const api = new SharePointApi(async () => "access-token");

    await expect(api.assertDescendant(resource, "child")).resolves.toEqual({
      ...resource,
      itemId: "child",
    });
  });

  it("rejects an item whose ancestry leaves the bound folder", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const id = decodeURIComponent(String(input).split("/items/")[1]!);
      return Response.json(id === "child" ? item("child", "outside") : item("outside"));
    }));
    const api = new SharePointApi(async () => "access-token");

    await expect(api.assertDescendant(resource, "child")).rejects.toThrow(/not beneath/);
  });

  it("rejects cyclic ancestry", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const id = decodeURIComponent(String(input).split("/items/")[1]!);
      return Response.json(id === "a" ? item("a", "b") : item("b", "a"));
    }));
    const api = new SharePointApi(async () => "access-token");

    await expect(api.assertDescendant(resource, "a")).rejects.toThrow(/cyclic/);
  });
});

describe("SharePointApi item metadata", () => {
  it("fetches the bound immutable IDs and normalizes Graph's file response", async () => {
    let requestedUrl: string | undefined;
    let authorization: string | null | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("Authorization");
      return Response.json({
        id: resource.itemId,
        name: "ICT handbook.docx",
        webUrl: "https://knoxnswedu.sharepoint.com/sites/ICT/Shared%20Documents/ICT%20handbook.docx",
        size: 12345,
        eTag: "{etag},1",
        lastModifiedDateTime: "2026-08-31T23:45:00Z",
        lastModifiedBy: { user: { displayName: "ICT Admin" } },
        file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      });
    }));

    let api = new SharePointApi(async () => "access-token");
    await expect(api.getItem(resource)).resolves.toEqual({
      id: resource.itemId,
      name: "ICT handbook.docx",
      kind: "file",
      webUrl: "https://knoxnswedu.sharepoint.com/sites/ICT/Shared%20Documents/ICT%20handbook.docx",
      size: 12345,
      eTag: "{etag},1",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      modifiedAt: "2026-08-31T23:45:00Z",
      modifiedBy: "ICT Admin",
    });
    expect(requestedUrl).toBe(
      "https://graph.microsoft.com/v1.0/sites/" +
      "knoxnswedu.sharepoint.com%2Csite-collection-id%2Cweb-id/drives/b!drive-id/items/01ABCDEF23456789",
    );
    expect(authorization).toBe("Bearer access-token");
  });
});
