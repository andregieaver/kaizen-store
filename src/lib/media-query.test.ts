import { describe, expect, it } from "vitest";

import { fileNameKey, isFileNameQuery, MEDIA_MOST, MEDIA_PAGE, mediaAddress, mediaQuery, readableFileName } from "./media-query";

describe("a media library's address (D88)", () => {
  it("reads a search, falling back to the defaults", () => {
    expect(mediaQuery({})).toEqual({ q: "", kind: "all", sort: "newest", limit: MEDIA_PAGE, view: "grid" });
    expect(mediaQuery({ q: "  kopp ", kind: "video", sort: "largest", n: "96", view: "list" })).toEqual({
      q: "kopp",
      kind: "video",
      sort: "largest",
      limit: 96,
      view: "list",
    });
    expect(mediaQuery({ kind: "pdf", sort: "constructor", n: "-3", view: "table" })).toEqual({
      q: "",
      kind: "all",
      sort: "newest",
      limit: MEDIA_PAGE,
      view: "grid",
    });
    expect(mediaQuery({ q: ["a", "b"] }).q).toBe("a");
  });

  it("shows whole pages, and no more than the most", () => {
    expect(mediaQuery({ n: "50" }).limit).toBe(MEDIA_PAGE * 2);
    expect(mediaQuery({ n: "100000" }).limit).toBe(MEDIA_MOST);
  });

  it("writes an address with only what is not the default, and reads it back", () => {
    expect(mediaAddress("/admin/demo/media", mediaQuery({}))).toBe("/admin/demo/media");
    const query = mediaQuery({ q: "hvit kopp", kind: "image", sort: "name", n: "96", view: "list" });
    const address = mediaAddress("/admin/demo/media", query);
    expect(address).toBe("/admin/demo/media?q=hvit+kopp&kind=image&sort=name&n=96&view=list");
    expect(mediaQuery(Object.fromEntries(new URL(address, "https://x").searchParams))).toEqual(query);
  });
});

describe("searching for a file by its name", () => {
  it("tells a file's name from words about what it shows", () => {
    expect(isFileNameQuery("d58a9064-875d-450f-aceb-4e6b17a0716c.webp")).toBe(true);
    expect(isFileNameQuery("d58a9064-875d-450f-aceb-4e6b17a0716c")).toBe(true);
    expect(isFileNameQuery("kopp.jpg")).toBe(true);
    expect(isFileNameQuery("IMG_2034")).toBe(true);
    expect(isFileNameQuery("car")).toBe(false);
    expect(isFileNameQuery("rød bil 2024")).toBe(false);
    expect(isFileNameQuery("ev3")).toBe(false);
    expect(fileNameKey("  D58A9064-875D.WebP ")).toBe("d58a9064-875d");
  });

  it("keeps a name's words and leaves out ids and numbers", () => {
    expect(readableFileName("d58a9064-875d-450f-aceb-4e6b17a0716c.webp")).toBe("");
    expect(readableFileName("hvit_kopp-på.bord.webp")).toBe("hvit kopp på bord");
    expect(readableFileName("IMG_2034.jpg")).toBe("IMG");
    expect(readableFileName("kia-ev3-front-2024.png")).toBe("kia front");
  });
});
