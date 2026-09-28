import { describe, expect, it } from "vitest";

import { MEDIA_MOST, MEDIA_PAGE, mediaAddress, mediaQuery } from "./media-query";

describe("a media library's address (D88)", () => {
  it("reads a search, falling back to the defaults", () => {
    expect(mediaQuery({})).toEqual({ q: "", kind: "all", sort: "newest", limit: MEDIA_PAGE });
    expect(mediaQuery({ q: "  kopp ", kind: "video", sort: "largest", n: "96" })).toEqual({ q: "kopp", kind: "video", sort: "largest", limit: 96 });
    expect(mediaQuery({ kind: "pdf", sort: "constructor", n: "-3" })).toEqual({ q: "", kind: "all", sort: "newest", limit: MEDIA_PAGE });
    expect(mediaQuery({ q: ["a", "b"] }).q).toBe("a");
  });

  it("shows whole pages, and no more than the most", () => {
    expect(mediaQuery({ n: "50" }).limit).toBe(MEDIA_PAGE * 2);
    expect(mediaQuery({ n: "100000" }).limit).toBe(MEDIA_MOST);
  });

  it("writes an address with only what is not the default, and reads it back", () => {
    expect(mediaAddress("/admin/demo/media", mediaQuery({}))).toBe("/admin/demo/media");
    const query = mediaQuery({ q: "hvit kopp", kind: "image", sort: "name", n: "96" });
    const address = mediaAddress("/admin/demo/media", query);
    expect(address).toBe("/admin/demo/media?q=hvit+kopp&kind=image&sort=name&n=96");
    expect(mediaQuery(Object.fromEntries(new URL(address, "https://x").searchParams))).toEqual(query);
  });
});
