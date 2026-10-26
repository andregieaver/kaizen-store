import { z } from "zod";

/**
 * A store's brand set down in words (D330, `docs/ai-autopilot.md` 14.1): a tagline customers may see, and the voice, audience, values and
 * words to avoid that guide the AI's own writing. Pure: the limits and the tools' input; `src/server/brand.ts` keeps it.
 */

export const TAGLINE_MAX = 120;
export const VOICE_MAX = 600;
export const AUDIENCE_MAX = 400;
export const VALUES_MAX = 5;
export const AVOID_MAX = 10;
export const WORD_MAX = 40;

const word = z.string().trim().min(1).max(WORD_MAX);

/** `set_brand`: only the fields given change; an empty text or list clears one. */
export const brandInput = z.object({
  tagline: z.string().trim().max(TAGLINE_MAX).optional().describe("A short line customers may see beside the store's name. No claims (best, cheapest, green) the store cannot show."),
  voice: z.string().trim().max(VOICE_MAX).optional().describe("How the brand speaks: tone, sentence length, formality, what it sounds like and what it never sounds like."),
  audience: z.string().trim().max(AUDIENCE_MAX).optional().describe("Who the business is for, in plain words."),
  values: z.array(word).max(VALUES_MAX).optional().describe("Up to five short words the brand stands for."),
  avoid: z.array(word).max(AVOID_MAX).optional().describe("Up to ten words or phrases the brand never uses."),
});
export type BrandInput = z.infer<typeof brandInput>;

export type Brand = { tagline: string; voice: string; audience: string; values: string[]; avoid: string[]; updatedAt: string | null };

export const EMPTY_BRAND: Brand = { tagline: "", voice: "", audience: "", values: [], avoid: [], updatedAt: null };

/** Words of a list kept once each, in the order given (compared without case). */
export function uniqueWords(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const key = w.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(w.trim());
  }
  return out;
}
