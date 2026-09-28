import { describe, expect, it } from "vitest";

import { embedUrl, vimeoId, youtubeId } from "./video-embed";

describe("videos from YouTube and Vimeo (D91)", () => {
  it("finds a YouTube video from any of its addresses", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      " https://www.youtube.com/live/dQw4w9WgXcQ ",
    ]) {
      expect(youtubeId(link), link).toBe("dQw4w9WgXcQ");
    }
    for (const link of ["https://www.youtube.com/channel/UC123", "https://evil.example/watch?v=dQw4w9WgXcQ", "not a link", "https://youtu.be/short"]) {
      expect(youtubeId(link), link).toBeNull();
    }
  });

  it("finds a Vimeo video and an unlisted one's hash", () => {
    expect(vimeoId("https://vimeo.com/76979871")).toEqual({ id: "76979871", hash: null });
    expect(vimeoId("https://vimeo.com/76979871/8272103f6e")).toEqual({ id: "76979871", hash: "8272103f6e" });
    expect(vimeoId("https://player.vimeo.com/video/76979871?h=8272103f6e")).toEqual({ id: "76979871", hash: "8272103f6e" });
    expect(vimeoId("https://vimeo.com/channels/staffpicks/76979871")).toEqual({ id: "76979871", hash: null });
    expect(vimeoId("https://vimeo.com/about")).toBeNull();
    expect(vimeoId("https://example.com/76979871")).toBeNull();
  });

  it("plays from YouTube's privacy-enhanced host and with Vimeo's do-not-track", () => {
    expect(embedUrl("youtube", "https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0");
    expect(embedUrl("vimeo", "https://vimeo.com/76979871/8272103f6e")).toBe("https://player.vimeo.com/video/76979871?autoplay=1&dnt=1&h=8272103f6e");
    expect(embedUrl("youtube", "https://vimeo.com/76979871")).toBeNull();
  });
});
