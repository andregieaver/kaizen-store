import { describe, expect, it } from "vitest";

import { grantsVideoPublish, parseCreator, parseInit, parseTokens, postState, privacyFor, renewDue, tiktokAuthorizeUrl, tiktokRefusal, videoInitBody, videoUrl } from "./tiktok";

/** TikTok (D870 S3.5): the sign-in, the tokens, private until audited, the file upload's start, and where a post stands. */

describe("TikTok", () => {
  it("asks to read the account and post videos", () => {
    const url = new URL(tiktokAuthorizeUrl("awkey", "https://kaizenaflow.com/api/integrations/tiktok/callback", "s1"));
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("awkey");
    expect(url.searchParams.get("scope")).toBe("user.info.basic,video.publish");
  });

  it("reads the tokens, renewed within the hour before they end", () => {
    const now = new Date("2030-01-01T00:00:00Z");
    const t = parseTokens({ access_token: "act.a", refresh_token: "rft.a", open_id: "-000abc", expires_in: 86400, refresh_expires_in: 31536000, scope: "user.info.basic,video.publish" }, now)!;
    expect(t.expiresAt.toISOString()).toBe("2030-01-02T00:00:00.000Z");
    expect(grantsVideoPublish(t.scopes)).toBe(true);
    expect(parseTokens({ access_token: "x", expires_in: 1 }, now)).toBeNull();
    expect(renewDue(new Date("2030-01-01T00:30:00Z"), now)).toBe(true);
    expect(renewDue(new Date("2030-01-01T05:00:00Z"), now)).toBe(false);
  });

  it("posts privately until the app is audited, and publicly after where the account allows it", () => {
    const creator = parseCreator({ data: { creator_username: "theshop", privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"] } });
    expect(creator.username).toBe("theshop");
    expect(privacyFor(creator.privacy, false)).toBe("SELF_ONLY");
    expect(privacyFor(creator.privacy, true)).toBe("PUBLIC_TO_EVERYONE");
    expect(privacyFor(["SELF_ONLY"], true)).toBe("SELF_ONLY");
  });

  it("starts a one-piece upload and reads where the post stands", () => {
    expect(videoInitBody("Words", "SELF_ONLY", 1234).source_info).toEqual({ source: "FILE_UPLOAD", video_size: 1234, chunk_size: 1234, total_chunk_count: 1 });
    expect(parseInit({ data: { publish_id: "v_pub_file~v2.123", upload_url: "https://open-upload.tiktokapis.com/video/?upload_id=1" } })).toEqual({
      publishId: "v_pub_file~v2.123",
      uploadUrl: "https://open-upload.tiktokapis.com/video/?upload_id=1",
    });
    expect(parseInit({ data: { publish_id: "x", upload_url: "http://insecure" } })).toBeNull();
    expect(postState({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7300000000000000000] } })).toEqual({ state: "done", postId: "7300000000000000000" });
    expect(postState({ data: { status: "PUBLISH_COMPLETE" } })).toEqual({ state: "done", postId: null });
    expect(postState({ data: { status: "FAILED", fail_reason: "video_pull_failed" } })).toEqual({ state: "failed", reason: "video_pull_failed" });
    expect(postState({ data: { status: "PROCESSING_UPLOAD" } })).toEqual({ state: "working" });
    expect(tiktokRefusal({ error: { code: "ok" } })).toBeNull();
    expect(tiktokRefusal({ error: { code: "spam_risk_too_many_posts", message: "Too many posts" } })).toBe("Too many posts");
    expect(videoUrl("theshop", "7300000000000000000")).toBe("https://www.tiktok.com/@theshop/video/7300000000000000000");
    expect(videoUrl("theshop", null)).toBeNull();
  });
});
