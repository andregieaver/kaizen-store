import "server-only";

import type { BrandInput } from "@/lib/brand";
import { designedStoreTheme, designedTheme, type DesignLookInput } from "@/lib/brand-design";
import { parseStoreTheme, templateSettings, themeWarnings, type StoreTheme } from "@/lib/theme";

import { getBrand, setBrand, type BrandScope } from "./brand";
import { designTags } from "./design-presets";
import { findFont, installFonts } from "./fonts";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";
import { addOwnLook, liveLook } from "./theme-installs";

/**
 * The AI manager's brand tools (D330, `docs/ai-autopilot.md` 14): the brand profile for a store or Kaizena Flow's own site, and a store's
 * own look designed from a few brand colours, fonts and named choices, added to its theme library to try and make live.
 */

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

export async function getBrandTool(scope: BrandScope) {
  const brand = await getBrand(scope);
  const empty = !brand.tagline && !brand.voice && !brand.audience && brand.values.length === 0 && brand.avoid.length === 0;
  return {
    brand: { tagline: brand.tagline, voice: brand.voice, audience: brand.audience, values: brand.values, avoid: brand.avoid },
    note: empty ? "No brand is set down yet: agree it with the owner, or research it, and keep it with set_brand." : "Write in this voice, for this audience, and never use the words to avoid.",
  };
}

export async function setBrandTool(scope: BrandScope, input: BrandInput) {
  await setBrand(scope, input);
  return { done: "The brand is kept.", next: "Read it with get_brand before writing pages, products or emails." };
}

type DesignContext = { account: { id: string }; store: Store; invalidate: (tag: string) => void };

/** `design_look`: the designed theme added to the store's library, not live; the owner (or the autopilot at Design) makes it live. */
export async function designLookTool(ctx: DesignContext, input: DesignLookInput) {
  const families = [input.heading_font, input.body_font].filter((f): f is string => Boolean(f));
  const unknown = families.find((f) => !findFont(f));
  if (unknown) return fail(`"${unknown}" is not in the font catalogue (Google Fonts): choose a family by its exact name, such as Inter, Fraunces or DM Sans.`);
  let base: StoreTheme;
  if (input.start === "current") {
    const live = await liveLook(ctx.store.id);
    base = parseStoreTheme(live?.theme ?? {});
  } else {
    base = { base: input.start, savedId: null, settings: templateSettings(input.start) };
  }
  const settings = designedTheme(base.settings, input);
  const warnings = themeWarnings({ ...settings, visitorSwitch: true });
  if (warnings.length) return fail(`The look could not be made readable: ${warnings.join(" ")}`);
  const installed = await installFonts(families);
  if (!installed.ok) return fail(`The fonts could not be installed: ${installed.problem}`);
  const result = await addOwnLook(ctx.store.id, ctx.account.id, input.title, designedStoreTheme(base, settings));
  if (!result.ok) return fail(result.problems.join(" "));
  for (const tag of designTags(ctx.store)) ctx.invalidate(tag);
  return {
    done: `"${result.title}" is in the store's theme library. Visitors see nothing of it yet.`,
    install: result.id,
    colours: { light: settings.light, dark: settings.dark, mode: settings.mode },
    fonts: settings.fonts,
    note: "The colours are worked out from the ones you gave so every text reads; repeat them as they are.",
    next: "Show it with try_theme, make it live with make_theme_live (install), then look at the store with look_at_store.",
  };
}
