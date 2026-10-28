import { z } from "zod";

/** A store drafted from one description (D351): what `draft_store` and *Start from a description* take. */

export const DRAFT_PAGES_MAX = 3;

export const draftStoreInput = z.object({
  description: z.string().trim().min(10).max(1500).describe("What the store is, sells and stands for, in the owner's words."),
  front: z
    .object({ purpose: z.string().trim().min(1).max(1000), key_points: z.array(z.string().trim().min(1).max(400)).max(12).default([]) })
    .describe("The front page: what it is for and what it must say."),
  pages: z
    .array(z.object({ title: z.string().trim().min(1).max(200), purpose: z.string().trim().min(1).max(1000) }))
    .max(DRAFT_PAGES_MAX)
    .default([])
    .describe("Up to three more pages (About us, Contact, a service page), each with its title and purpose."),
  facts: z.array(z.string().trim().min(1).max(400)).max(20).default([]).describe("Facts the owner gave that the pages may state; never a price."),
  theme: z.uuid().optional().describe("A free theme's id from list_themes, added to the library (not live until the drafts are published)."),
  preset: z.string().trim().min(1).max(40).optional().describe("One of that theme's presets."),
});
export type DraftStoreArgs = z.output<typeof draftStoreInput>;

/** A theme a draft may take: free or already the store's, by id, with its presets' keys. */
export type DraftThemeOption = { id: string; title: string; summary: string | null; presets: { key: string; name: string }[] };

/**
 * The model's choice of theme for a drafted store, read defensively: the first JSON object's `theme` must be one of the options' ids and its
 * `preset`, when given, one of that theme's; anything else is no choice (the draft goes on without a theme).
 */
export function readThemeChoice(text: string, options: readonly DraftThemeOption[]): { theme: string; preset: string | null } | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { theme, preset } = parsed as { theme?: unknown; preset?: unknown };
  const chosen = options.find((option) => option.id === theme);
  if (!chosen) return null;
  const key = typeof preset === "string" && chosen.presets.some((p) => p.key === preset) ? preset : null;
  return { theme: chosen.id, preset: key };
}
