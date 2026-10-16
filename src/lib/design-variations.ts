import { slugify } from "./slug";
import {
  VARIATIONS_MAX,
  VARIATION_KEY,
  VARIATION_NAME_MAX,
  designVariationSchema,
  type DesignSnapshot,
  type DesignVariation,
} from "./design-presets";

/**
 * A theme's presets (`docs/theme-showcase-phase-1.md` step 1; *Presets* in the interface, variations in code, because `design_presets` are
 * themes): named looks over a theme, kept in its versions (`DesignSnapshot.variations`). A preset is the theme with its own settings in place
 * of the theme's (`variationSnapshot()`), so applying, installing, checking, updating and previewing one is doing that to a theme. Pure.
 */

/** Addresses under a theme's page that are not presets (`/themes/{slug}/try`, `og.png`), so no preset takes them. */
const RESERVED_KEYS = new Set(["try", "og", "preview", "presets"]);

/** A new preset's key from its name: its words in the address shape, made unique among the theme's (`coast`, `coast-2`). */
export function variationKey(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = (slugify(name).slice(0, 32).replace(/-+$/, "") || "preset").replace(/^-+/, "");
  const start = VARIATION_KEY.test(base) ? base : "preset";
  for (let n = 1; ; n++) {
    const key = n === 1 ? start : `${start}-${n}`;
    if (!used.has(key) && !RESERVED_KEYS.has(key)) return key;
  }
}

/** A preset's name as typed: trimmed, within its length; null when empty. */
export function variationName(value: unknown): string | null {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  return name ? name.slice(0, VARIATION_NAME_MAX) : null;
}

/** The theme's presets as a version keeps them (none for a version without). */
export const variationsOf = (snapshot: DesignSnapshot): DesignVariation[] => snapshot.variations ?? [];

/**
 * The look a store gets from a theme and one of its presets: the theme with the preset's settings in place of its own (null: the theme's own
 * look). The presets themselves are left out, as a placed look carries none. Null when the theme has no such preset.
 */
export function variationSnapshot(snapshot: DesignSnapshot, key: string | null): DesignSnapshot | null {
  const { variations, ...look } = snapshot;
  if (!key) return { ...look, v: 1 };
  const variation = (variations ?? []).find((v) => v.key === key);
  return variation ? { ...look, v: 1, theme: variation.theme } : null;
}

/** A preset to choose: the theme's own look first (no key, the theme's name), then its presets in order. */
export type VariationChoice = { key: string | null; name: string };

export const variationChoices = (snapshot: DesignSnapshot, themeTitle: string): VariationChoice[] => [
  { key: null, name: themeTitle },
  ...variationsOf(snapshot).map((v) => ({ key: v.key, name: v.name })),
];

/** A preset's key from a form or an address: one of the theme's, else null (the theme's own look). */
export function chosenVariation(snapshot: DesignSnapshot, value: unknown): string | null {
  const key = typeof value === "string" ? value.trim() : "";
  return key && variationsOf(snapshot).some((v) => v.key === key) ? key : null;
}

/** A drafted preset as the platform's editor keeps it (`commerce.design_variations`), and its place in the version Publish writes. */
export type DraftVariation = DesignVariation & { id: string; position: number };

/** The presets Publish writes into the version: the drafted ones in order, each read through the schema (an unreadable one is left out). */
export function publishedVariations(drafts: DraftVariation[]): DesignVariation[] {
  return [...drafts]
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
    .slice(0, VARIATIONS_MAX)
    .flatMap((draft) => {
      const parsed = designVariationSchema.safeParse({ key: draft.key, name: draft.name, theme: draft.theme });
      return parsed.success ? [parsed.data as DesignVariation] : [];
    });
}

/** Whether the drafted presets differ from a version's (names, order, looks), for *Unpublished changes*. */
export function variationsChanged(drafts: DraftVariation[], published: DesignSnapshot | null): boolean {
  return JSON.stringify(publishedVariations(drafts)) !== JSON.stringify(published ? variationsOf(published) : []);
}

/**
 * The look an install made from a preset gets from a version: the preset laid over the theme, or the theme's own look when this version has
 * no such preset (`missing`, said in *What's new*; the install keeps the preset's key, so a version that brings it back brings it back).
 */
export function installedLook(snapshot: DesignSnapshot, key: string | null): { snapshot: DesignSnapshot; missing: boolean } {
  const own = variationSnapshot(snapshot, null) as DesignSnapshot;
  if (!key) return { snapshot: own, missing: false };
  const laid = variationSnapshot(snapshot, key);
  return laid ? { snapshot: laid, missing: false } : { snapshot: own, missing: true };
}

/** The line *What's new* says when a version no longer has the install's preset, or brings it back. */
export function presetLine(before: DesignSnapshot | null, after: DesignSnapshot, key: string | null): string | null {
  if (!key) return null;
  const had = before ? variationsOf(before).find((v) => v.key === key) : undefined;
  const has = variationsOf(after).find((v) => v.key === key);
  if (had && !has) return `This version no longer has the ${had.name} preset, so the theme's own look is used.`;
  if (!had && has && before) return `The ${has.name} preset is back in this version.`;
  return null;
}

/** A preset's key as a form or address sends it, in its shape (the server checks the theme has it); null: the theme's own look. */
export function presetChoice(value: unknown): string | null {
  const key = typeof value === "string" ? value.trim() : "";
  return VARIATION_KEY.test(key) ? key : null;
}
