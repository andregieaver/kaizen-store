import { describe, expect, it } from "vitest";

import { restingTime, videoPlay, videoPoster } from "./video-play";

const settings = { controls: false, autoplay: false, loop: false, once: false };

describe("how an uploaded video plays", () => {
  it("always shows the controls of a video that does not start by itself, so it can be played", () => {
    expect(videoPlay(settings)).toEqual({ controls: true, muted: false, loop: false, once: false });
    expect(videoPlay({ ...settings, loop: true })).toMatchObject({ controls: true, loop: true });
  });

  it("starts muted and loops when it starts by itself, as videos from before could only do", () => {
    expect(videoPlay({ ...settings, autoplay: true })).toEqual({ controls: false, muted: true, loop: true, once: false });
    expect(videoPlay({ ...settings, autoplay: true, controls: true })).toMatchObject({ controls: true, loop: true });
  });

  it("plays once and stops when set to, with no controls unless they are asked for", () => {
    expect(videoPlay({ ...settings, autoplay: true, once: true })).toEqual({ controls: false, muted: true, loop: false, once: true });
    // Loop is the other answer to the same question: once wins, as the builder's one switch writes only one of them.
    expect(videoPlay({ ...settings, autoplay: true, once: true, loop: true })).toMatchObject({ loop: false, once: true });
    expect(videoPlay({ ...settings, autoplay: true, once: true, controls: true })).toMatchObject({ controls: true, loop: false });
  });

  it("ignores play once on a video the visitor starts: it stops at its end by itself", () => {
    expect(videoPlay({ ...settings, once: true })).toEqual({ controls: true, muted: false, loop: false, once: false });
    expect(videoPlay({ ...settings, once: true, loop: true })).toMatchObject({ loop: true, once: false });
  });

  it("shows no picture before a video that plays once, and the picture before any other", () => {
    expect(videoPoster(videoPlay({ ...settings, autoplay: true, once: true }), "https://e.com/p.webp")).toBeUndefined();
    expect(videoPoster(videoPlay({ ...settings, autoplay: true }), "https://e.com/p.webp")).toBe("https://e.com/p.webp");
    expect(videoPoster(videoPlay(settings), undefined)).toBeUndefined();
  });

  it("rests just inside the end, and nowhere while the length is not known", () => {
    expect(restingTime(6)).toBeCloseTo(5.95);
    expect(restingTime(0.02)).toBe(0);
    expect(restingTime(Number.NaN)).toBeNull();
    expect(restingTime(Number.POSITIVE_INFINITY)).toBeNull();
    expect(restingTime(0)).toBeNull();
  });
});
