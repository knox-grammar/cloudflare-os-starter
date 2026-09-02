import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@gadgets/configurator-ui", () => ({
  h: (component: unknown, props: unknown, ...children: unknown[]) => ({ component, props, children }),
  Section: "Section",
  Field: "Field",
  TextInput: "TextInput",
}));

async function spec() {
  vi.resetModules();
  return (await import("../../src/configurator/sharepoint-document-configurator-ui.js")).default;
}

const canonical = "https://sharepoint.microsoft.com/site/site-id/drive/drive-id/item/item-id";

describe("SharePoint configurator", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a browser URL to the canonical resource URL", async () => {
    const loaded = await spec();
    const resolveDocumentUrl = vi.fn(async () => ({ resourceUrl: canonical }));
    await expect(loaded.resourceUrl({
      values: { sharePointUrl: "https://knoxnswedu.sharepoint.com/sites/digital-utilities/Shared%20Documents/test-uploads/os-test/Test.txt" },
      ui: { resolveDocumentUrl },
    } as never)).resolves.toBe(canonical);
    expect(resolveDocumentUrl).toHaveBeenCalledOnce();
  });

  it("round-trips a canonical prefill", async () => {
    const loaded = await spec();
    const values = loaded.initialValuesFromResourceUrl({ resourceUrl: canonical } as never);
    expect(values).toEqual({ sharePointUrl: canonical });
    await expect(loaded.resourceUrl({
      values,
      ui: { resolveDocumentUrl: async (url: string) => ({ resourceUrl: url }) },
    } as never)).resolves.toBe(canonical);
  });

  it("resolves the current edited URL rather than retaining stale state", async () => {
    const loaded = await spec();
    const edited = "https://knoxnswedu.sharepoint.com/sites/digital-utilities/Shared%20Documents/test-uploads/os-test/Edited.txt";
    const resolveDocumentUrl = vi.fn(async () => ({ resourceUrl: canonical }));
    await loaded.resourceUrl({ values: { sharePointUrl: edited }, ui: { resolveDocumentUrl } } as never);
    expect(resolveDocumentUrl).toHaveBeenCalledWith(edited);
  });
});
