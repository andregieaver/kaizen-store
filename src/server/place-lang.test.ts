import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/menus", () => ({ storeSlugOf: async () => null }));
vi.mock("@/server/stores", () => ({ getOpenStore: async () => null }));
vi.mock("@/server/shop", () => ({ marketIn: () => undefined }));

const { placeLang } = await import("./place-lang");

describe("the language a page is shown in at its place", () => {
  it("is the language of Kaizena Flow's own page: Norwegian under /no, English otherwise (D312)", async () => {
    expect(await placeLang({ pageId: null, owner: null, lang: "nb" })).toBe("nb");
    expect(await placeLang({ pageId: null, owner: null, lang: "en" })).toBe("en");
    expect(await placeLang({ pageId: null, owner: null })).toBe("en");
  });

  it("is English for a store that cannot be found", async () => {
    expect(await placeLang({ pageId: null, owner: "00000000-0000-4000-8000-000000000001" })).toBe("en");
  });
});
