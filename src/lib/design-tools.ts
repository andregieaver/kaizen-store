import { z } from "zod";

import { chargeLine, chargeToken, type ThemeCharge } from "./theme-prices";

/**
 * The AI manager's design tools (D308, `docs/ai-autopilot.md` 6), pure: their arguments, the charge an approval keeps and the words it shows.
 * The server (`src/server/design-tools.ts`) adds and switches themes only through Design settings' own functions (`installDesignPreset()`,
 * `applyDesignPreset()`, `switchToInstall()`), so a theme made live by a tool is the one Design settings would make live.
 *
 * Adding a theme to the store's library changes nothing visitors see, so it runs at once. Making one live always waits for the owner's yes:
 * a `public` change, and a `spend` when the theme costs money and the store does not have it (`chargeCosts()`). The charge the owner was shown
 * is kept with the approval (`approved_charge`, written by the store, never the model) and the switch is refused when it is no longer the same.
 */

const id = z.string().trim().uuid("An id from list_themes.");

export const listThemesInput = z.object({});

export const addThemeInput = z.object({
  theme: id.describe("The theme's id, from list_themes."),
  preset: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .nullable()
    .optional()
    .describe("One of the theme's presets by its key, from list_themes; left out, the theme's own look."),
});

export const tryThemeInput = z.object({
  install: id.describe("An installed theme's id, from list_themes' `installed` (or add_theme's answer)."),
});

export const makeThemeLiveInput = z
  .object({
    install: id
      .optional()
      .describe("An installed theme's id, from list_themes' `installed`: switches the store to it, with every change made to it."),
    theme: id.optional().describe("A theme's id, from list_themes, to install and make live at once (without trying it first)."),
    preset: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .nullable()
      .optional()
      .describe("With `theme`: one of its presets by its key; left out, the theme's own look."),
    approved_charge: z
      .string()
      .max(80)
      .optional()
      .describe("Never set this: the store writes it when the owner is asked, so the theme goes live at the price they were shown."),
  })
  .refine((args) => Boolean(args.install) !== Boolean(args.theme), "Give either an installed theme (`install`) or a theme (`theme`), not both.");

export type AddThemeInput = z.output<typeof addThemeInput>;
export type MakeThemeLiveInput = z.output<typeof makeThemeLiveInput>;

/** Whether making the theme live costs the store money, now or when it opens: then the yes is a `spend`. */
export const chargeCosts = (charge: ThemeCharge): boolean => charge.kind === "now" || charge.kind === "at_opening";

/** The charge as one string, kept with the approval and compared when the yes runs: any change in kind or price refuses the switch. */
export function chargeKey(charge: ThemeCharge): string {
  switch (charge.kind) {
    case "free":
      return "free";
    case "owned":
      return "owned";
    case "at_opening":
    case "now":
      return `${charge.kind}:${chargeToken(charge.price)}`;
  }
}

/** The price token the database is told when the theme goes live (`setThemeCharge()`): only for a theme charged at once. */
export const chargeTokenFor = (charge: ThemeCharge): string | null => (charge.kind === "now" ? chargeToken(charge.price) : null);

/** What the owner is asked before a theme goes live: the theme by name, what changes and what stays, and what it costs. */
export function liveSummary(title: string, charge: ThemeCharge, current: string | null): string {
  const cost = chargeLine(charge);
  const before = current ? ` "${current}" stays in the theme library and can be put back.` : "";
  return `Make the theme "${title}" live: visitors see its colours, fonts, header, footer and product page at once; the store's words, pages and products stay.${before}${cost ? ` ${cost}` : ""}`;
}
