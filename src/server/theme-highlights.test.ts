import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { composeHighlights } = await import("./theme-highlights");
const { checkedSuggestion } = await import("./theme-highlight-words");

const png = (width: number, height: number, background: string) => sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

/** A theme's highlights drawn from its photographs, and the AI's words checked (`docs/theme-showcase-phase-2.md` step 2). */
describe("the highlights drawn", () => {
  it("are three 1600 × 1000 WebP pictures, with or without a close photograph of the product", async () => {
    const sources = {
      computerFull: await png(1440, 4000, "#ddeeff"),
      computerScreen: await png(1440, 900, "#ddeeff"),
      phoneFull: await png(390, 3000, "#ffeedd"),
      phoneScreen: await png(780, 1688, "#ffeedd"),
      parts: { length: 4000, header: { top: 0, height: 80 }, rows: [{ top: 80, height: 700 }, { top: 780, height: 600 }], product: { top: 1380, height: 650 }, footer: { top: 3600, height: 400 } },
      phoneParts: null,
      palette: { surface: "#f6f3ee", accent: "#3d6b4f" },
    };
    for (const detail of [null, await png(2048, 1300, "#223344")]) {
      const made = await composeHighlights({ ...sources, detail });
      expect(made.map((h) => [h.kind, h.width, h.height])).toEqual([
        ["devices", 1600, 1000],
        ["collage", 1600, 1000],
        ["closeup", 1600, 1000],
      ]);
      for (const h of made) expect((await sharp(h.bytes).metadata()).format).toBe("webp");
    }
  });

  it("put the theme's colours behind the pictures (its corners are the backdrop)", async () => {
    const made = await composeHighlights({
      computerFull: await png(1440, 2000, "#ffffff"),
      computerScreen: await png(1440, 900, "#ffffff"),
      detail: null,
      phoneFull: await png(390, 2000, "#ffffff"),
      phoneScreen: await png(780, 1688, "#ffffff"),
      parts: null,
      phoneParts: null,
      palette: { surface: "#ffffff", accent: "#00ff00" },
    });
    const { data } = await sharp(made[0].bytes).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect(data[1]).toBeGreaterThan(data[0]);
  });
});

describe("the AI's words for the highlights", () => {
  it("are kept per picture only when they make no claim and no superlative, from JSON in the model's answer", () => {
    const answer = 'Here you go:\n```json\n{"devices":{"title":"On every screen","text":"Phones and computers alike."},"collage":{"title":"The best theme ever","text":"Guaranteed sales."},"closeup":{"title":"Up close","text":"An eco-friendly look."}}\n```';
    const { words, leftOut } = checkedSuggestion(answer);
    expect(words).toEqual({ devices: { title: "On every screen", text: "Phones and computers alike." } });
    expect(leftOut).toEqual(["collage", "closeup"]);
    expect(checkedSuggestion("no json here")).toEqual({ words: {}, leftOut: [] });
  });
});
