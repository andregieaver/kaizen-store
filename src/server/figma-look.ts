import "server-only";

import { randomUUID } from "node:crypto";

import { designedStoreTheme } from "@/lib/brand-design";
import { figmaFamilies, figmaLook, lookFromFigma } from "@/lib/figma-look";
import { fontRelation } from "@/lib/replicate-fonts";
import { themeWarnings } from "@/lib/theme";
import { THEME_ELEMENT_KEYS, THEME_ELEMENT_LABELS } from "@/lib/theme-elements";
import { parseStoreTheme } from "@/lib/theme-schema";

import type { Account } from "./auth";
import { installFamily } from "./replicate-assets";
import { addOwnLook, installLook, liveLook, saveInstallLook } from "./theme-installs";

/**
 * A look from a Figma file (D898 F3, `docs/design-tools.md`): the colours and text styles the Kaizena Flow plugin read become a look in the
 * store's theme library (`lookFromFigma()`, every colour pair readable, `themeWarnings()` held to none), its typefaces installed from Google
 * Fonts or the nearest one standing in, as a frame's are (F2). It is never live: the owner tries it and makes it live in Design settings.
 * Brought again from the same file, the look the plugin made before is brought up to date while it is not live; a live one is left alone and
 * a new look is made beside it.
 */

/** The most typefaces one look installs: a heading's, a body's and a few more for the elements. */
const FAMILIES_MAX = 6;

export type FigmaLookImport = { ok: true; id: string; title: string; created: boolean; summary: string; notes: string[] } | { ok: false; problem: string };

export async function importFigmaLook(
  owner: { account: Account; storeId: string },
  input: { file?: string; title?: string; install?: string | null; colours: unknown; text: unknown },
  deps: { install?: typeof installFamily } = {},
): Promise<FigmaLookImport> {
  const parsed = figmaLook.safeParse({ colours: input.colours, text: input.text });
  if (!parsed.success) return { ok: false, problem: "The file's colours and text styles could not be read. Update the Kaizena Flow plugin in Figma and send them again." };
  const look = parsed.data;
  if (look.colours.length === 0 && look.text.length === 0) {
    return { ok: false, problem: "The file has no colour styles, colour variables or text styles to bring. Make some in Figma, or select a frame and send it as a page." };
  }
  const notes: string[] = [];

  // The look made from this file before, while it is not live; the live look changes only in Design settings.
  let earlier = input.install ? await installLook(owner.storeId, input.install) : null;
  if (earlier?.live) {
    notes.push(`"${earlier.title}" is live, so this is a new look beside it: the live look changes only in Design settings.`);
    earlier = null;
  }
  const from = earlier?.look ?? (await liveLook(owner.storeId));
  if (!from) return { ok: false, problem: "The store could not be found." };
  const base = parseStoreTheme(from.theme);

  // Its typefaces, the heading's and the body's first: installed from Google Fonts, or the nearest one stands in.
  const install = deps.install ?? installFamily;
  const fonts = new Map<string, string | null>();
  for (const family of figmaFamilies(look).slice(0, FAMILIES_MAX)) {
    const installed = await install(family);
    fonts.set(family, installed.ok ? installed.family : null);
    if (!installed.ok) notes.push(`The typeface ${family} is not in Google Fonts; the look keeps its own instead.`);
    else if (fontRelation(family, installed.family) === "lookalike") notes.push(`The typeface ${family} is not in Google Fonts; ${installed.family}, the nearest, stands in.`);
  }

  const { settings, found } = lookFromFigma(look, base.settings, fonts, randomUUID);
  const warnings = themeWarnings({ ...settings, visitorSwitch: true });
  if (warnings.length) return { ok: false, problem: `The look could not be made readable: ${warnings.join(" ")}` };
  const theme = designedStoreTheme(base, settings);

  let saved: { id: string; title: string; created: boolean };
  if (earlier) {
    const result = await saveInstallLook(owner.storeId, earlier.id, owner.account.id, { theme });
    if (!result.ok) return { ok: false, problem: result.problems.join(" ") };
    saved = { id: earlier.id, title: earlier.title, created: false };
  } else {
    const file = (input.file ?? "").trim().slice(0, 60);
    const title = (input.title ?? "").trim() || (file ? `${file} (Figma)` : "From Figma");
    const result = await addOwnLook(owner.storeId, owner.account.id, title, theme);
    if (!result.ok) return { ok: false, problem: result.problems.join(" ") };
    saved = { id: result.id, title: result.title, created: true };
  }

  // What was made readable, guessed or left out: the colours themselves stay as the file has them in its saved colours.
  const palette = settings.mode === "dark" ? settings.dark : settings.light;
  if (!found.accent) notes.push("No colour is named for the brand (primary, brand or accent), so the look keeps its own accent.");
  else if (found.accent.guessed) notes.push(`No colour is named for the brand; ${found.accent.name}, the most colourful, is the accent.`);
  if (found.accent && palette.accent !== found.accent.color) notes.push(`${found.accent.name} is a little ${shade(found.accent.color, palette.accent)} on buttons, so their words read.`);
  if (found.text && palette.text !== found.text.color) notes.push(`${found.text.name} is ${shade(found.text.color, palette.text)} in the look, so it reads on the page.`);
  if (!found.background && !found.text && found.accent) notes.push("No colour is named for the page or its text, so the look keeps its own.");
  if (found.left > 0) notes.push(`${found.left} colour${found.left === 1 ? " was" : "s were"} not saved: a look keeps at most 40.`);

  const parts = [
    found.accent || found.background || found.text ? `the file's colours${found.dark ? " for light and dark" : ""}` : null,
    typefaces(found.heading, found.body),
    found.elements.length ? `${elementWords(found.elements)} as its text styles say` : null,
  ].filter(Boolean);
  const done = saved.created ? `"${saved.title}" is in the theme library` : `"${saved.title}" is brought up to date`;
  const summary = `${done}${parts.length ? ` with ${parts.join(", ")}` : ""}${found.saved > 0 ? `; ${found.saved} colour${found.saved === 1 ? " is" : "s are"} saved` : ""}. Visitors see nothing of it until you make it live.`;
  return { ok: true, ...saved, summary, notes };
}

/** Whether the colour the look uses is darker or lighter than the file's. */
function shade(given: string, used: string): "darker" | "lighter" {
  const light = (c: string) => parseInt(c.slice(1, 3), 16) * 0.299 + parseInt(c.slice(3, 5), 16) * 0.587 + parseInt(c.slice(5, 7), 16) * 0.114;
  return light(used) < light(given) ? "darker" : "lighter";
}

/** `Fraunces for headings and Inter for text`, or `Inter throughout`. */
function typefaces(heading: string | undefined, body: string | undefined): string | null {
  if (heading && heading === body) return `${heading} throughout`;
  const parts = [heading ? `${heading} for headings` : null, body ? `${body} for text` : null].filter(Boolean);
  return parts.length ? parts.join(" and ") : null;
}

/** `H1, H2, paragraphs and buttons`, in the Theme tab's order. */
function elementWords(keys: readonly string[]): string {
  const words = THEME_ELEMENT_KEYS.filter((k) => keys.includes(k) && k !== "list" && k !== "row")
    .map((k) => (k === "p" ? "paragraphs" : k === "button" ? "buttons" : THEME_ELEMENT_LABELS[k as keyof typeof THEME_ELEMENT_LABELS].name));
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : (words[0] ?? "");
}
