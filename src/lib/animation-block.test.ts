import { describe, expect, it } from "vitest";

import { makeAnimation } from "./animation-make";
import { pageIssues } from "./page-a11y";
import { animationDisplaySize, animationPicture, blockHasContent, blockText, hasPictureBox, newPageContent, pageInput, type AnimationBlock } from "./page-content";
import { newBlock } from "./page-rows";
import { blockTextFields, localizePage } from "./page-translation";
import { mapTemplateMedia } from "./template-content";
import { UNDRAWN_TEXTS } from "./typography";

/** The Animation component (D538): what it keeps, refuses and shows, and what the builder's other parts make of it. */

const file = {
  video: { url: "https://files.test/storage/v1/object/public/page-videos/s1/logo.mp4" },
  still: { url: "https://files.test/storage/v1/object/public/product-media/s1/logo.webp", width: 1600, height: 900 },
  width: 1394,
  height: 784,
};
const animation = (over: Record<string, unknown> = {}) => ({ id: "a", type: "animation", animation: file, alt: "Our logo, drawing itself", ...over });
const page = (blocks: unknown[]) => ({
  ...newPageContent(),
  title: "Animation",
  slug: "animation",
  rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks }] }],
});
const parse = (block: unknown) => pageInput.parse(page([block])).rows[0].columns[0].blocks[0] as AnimationBlock;
const problems = (block: unknown) => {
  const parsed = pageInput.safeParse(page([block]));
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
};

describe("an animation in a page", () => {
  it("starts empty and shows once it has its files", () => {
    const fresh = newBlock("animation", () => "n");
    expect(fresh).toEqual({ id: "n", type: "animation", animation: null, alt: "" });
    expect(blockHasContent(fresh)).toBe(false);
    expect(hasPictureBox(fresh)).toBe(false);
    expect(animationDisplaySize(fresh as AnimationBlock)).toBeNull();
    const full = parse(animation());
    expect(blockHasContent(full)).toBe(true);
    expect(hasPictureBox(full)).toBe(true);
    expect(blockText(full)).toBe("Our logo, drawing itself");
  });

  it("keeps how it plays, where it leads and how wide it is, and nothing it should not", () => {
    const kept = parse(animation({ loop: true, href: "/", newTab: true, maxWidth: 480, align: "center" }));
    expect(kept).toMatchObject({ loop: true, href: "/", newTab: true, maxWidth: 480, align: "center", animation: file });
    expect(parse(animation())).not.toHaveProperty("loop");
    expect(problems(animation({ href: "javascript:alert(1)" }))).toEqual(["An animation's link must be https://…, a page like /about, an anchor like #contact, mailto: or tel:."]);
    expect(problems(animation({ animation: { ...file, video: { url: "javascript:alert(1)" } } }))).toEqual(["An animation's video has an invalid address."]);
    expect(problems(animation({ animation: { ...file, still: { ...file.still, url: "data:image/png;base64,AA" } } }))).toEqual(["An animation's picture has an invalid address."]);
    expect(problems(animation({ animation: { ...file, width: 4 } }))).toHaveLength(1);
    expect(problems(animation({ loop: "yes" }))).toHaveLength(1);
    expect(problems(animation({ alt: "x".repeat(301) }))).toEqual(["Keep an animation's description under 300 characters."]);
  });

  it("is sized and placed as a picture is, by its last frame, and never enlarged", () => {
    const block = parse(animation());
    expect(animationPicture(block)).toEqual({ ...file.still, alt: "Our logo, drawing itself" });
    expect(animationDisplaySize(block)).toEqual({ width: 1600, height: 900 });
    expect(animationDisplaySize({ ...block, maxWidth: 400 })).toEqual({ width: 400, height: 225 });
    expect(animationDisplaySize({ ...block, maxWidth: 4000 })).toEqual({ width: 1600, height: 900 });
  });

  it("has its description translated, and it is words that are not drawn", () => {
    const block = parse(animation());
    expect(blockTextFields(block)).toEqual([{ key: "block.a.alt", label: "Description of the animation", value: "Our logo, drawing itself", max: 300 }]);
    const norwegian = localizePage(pageInput.parse({ ...page([animation()]), translations: { "nb-NO": { "block.a.alt": "Logoen vår, som tegner seg selv" } } }), "nb-NO");
    expect(norwegian.rows[0].columns[0].blocks[0]).toMatchObject({ alt: "Logoen vår, som tegner seg selv" });
    expect(UNDRAWN_TEXTS.animation).toEqual(["alt"]);
  });

  it("needs a description, as a picture does, before the page is published", () => {
    const issues = (block: unknown) => pageIssues(pageInput.parse(page([{ id: "h", type: "heading", text: "Us", level: 1 }, block]))).filter((issue) => issue.rule === "image_alt" || issue.rule === "alt_long");
    expect(issues(animation({ alt: "" })).map((issue) => issue.message)).toEqual(["This animation has no description, so a screen reader cannot say what it shows."]);
    expect(issues(animation())).toEqual([]);
    expect(issues(animation({ alt: "x".repeat(200) }))[0]?.rule).toBe("alt_long");
    // Nothing to describe yet.
    expect(issues(animation({ animation: null, alt: "" }))).toEqual([]);
  });

  it("is copied with both its files, and is left empty where either cannot come along", () => {
    const content = { rows: pageInput.parse(page([animation()])).rows };
    const moved = mapTemplateMedia("row", content.rows[0], (url) => url.replace("/s1/", "/s2/"));
    expect(JSON.stringify(moved)).toContain("/page-videos/s2/logo.mp4");
    expect(JSON.stringify(moved)).toContain("/product-media/s2/logo.webp");
    const half = mapTemplateMedia("row", content.rows[0], (url) => (url.endsWith(".mp4") ? null : url));
    expect(JSON.stringify(half)).toContain('"animation":null');
  });
});

