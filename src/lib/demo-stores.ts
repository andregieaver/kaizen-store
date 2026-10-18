/**
 * Demo stores (D277, `docs/themes-content-and-demo-stores.md` section 4): live stores a platform admin dresses in a theme, each a store
 * template of kind `demo` (`store_starters.kind`). Published as they stand (no frozen copy), never a new store's content, shown under *See it
 * live* on the theme they wear, and their look can go into the theme store by a copy made once (*Publish this look…*). Pure: shared by the
 * platform's pages, the theme store and the tests.
 */

import type { DesignLayoutKind } from "./design-presets";
import { storeBase, storeSiteUrl } from "./paths";
import { STARTER_LIMITS, isStarterPicture } from "./store-starters";

/** The parts of a look a preset cannot hold: it shares them with its theme (`docs/theme-showcase-phase-1.md` step 1). */
export type LookPart = DesignLayoutKind | "css";

export const LOOK_PART_WORDS: Record<LookPart, string> = {
  header: "the header",
  footer: "the footer",
  productLayout: "the product page",
  css: "the CSS",
};

/** "the header and the CSS": the parts named in a sentence. */
export function partsWords(parts: readonly LookPart[]): string {
  const words = parts.map((part) => LOOK_PART_WORDS[part]);
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * Why a demo store's look cannot become a preset of the theme it wears, or null when it can: a preset holds the theme settings only, so the
 * header, footer, product page and CSS must be as the theme placed them.
 */
export function presetRefusal(changed: readonly LookPart[]): string | null {
  if (changed.length === 0) return null;
  return `A preset holds colours, fonts, buttons and the other theme settings only, and this demo store changed ${partsWords(changed)}. Publish it as a new theme instead, or put those back as the theme placed them.`;
}

/** What a published demo store wearing one of a theme's looks shows under *See it live* on the theme's page. */
export type LiveDemo = {
  id: string;
  name: string;
  /** Its trade, as the admin wrote it ("Linen and home goods"); empty when none. */
  trade: string;
  pictureUrl: string | null;
  /** The look it wears: the theme's own (null) or one of its presets, by key. */
  variation: string | null;
  /** Where it lives: its storefront's full address. */
  href: string;
};

/**
 * A demo store's address: its storefront, in full. Until the demo domain (step 4, `NEXT_PUBLIC_DEMO_DOMAIN`), demo stores stay on the store
 * domain as every store does (`/s/{slug}` without one).
 */
export function demoStoreAddress(slug: string): string {
  return `${storeSiteUrl(slug)}${storeBase(slug)}`;
}

/** A demo store's details as the platform admin edits them: its trade (one line) and a picture for *See it live*. */
export type DemoDetails = { trade: string; pictureUrl: string | null };

export function parseDemoDetails(form: { trade?: unknown; pictureUrl?: unknown }): { ok: true; details: DemoDetails } | { ok: false; problems: string[] } {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const trade = text(form.trade).replace(/\s+/g, " ");
  const picture = text(form.pictureUrl);
  const problems: string[] = [];
  if (trade.length > STARTER_LIMITS.summary) problems.push(`Keep its trade under ${STARTER_LIMITS.summary + 1} characters.`);
  if (picture && !isStarterPicture(picture)) problems.push("The picture's address must start with https:// or be a path on this site.");
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, details: { trade, pictureUrl: picture || null } };
}
