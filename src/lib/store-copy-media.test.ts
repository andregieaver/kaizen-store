import { describe, expect, it } from "vitest";

import {
  contentTypeOf,
  copyPathFor,
  isStoreFile,
  mediaKindOf,
  rewriteFiles,
  storeFileUrls,
  storeFileUrlsIn,
  storageRef,
} from "./store-copy-media";

const S = "11111111-2222-4333-8444-555555555555";
const N = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const base = "https://x.supabase.co/storage/v1/object/public";
const own = (name: string, bucket = "product-media") => `${base}/${bucket}/${S}/${name}`;
const fresh = (name: string, bucket = "product-media") => `${base}/${bucket}/${N}/${name}`;

describe("addresses in Storage", () => {
  it("reads the bucket and path of a public file, and nothing else", () => {
    expect(storageRef(own("a.webp"))).toEqual({ bucket: "product-media", path: `${S}/a.webp` });
    expect(storageRef("https://example.com/a.webp")).toBeNull();
    expect(storageRef(`${base}/product-media`)).toBeNull();
    expect(storageRef("not a url")).toBeNull();
  });

  it("knows which files are the store's own: in its folder, in any public bucket", () => {
    expect(isStoreFile(own("a.webp"), S)).toBe(true);
    expect(isStoreFile(own("v.mp4", "page-videos"), S)).toBe(true);
    expect(isStoreFile(fresh("a.webp"), S)).toBe(false);
    expect(isStoreFile(`https://example.com/${S}/a.webp`, S)).toBe(false);
    expect(isStoreFile(`${base}/product-media/platform/a.webp`, S)).toBe(false);
  });

  it("finds them in JSON, CSS and HTML, once each", () => {
    const text = `{"a":"${own("a.webp")}","b":"${own("a.webp")}"} .x{background:url(${own("b.png")})} <img src='${own("c.jpg")}'>`;
    expect(storeFileUrlsIn(text, S)).toEqual([own("a.webp"), own("b.png"), own("c.jpg")]);
    expect(storeFileUrls({ rows: [{ image: { url: own("a.webp") } }], other: "https://example.com/x.png" }, S)).toEqual(
      [own("a.webp")],
    );
  });
});

describe("rewriting content to the copy's files", () => {
  const resolve = (url: string) => (url.includes("broken") ? null : url.replace(S, N));

  it("puts the new address where the old one was, anywhere in a value, and leaves other addresses", () => {
    const value = {
      title: "Page",
      rows: [{ image: { url: own("a.webp"), width: 10, height: 10 }, link: "https://example.com/a.webp" }],
      css: `.hero{background:url(${own("b.png")})}`,
      list: [own("c.jpg"), "text"],
    };
    expect(rewriteFiles(value, S, resolve)).toEqual({
      title: "Page",
      rows: [{ image: { url: fresh("a.webp"), width: 10, height: 10 }, link: "https://example.com/a.webp" }],
      css: `.hero{background:url(${fresh("b.png")})}`,
      list: [fresh("c.jpg"), "text"],
    });
    // The input is not changed.
    expect(value.rows[0].image.url).toBe(own("a.webp"));
  });

  it("leaves out what could not be copied, never leaving the original's address", () => {
    const value = {
      image: { url: own("broken.webp"), width: 1, height: 1 },
      gallery: [{ url: own("broken2.webp") }, { url: own("ok.webp") }],
      logo: { url: own("ok.webp"), smallUrl: own("broken-small.webp") },
      thumbnail: own("broken-thumb.webp"),
      css: `a{background:url(${own("broken.png")})}`,
      keep: "x",
    };
    const out = rewriteFiles(value, S, resolve);
    expect(out).toEqual({
      gallery: [{ url: fresh("ok.webp") }],
      logo: { url: fresh("ok.webp") },
      css: "a{background:url()}",
      keep: "x",
    });
    expect(storeFileUrls(out, S)).toEqual([]);
  });

  it("returns null for a root that is left out, and a string that is not a file as it is", () => {
    expect(rewriteFiles(own("broken.webp"), S, resolve)).toBeNull();
    expect(rewriteFiles("hello", S, resolve)).toBe("hello");
    expect(rewriteFiles(null, S, resolve)).toBeNull();
  });
});

describe("where the copies go", () => {
  it("names the copy in the new store's folder, keeping the extension", () => {
    expect(copyPathFor({ bucket: "product-media", path: `${S}/x-480.webp` }, N, "abc")).toBe(`${N}/abc.webp`);
    expect(copyPathFor({ bucket: "page-videos", path: `${S}/x.mp4` }, N, "abc")).toBe(`${N}/abc.mp4`);
  });

  it("keeps a custom field file's readable name one level under the folder", () => {
    const path = copyPathFor(
      { bucket: "field-files", path: `${S}/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f-price-list.pdf` },
      N,
      "abc",
    );
    expect(path).toBe(`${N}/abc-price-list.pdf`);
    expect(path.slice(N.length + 1)).not.toContain("/");
  });

  it("guesses a kind and type for a file the library never held", () => {
    expect(contentTypeOf("a/b.WEBP")).toBe("image/webp");
    expect(mediaKindOf("a/b.mp4")).toBe("video");
    expect(mediaKindOf("a/b.png")).toBe("image");
    expect(contentTypeOf("a/b.bin")).toBe("application/octet-stream");
  });
});
