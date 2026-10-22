import { describe, expect, it } from "vitest";

import { findClaims } from "./claims";
import { HIGHLIGHT_WORDS_MAX } from "./theme-highlights";
import { LAUNCH_THEMES, launchListing } from "./launch-themes";
import { LISTING_WORDS_MAX, readListing } from "./theme-store";

describe("the launch themes in Norwegian (D312 P3)", () => {
  it("has every launch theme's summary, description and highlights in Norwegian, within their limits", () => {
    for (const theme of LAUNCH_THEMES) {
      const words = launchListing(theme).words?.nb;
      expect(words, theme.key).toBeDefined();
      expect(words!.summary!.length, theme.key).toBeLessThanOrEqual(LISTING_WORDS_MAX.summary);
      expect(words!.description!.length, theme.key).toBeLessThanOrEqual(LISTING_WORDS_MAX.description);
      for (const kind of Object.keys(theme.listing.highlights ?? {}) as (keyof NonNullable<typeof theme.listing.highlights>)[]) {
        const line = words!.highlights?.[kind];
        expect(line, `${theme.key} ${kind}`).toBeDefined();
        expect(line!.title.length, `${theme.key} ${kind}`).toBeLessThanOrEqual(HIGHLIGHT_WORDS_MAX.title);
        expect(line!.text.length, `${theme.key} ${kind}`).toBeLessThanOrEqual(HIGHLIGHT_WORDS_MAX.text);
      }
      // Read back as the store reads a listing, nothing is cut.
      expect(readListing(launchListing(theme)).words?.nb).toEqual(words);
    }
  });

  it("makes no claim a theme's words may not make", () => {
    for (const theme of LAUNCH_THEMES) {
      const words = launchListing(theme).words?.nb;
      const texts = [words?.summary, words?.description, ...Object.values(words?.highlights ?? {}).flatMap((line) => [line.title, line.text])];
      for (const text of texts) expect(findClaims(text ?? ""), `${theme.key}: ${text}`).toEqual([]);
    }
  });
});
