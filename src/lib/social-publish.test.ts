import { describe, expect, it } from "vitest";

import { containerState, idFrom, isPublishChannel, permalinkFrom, publishedText, publishKind } from "./social-publish";
import { grantsPagePublish, grantsPublish } from "./social-publish-grants";

describe("publishing an approved social post (D870 S3.1)", () => {
  it("publishes to Instagram and Facebook only, a post's video where it has one, else its picture", () => {
    expect(isPublishChannel("instagram")).toBe(true);
    expect(isPublishChannel("facebook")).toBe(true);
    expect(isPublishChannel("tiktok")).toBe(false);
    expect(publishKind(true)).toBe("video");
    expect(publishKind(false)).toBe("picture");
  });

  it("publishes the words the owner would copy: caption, price line, the link where it opens, hashtags", () => {
    const base = { title: "", caption: "Slow mornings.", hashtags: ["ceramics"], link: "https://shop.example/p/bowl?utm_content=x", priceLine: "Bowl · 449 kr" };
    expect(publishedText({ ...base, channel: "facebook" })).toBe("Slow mornings.\n\nBowl · 449 kr\n\nhttps://shop.example/p/bowl?utm_content=x\n\n#ceramics");
    // Instagram does not open links in a caption: none is put there.
    expect(publishedText({ ...base, channel: "instagram" })).not.toContain("https://");
    expect(publishedText({ ...base, channel: "instagram", caption: "x".repeat(5000) }).length).toBe(2200);
  });

  it("reads which permissions allow publishing", () => {
    expect(grantsPublish(["instagram_business_basic", "instagram_business_content_publish"])).toBe(true);
    expect(grantsPublish("instagram_business_basic,instagram_business_manage_insights")).toBe(false);
    expect(grantsPagePublish({ data: [{ permission: "pages_manage_posts", status: "granted" }] })).toBe(true);
    expect(grantsPagePublish({ data: [{ permission: "pages_manage_posts", status: "declined" }] })).toBe(false);
  });

  it("reads Meta's answers: ids, a container's state, and only a permalink of Instagram's or Facebook's own", () => {
    expect(idFrom({ id: "17895695668004550" })).toBe("17895695668004550");
    expect(idFrom({ id: "111", post_id: "111_222" }, "post_id")).toBe("111_222");
    expect(idFrom({ id: "not-an-id" })).toBeNull();
    expect(containerState({ status_code: "FINISHED" })).toBe("ready");
    expect(containerState({ status_code: "IN_PROGRESS" })).toBe("working");
    expect(containerState({ status_code: "ERROR" })).toBe("failed");
    expect(permalinkFrom({ permalink: "https://www.instagram.com/p/abc/" })).toBe("https://www.instagram.com/p/abc/");
    expect(permalinkFrom({ permalink_url: "https://www.facebook.com/111/posts/222" })).toBe("https://www.facebook.com/111/posts/222");
    expect(permalinkFrom({ permalink: "https://evil.example/p" })).toBeNull();
  });
});
