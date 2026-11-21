import { z } from "zod";

import { AUDIENCE_MAX, AVOID_MAX, TAGLINE_MAX, VALUES_MAX, VOICE_MAX, WORD_MAX } from "./brand";

/**
 * The schemas of brand.ts (bloat review step 2.46), apart from its constants and helpers, so a screen that only reads a constant
 * or a helper loads no zod. Import this file only where a schema runs; brand.ts imports it as a type alone.
 */

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
