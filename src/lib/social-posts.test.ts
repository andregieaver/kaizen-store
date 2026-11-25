import { describe, expect, it } from "vitest";

import { channelBrief, cleanHashtag, copyText, newPostRef, parseSocialPosts, postClaims } from "./social-posts";
import { postContent } from "./post-links";

describe("the social post creator's parts (D870 C1)", () => {
  it("makes a post reference the post link accepts", () => {
    const ref = newPostRef();
    expect(ref).toMatch(/^[a-z0-9]{12}$/);
    expect(postContent(ref)).toBe(`p-${ref}`);
    expect(newPostRef(() => new Uint8Array(12))).toBe("aaaaaaaaaaaa");
  });

  it("tidies hashtags", () => {
    expect(cleanHashtag("#Sommer Kaffe!")).toBe("SommerKaffe");
    expect(cleanHashtag("##håndlaget_keramikk")).toBe("håndlaget_keramikk");
    expect(cleanHashtag("###")).toBe("");
    expect(cleanHashtag(42)).toBe("");
  });

  it("reads one post per channel asked for, in that order, and drops what was not asked for", () => {
    const answer = `Here: {"posts": [
      {"channel": "facebook", "title": "ignored", "caption": "  Our new mug.  ", "hashtags": ["#mugs", "a", "b", "c"]},
      {"channel": "pinterest", "title": "Stoneware mug", "caption": "A mug for slow mornings.", "hashtags": ["Mug", "mug"]},
      {"channel": "tiktok", "caption": "not asked", "hashtags": []}
    ]}`;
    expect(parseSocialPosts(answer, ["pinterest", "facebook"])).toEqual([
      { channel: "pinterest", title: "Stoneware mug", caption: "A mug for slow mornings.", hashtags: ["mug"] },
      { channel: "facebook", title: "", caption: "Our new mug.", hashtags: ["mugs", "a"] },
    ]);
  });

  it("refuses an answer that is no JSON or leaves a channel without a caption", () => {
    expect(parseSocialPosts("no", ["instagram"])).toBeNull();
    expect(parseSocialPosts(`{"posts": [{"channel": "instagram", "caption": ""}]}`, ["instagram"])).toBeNull();
    expect(parseSocialPosts(`{"posts": []}`, ["instagram"])).toBeNull();
  });

  it("finds prices, urgency and the brand's avoided words in a caption or a hashtag", () => {
    expect(postClaims({ title: "", caption: "Only 299 kr!", hashtags: [] }).map((c) => c.kind)).toContain("price");
    expect(postClaims({ title: "", caption: "A calm mug.", hashtags: ["cheap"] }, ["cheap"]).map((c) => c.kind)).toEqual(["avoided"]);
    expect(postClaims({ title: "", caption: "A calm mug for slow mornings.", hashtags: ["mugs"] })).toEqual([]);
  });

  it("copies the caption, code's price line, the link where it opens, and the hashtags", () => {
    const base = { title: "Stoneware mug", caption: "A mug for slow mornings.", hashtags: ["mugs", "coffee"], link: "https://shop.example/p/mug?utm_content=p-x", priceLine: "Stoneware mug · 299 kr" };
    expect(copyText({ ...base, channel: "facebook" })).toBe(
      "A mug for slow mornings.\n\nStoneware mug · 299 kr\n\nhttps://shop.example/p/mug?utm_content=p-x\n\n#mugs #coffee",
    );
    expect(copyText({ ...base, channel: "instagram", priceLine: null })).toBe("A mug for slow mornings.\n\n#mugs #coffee");
    expect(copyText({ ...base, channel: "pinterest", hashtags: [] })).toBe("Stoneware mug\n\nA mug for slow mornings.\n\nStoneware mug · 299 kr");
  });

  it("tells the writer each channel's length, hashtags and style", () => {
    const brief = channelBrief(["pinterest", "facebook"]);
    expect(brief).toContain("pinterest: about 300 characters, 0 to 3 hashtags, a title under 100 characters.");
    expect(brief).toContain("facebook: about 300 characters, 0 to 2 hashtags.");
  });
});

describe("the social post creator's pictures (D870 C2)", () => {
  it("takes a Pin's title, else the caption's first sentence, cut at a word", async () => {
    const { pictureHeadline, pictureFileName, PICTURE_SIZES } = await import("./social-posts");
    expect(pictureHeadline({ title: "Late opening", caption: "We are open." })).toBe("Late opening");
    expect(pictureHeadline({ title: "", caption: "Open late on Thursdays. Come by!" })).toBe("Open late on Thursdays.");
    const long = pictureHeadline({ title: "", caption: "word ".repeat(40) });
    expect(long.length).toBeLessThanOrEqual(91);
    expect(long.endsWith("…")).toBe(true);
    expect(pictureFileName("tiktok", "abcdef123456")).toBe("tiktok-abcdef123456-9x16.png");
    expect(PICTURE_SIZES.instagram).toMatchObject({ width: 1080, height: 1350 });
  });
});