describe("a logo that is an animation", () => {
  const logo = (over: Record<string, unknown> = {}) => ({ id: "l", type: "site", part: "logo", animation: file, ...over });

  it("is kept on the logo part with both its files, and refused with an address that is not a file's", () => {
    expect(pageInput.parse(page([logo()])).rows[0].columns[0].blocks[0]).toMatchObject({ type: "site", part: "logo", animation: file });
    expect(pageInput.parse(page([{ id: "l", type: "site", part: "logo" }])).rows[0].columns[0].blocks[0]).not.toHaveProperty("animation");
    expect(problems(logo({ animation: { ...file, video: { url: "javascript:alert(1)" } } }))).toEqual(["An animation's video has an invalid address."]);
  });

  it("comes along when a header is copied, and the part is the site's logo again where a file cannot", () => {
    const row = pageInput.parse(page([logo()])).rows[0];
    const moved = mapTemplateMedia("row", row, (url) => url.replace("/s1/", "/s2/"));
    expect(JSON.stringify(moved)).toContain("/page-videos/s2/logo.mp4");
    expect(JSON.stringify(moved)).toContain("/product-media/s2/logo.webp");
    const without = mapTemplateMedia("row", row, (url) => (url.endsWith(".webp") ? null : url));
    expect(JSON.stringify(without)).not.toContain("animation");
    expect(JSON.stringify(without)).toContain('"part":"logo"');
  });
});

describe("making an animation", () => {
  it("says no before opening a file that is not a WebM, wherever it runs", async () => {
    expect(await makeAnimation(new File(["x"], "logo.mp4", { type: "video/mp4" }))).toEqual({ ok: false, why: "type" });
    expect(await makeAnimation(new File([], "logo.webm", { type: "video/webm" }))).toEqual({ ok: false, why: "size" });
  });

  it("says the browser cannot where it has no encoder, as the test runner has none", async () => {
    expect(await makeAnimation(new File(["x"], "logo.webm", { type: "video/webm" }))).toEqual({ ok: false, why: "browser" });
  });
});
