import { RpcStub, RpcTarget } from "cloudflare:workers";
import type { ApprovalQueue } from "@gadgets/workshop-shared/gatekeeper";
import { describe, expect, it, vi } from "vitest";
import { SharePointDocumentSessionImpl } from "../../src/microsoft";
import type { SharePointApi, SharePointItemMetadata } from "../../src/sharepoint-api";

const resource = { siteId: "site-id", driveId: "drive-id", itemId: "item-id" };
const file: SharePointItemMetadata = {
  id: "item-id", name: "Test.txt", kind: "file", webUrl: "https://knoxnswedu.sharepoint.com/sites/digital-utilities/Shared%20Documents/test-uploads/os-test/Test.txt",
  size: 3, modifiedAt: "2026-09-01T00:00:00Z",
};
const folder = { ...file, name: "Folder", kind: "folder" as const, size: 0 };

class Queue extends RpcTarget {
  observations: unknown[] = [];
  reject = false;
  async authorizeObservation(value: unknown) {
    this.observations.push(value);
    if (this.reject) throw new Error("observation denied");
  }
  dup() { return this; }
  [Symbol.dispose]() {}
}

function session(metadata: SharePointItemMetadata = file) {
  const queue = new Queue();
  const api = {
    getItem: vi.fn(async (requested: { itemId: string }) =>
      requested.itemId === resource.itemId
        ? metadata
        : { ...file, id: requested.itemId }),
    listChildren: vi.fn(async () => ({ items: [] })),
    search: vi.fn(async () => ({ items: [] })),
    read: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
    assertDescendant: vi.fn(async (_root: unknown, candidate: string) => ({
      ...resource,
      itemId: candidate,
    })),
  } as unknown as SharePointApi;
  return {
    queue,
    api: api as unknown as { getItem: ReturnType<typeof vi.fn>; listChildren: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn> },
    session: new SharePointDocumentSessionImpl({
      api, rootResource: resource, resource,
      approvalQueue: queue as unknown as RpcStub<ApprovalQueue>,
      observe: async () => ({ pendingItemIds: [], commit() {} }),
    }),
  };
}

describe("SharePoint document observations", () => {
  it("opens and reads a file beneath a folder binding", async () => {
    const test = session(folder);

    const child = await test.session.open("child-file");
    await expect(child.read()).resolves.toHaveProperty("byteLength", 3);
  });

  it("authorizes metadata before returning it", async () => {
    const test = session();
    await expect(test.session.metadata()).resolves.toEqual(file);
    expect(test.queue.observations).toHaveLength(1);
  });

  it("authorizes empty list and search pages", async () => {
    const test = session(folder);
    await expect(test.session.listChildren()).resolves.toEqual({ items: [] });
    await expect(test.session.search("nothing")).resolves.toEqual({ items: [] });
    expect(test.queue.observations).toHaveLength(2);
  });

  it("authorizes file bytes before returning them", async () => {
    const test = session();
    await expect(test.session.read()).resolves.toHaveProperty("byteLength", 3);
    expect(test.queue.observations).toHaveLength(1);
  });

  it("does not return data when authorization rejects", async () => {
    const test = session();
    test.queue.reject = true;
    await expect(test.session.metadata()).rejects.toThrow("observation denied");
    await expect(test.session.read()).rejects.toThrow("observation denied");
  });

  it("rejects file/folder method mismatches before the remote operation", async () => {
    const fileTest = session(file);
    await expect(fileTest.session.listChildren()).rejects.toThrow(/file/);
    await expect(fileTest.session.search("x")).rejects.toThrow(/file/);
    expect(fileTest.api.listChildren).not.toHaveBeenCalled();
    expect(fileTest.api.search).not.toHaveBeenCalled();

    const folderTest = session(folder);
    await expect(folderTest.session.read()).rejects.toThrow(/folder/);
    expect(folderTest.api.read).not.toHaveBeenCalled();
  });
});
