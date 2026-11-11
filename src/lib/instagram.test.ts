import { describe, expect, it } from "vitest";

import { authorizeUrl, captionText, cleanHashtags, feedPosts, hashtagsOf, isInstagramPicture, keptPosts, parsePosts, postsDue, tokenDue, type InstagramPost } from "./instagram";

const pic = "https://scontent-arn2-1.cdninstagram.com/v/t51/1.jpg?x=1";
const post = (id: string, caption: string, at: string): InstagramPost => ({ id, caption, kind: "image", picture: pic, permalink: `https://www.instagram.com/p/${id}/`, at });

describe("an account's posts (D543)", () => {
  it("keeps posts with a picture on Instagram's hosts and a permalink, a video by its cover, newest first", () => {
    const posts = parsePosts({
      data: [
        { id: "1", caption: "old", media_type: "IMAGE", media_url: pic, permalink: "https://www.instagram.com/p/1/", timestamp: "2026-11-01T10:00:00+0000" },
        { id: "2", caption: "clip", media_type: "VIDEO", media_url: "https://video.cdninstagram.com/v.mp4", thumbnail_url: pic, permalink: "https://www.instagram.com/reel/2/", timestamp: "2026-11-05T10:00:00+0000" },
        { id: "3", media_type: "IMAGE", media_url: "https://evil.example.com/x.jpg", permalink: "https://www.instagram.com/p/3/", timestamp: "2026-11-06T10:00:00+0000" },
        { id: "4", media_type: "IMAGE", media_url: pic, permalink: "https://evil.example.com/p/4", timestamp: "2026-11-06T10:00:00+0000" },
      ],
    });
    expect(posts.map((p) => [p.id, p.kind])).toEqual([
      ["2", "video"],
      ["1", "image"],
    ]);
    expect(posts[0].picture).toBe(pic);
    // A video keeps its own file for the proxy, from Instagram's hosts only.
    expect(posts[0].video).toBe("https://video.cdninstagram.com/v.mp4");
    expect(posts[1].video).toBeUndefined();
    expect(parsePosts({ data: [{ id: "5", media_type: "VIDEO", media_url: "https://evil.example.com/v.mp4", thumbnail_url: pic, permalink: "https://www.instagram.com/reel/5/", timestamp: "2026-11-05T10:00:00+0000" }] })[0].video).toBeUndefined();
    expect(parsePosts(null)).toEqual([]);
  });

  it("never reads back a picture or a video from elsewhere", () => {
    expect(keptPosts([{ ...post("9", "", "2026-11-01T00:00:00.000Z"), kind: "video", video: "https://example.com/v.mp4" }])).toEqual([]);
    expect(keptPosts([post("1", "", "2026-11-01T00:00:00.000Z"), { ...post("2", "", "2026-11-01T00:00:00.000Z"), picture: "https://example.com/a.jpg" }]).map((p) => p.id)).toEqual(["1"]);
    expect(isInstagramPicture("http://scontent.cdninstagram.com/a.jpg")).toBe(false);
    expect(isInstagramPicture("https://x.fbcdn.net/a.jpg")).toBe(true);
    expect(isInstagramPicture("https://cdninstagram.com.evil.io/a.jpg")).toBe(false);
  });
});

describe("hashtags", () => {
  it("are found in any script, lower case, once", () => {
    expect(hashtagsOf("Sommer! #Sommer #nyhet #sommer #blåbær #2026_sale")).toEqual(["sommer", "nyhet", "blåbær", "2026_sale"]);
  });

  it("are cleaned from what the owner typed", () => {
    expect(cleanHashtags("#Summer, sale  #NewIn #new-in ##summer")).toEqual(["summer", "sale", "newin"]);
    expect(cleanHashtags(Array.from({ length: 15 }, (_, i) => `t${i}`))).toHaveLength(10);
  });

  it("narrow a feed by any or all of them, newest first, with every post when none is named", () => {
    const posts = [post("1", "a #summer", "2026-11-01T00:00:00.000Z"), post("2", "b #summer #sale", "2026-11-03T00:00:00.000Z"), post("3", "c #winter", "2026-11-02T00:00:00.000Z")];
    expect(feedPosts(posts, ["summer"], "any", 10).map((p) => p.id)).toEqual(["2", "1"]);
    expect(feedPosts(posts, ["summer", "sale"], "all", 10).map((p) => p.id)).toEqual(["2"]);
    expect(feedPosts(posts, ["summer", "winter"], "any", 10).map((p) => p.id)).toEqual(["2", "3", "1"]);
    expect(feedPosts(posts, [], "any", 2).map((p) => p.id)).toEqual(["2", "3"]);
  });

  it("are left out of a caption as shown", () => {
    expect(captionText("New mugs are in!  #ceramics #handmade")).toBe("New mugs are in!");
  });
});

describe("connecting and upkeep", () => {
  it("asks Instagram for the one scope that reads the account's own posts", () => {
    const url = new URL(authorizeUrl("123", "https://kaizenaflow.com/api/integrations/instagram/callback", "s"));
    expect(url.host).toBe("www.instagram.com");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic");
    expect(url.searchParams.get("state")).toBe("s");
  });

  it("refreshes a token with under 30 days left, and reads the posts hourly", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(tokenDue(new Date("2026-11-30T12:00:00Z"), now)).toBe(true);
    expect(tokenDue(new Date("2027-01-01T12:00:00Z"), now)).toBe(false);
    expect(postsDue(null, now)).toBe(true);
    expect(postsDue(new Date("2026-11-10T11:30:00Z"), now)).toBe(false);
    expect(postsDue(new Date("2026-11-10T10:59:00Z"), now)).toBe(true);
  });
});
