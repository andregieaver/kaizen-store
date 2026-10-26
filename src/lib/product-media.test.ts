import { describe, expect, it } from "vitest";

import { MAX_MEDIA, MAX_MODELS, MAX_VIDEOS, mediaFileOk, mediaProblems, ownMediaFile, pictureItem, type MediaItemShape } from "./product-media";
import { productInput } from "./product-input";

/** A product's gallery items (wave 6 unit G, D325, `docs/wave-6-catalogue.md` Unit G). */

const STORE = "11111111-2222-4333-8444-555555555555";
const BASE = "https://project.supabase.co/storage/v1/object/public";
const video = (n = 1): MediaItemShape => ({ kind: "video", source: "upload", mediaUrl: `${BASE}/page-videos/${STORE}/v${n}.mp4` });
const youtube: MediaItemShape = { kind: "video", source: "youtube", mediaUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" };
const model = (n = 1): MediaItemShape => ({ kind: "model", source: null, mediaUrl: `${BASE}/product-models/${STORE}/m${n}.glb` });
const image: MediaItemShape = { kind: "image", source: null, mediaUrl: null };

describe("a gallery's limits", () => {
  it("holds at most 20 items, 5 videos and 3 models", () => {
    expect([MAX_MEDIA, MAX_VIDEOS, MAX_MODELS]).toEqual([20, 5, 3]);
    expect(mediaProblems([image, video(1), youtube, model(1)])).toEqual([]);
    expect(mediaProblems(Array.from({ length: 6 }, (_, i) => video(i)))).toEqual(["Use at most 5 videos."]);
    expect(mediaProblems(Array.from({ length: 4 }, (_, i) => model(i)))).toEqual(["Use at most 3 3D models."]);
  });

  it("holds what each kind needs", () => {
    expect(mediaProblems([{ ...image, mediaUrl: "x" }])).toEqual(["A picture holds no video or model."]);
    expect(mediaProblems([{ kind: "video", source: null, mediaUrl: null }])).toEqual(["A video needs its file or a YouTube or Vimeo address."]);
    expect(mediaProblems([{ kind: "video", source: "vimeo", mediaUrl: "https://example.com/v" }])).toEqual(["That is not a Vimeo video's address."]);
    expect(mediaProblems([{ kind: "model", source: null, mediaUrl: null }])).toEqual(["A 3D model needs its file."]);
  });

  it("is what the product's input says, so the editor and the server agree", () => {
    const item = (shape: MediaItemShape, n: number) => ({ ...pictureItem(`https://x.example/p${n}.webp`, null), ...shape });
    const media = productInput.shape.media;
    expect(media.safeParse(Array.from({ length: MAX_MEDIA }, (_, n) => item(image, n))).success).toBe(true);
    expect(media.safeParse(Array.from({ length: MAX_MEDIA + 1 }, (_, n) => item(image, n))).success).toBe(false);
    // Older saved data without a kind reads as a picture.
    expect(media.parse([{ url: "https://x.example/a.webp", thumbnailUrl: null, alt: "A" }])[0]).toMatchObject({ kind: "image", source: null, mediaUrl: null, alts: {} });
  });
});

describe("a store's own files", () => {
  it("are one level under the store's folder of the kind's bucket", () => {
    expect(ownMediaFile(`${BASE}/page-videos/${STORE}/v.mp4`, "page-videos", STORE)).toBe(true);
    expect(ownMediaFile(`${BASE}/page-videos/other-store/v.mp4`, "page-videos", STORE)).toBe(false);
    expect(ownMediaFile(`${BASE}/product-models/${STORE}/v.mp4`, "page-videos", STORE)).toBe(false);
    expect(ownMediaFile(`${BASE}/page-videos/${STORE}/a/b.mp4`, "page-videos", STORE)).toBe(false);
    expect(ownMediaFile("https://example.com/video.mp4", "page-videos", STORE)).toBe(false);
  });

  it("decide whether an item may play", () => {
    expect(mediaFileOk(image, STORE)).toBe(true);
    expect(mediaFileOk(video(), STORE)).toBe(true);
    expect(mediaFileOk(youtube, STORE)).toBe(true);
    expect(mediaFileOk(model(), STORE)).toBe(true);
    expect(mediaFileOk({ ...model(), mediaUrl: `${BASE}/page-videos/${STORE}/m.glb` }, STORE)).toBe(false);
    expect(mediaFileOk({ kind: "video", source: "upload", mediaUrl: "https://example.com/v.mp4" }, STORE)).toBe(false);
  });
});
