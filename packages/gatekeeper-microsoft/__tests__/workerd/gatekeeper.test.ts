import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

const props = { userObjectId: "user", siteId: "site-id", driveId: "drive-id", itemId: "item-id" };
const hooks = env.TEST_HOOKS.getByName("hooks");

async function connectedUser() {
  const id = env.USER_ACCOUNT.newUniqueId();
  const stub = env.USER_ACCOUNT.get(id);
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.kv.put("refreshToken", "refresh");
    state.storage.kv.put("accessToken", {
      token: "observer-token", expires: new Date(Date.now() + 3_600_000), scopes: ["Sites.Selected"],
    });
  });
  return id.toString();
}

afterEach(() => vi.unstubAllGlobals());

describe("SharePoint resource dispatch", () => {
  it("dispatches the canonical immutable SharePoint URL", async () => {
    expect(await hooks.dispatchResult(
      "https://sharepoint.microsoft.com/site/site-id/drive/drive-id/item/item-id",
    )).toEqual({
      pattern: "https://sharepoint.microsoft.com/site/:siteId/drive/:driveId/item/:itemId",
    });
  });

  it.each([
    "https://knoxnswedu.sharepoint.com/sites/digital-utilities/Shared%20Documents/test-uploads/os-test/Test.txt",
    "https://example.com/site/site-id/drive/drive-id/item/item-id",
  ])("rejects mutable or foreign URL %s", async url => {
    expect(await hooks.dispatchResult(url)).toHaveProperty("error");
  });
});

describe("SharePoint observer and actions", () => {
  it("excludes an observer who can access the root folder but not a child file", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://download.example/child-file") {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 206,
          headers: { "Content-Length": "3" },
        });
      }
      if (url.endsWith("/items/child-file/content")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://download.example/child-file" },
        });
      }
      const child = url.includes("/items/child-file");
      return Response.json({
        id: child ? "child-file" : "item-id",
        name: child ? "Test.txt" : "os-test",
        webUrl: child
          ? "https://knoxnswedu.sharepoint.com/sites/digital-utilities/Shared%20Documents/test-uploads/os-test/Test.txt"
          : "https://knoxnswedu.sharepoint.com/sites/digital-utilities/Shared%20Documents/test-uploads/os-test",
        size: child ? 3 : 0,
        lastModifiedDateTime: "2026-09-01T00:00:00Z",
        ...(child
          ? { file: {}, parentReference: { id: "item-id" } }
          : { folder: { childCount: 1 } }),
      });
    }));

    const observations = await hooks.readChildWithRestrictedObserver(
      "restricted-child", { ...props, userObjectId: await connectedUser() }, "child-file");

    expect(observations.at(-1)?.excludeObservers).toEqual(["restricted-observer"]);
  });

  it("rejects a new observer who cannot access a child already read", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://download.example/child-file") {
        return new Response(new Uint8Array([1]), { status: 206 });
      }
      if (url.endsWith("/items/child-file/content")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://download.example/child-file" },
        });
      }
      const child = url.includes("/items/child-file");
      return Response.json({
        id: child ? "child-file" : "item-id",
        name: child ? "Test.txt" : "os-test",
        webUrl: `https://knoxnswedu.sharepoint.com/sites/digital-utilities/${child ? "Test.txt" : "os-test"}`,
        size: child ? 1 : 0,
        lastModifiedDateTime: "2026-09-01T00:00:00Z",
        ...(child
          ? { file: {}, parentReference: { id: "item-id" } }
          : { folder: { childCount: 1 } }),
      });
    }));

    const message = await hooks.readChildThenAddRestrictedObserver(
      "late-restricted", { ...props, userObjectId: await connectedUser() }, "child-file");

    expect(message).toMatch(/cannot access a SharePoint item this workspace has read/);
  });

  it("admits an observer with exact-item access", async () => {
    expect(await hooks.addObserver("allow", props, true)).toBeNull();
  });
  it("rejects a denied observer", async () => {
    expect(await hooks.addObserver("deny", props, false)).toMatch(/cannot access/);
  });
  it("propagates transient verifier failures", async () => {
    expect(await hooks.addObserver("failure", props, "verifier unavailable"))
      .toContain("verifier unavailable");
  });
  it.each(["apply", "reject", "revert"] as const)("rejects %sAction", async action => {
    expect(await hooks.actionMessage(action, props, action)).toContain("read-only");
  });
});

describe("Microsoft verifier", () => {
  it("returns true on exact-item success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      id: "item-id", name: "Test.txt", webUrl: "https://knoxnswedu.sharepoint.com/sites/digital-utilities/Shared%20Documents/test-uploads/os-test/Test.txt",
      size: 1, lastModifiedDateTime: "2026-09-01T00:00:00Z", file: {},
    })));
    expect(await hooks.verifierResult(await connectedUser(), props)).toEqual({ value: true });
  });

  it("maps a final Graph 401 to false after refreshing once", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/oauth2/v2.0/token")
        ? Response.json({ access_token: "refreshed-token", expires_in: 3600 })
        : new Response(null, { status: 401 })));
    expect(await hooks.verifierResult(await connectedUser(), props)).toEqual({ value: false });
  });

  it.each([403, 404])("maps Graph %s to false", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));
    expect(await hooks.verifierResult(await connectedUser(), props)).toEqual({ value: false });
  });

  it.each([429, 500])("propagates Graph %s", async status => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status })));
    expect(await hooks.verifierResult(await connectedUser(), props)).toHaveProperty("error");
  });

  it("propagates malformed responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ nope: true })));
    expect(await hooks.verifierResult(await connectedUser(), props)).toHaveProperty("error");
  });

  it("propagates missing credentials", async () => {
    expect(await hooks.verifierResult(env.USER_ACCOUNT.newUniqueId().toString(), props))
      .toHaveProperty("error");
  });
});
