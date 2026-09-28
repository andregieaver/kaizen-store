import { z } from "zod";

import { findClaims, type ClaimKind } from "./claims";

/**
 * Alt texts written by the site's AI (D89): the model looks at a picture in
 * the media library and says what it shows, in each of the site's
 * languages, for people who cannot see it and for search engines and AI
 * assistants reading the page. Pure: the prompt, and reading and cleaning
 * the answer; the server sends the picture.
 *
 * Grounded as the site's other AI texts: the model says only what it sees.
 * It is told where the picture is used (product and page names), to name
 * a thing it clearly shows, and never gets prices or stock; what it writes
 * passes the claims filter (`findClaims()`, colour words allowed), and a
 * language whose text carries a claim is left out.
 */

/** The longest alt text kept; the model is asked for well under it. */
export const ALT_TEXT_MAX = 250;
/** What the model is asked to stay under: what screen readers and search engines read in full. */
export const ALT_TEXT_AIM = 125;

/** A language alt texts are written in; `extra` when the site does not sell in it (English, for search and AI assistants). */
export type AltLanguage = { locale: string; name: string; extra?: true };

export type AltTextContext = {
  /** The store's name, or Kaizen's. */
  siteName: string;
  /** The site's languages, its main one first. */
  languages: AltLanguage[];
  fileName: string;
  /** Where the picture is used, for people: "Product: Demo: Keramikkopp". */
  uses: string[];
};

/** The instructions and the words sent with the picture. */
export function altTextPrompt(context: AltTextContext): { system: string; user: string } {
  const codes = context.languages.map((language) => language.locale);
  const example = Object.fromEntries(codes.map((code) => [code, "…"]));
  const system = [
    `You write alt texts for the pictures on ${context.siteName}'s website.`,
    "An alt text tells someone who cannot see a picture what it shows, in one short sentence, and helps search engines and AI assistants understand the page it is on.",
    "Rules:",
    "- Describe only what you can see in the picture: the thing, its colour, material, shape and setting, and any people or text that matter.",
    "- You are told where the picture is used. Name a product or subject from there only when the picture clearly shows it; never guess a brand.",
    "- Never state prices, discounts, stock, availability, delivery, or claims about quality, the environment or health, and never urge anyone to act.",
    '- Do not begin with "Image of", "Picture of", "Photo of" or the like in any language.',
    `- Stay under ${ALT_TEXT_AIM} characters in each language. No quotation marks, emoji or hashtags.`,
    "- Write each language as a native speaker would, not word for word from another.",
    `Answer with JSON only, one key per language code: ${JSON.stringify(example)}`,
  ].join("\n");
  const user = [
    `Languages: ${context.languages.map((language) => `${language.locale} (${language.name})`).join(", ")}`,
    `File name: ${context.fileName}`,
    context.uses.length > 0 ? `Used in: ${context.uses.slice(0, 12).join("; ")}` : "Not used on the site yet.",
    "Write the alt text for this picture.",
  ].join("\n");
  return { system, user };
}

/** Phrases a picture's alt text should not begin with, in the stores' languages. */
const OPENERS =
  /^(?:an?\s+|the\s+)?(?:image|picture|photo(?:graph)?|illustration|bilde|bild|foto|fotografi|billede|abbildung)\s+(?:of|av|på|af|von|med|showing|som viser|som visar|der viser|zeigt)\s+/iu;

/**
 * An alt text as it can be kept: plain words on one line, without quotes,
 * a leading "Image of", or links; at most `ALT_TEXT_MAX` characters, cut
 * at a word. Empty when nothing is left.
 */
export function cleanAltText(value: string): string {
  let text = value
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/https?:\/\/\S+/giu, "")
    .replace(/[*_`#<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "")
    .trim();
  text = text.replace(OPENERS, "");
  if (text.length > ALT_TEXT_MAX) {
    const cut = text.slice(0, ALT_TEXT_MAX);
    text = cut.slice(0, Math.max(cut.lastIndexOf(" "), ALT_TEXT_MAX - 40)).replace(/[\s,;:–-]+$/u, "");
  }
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : "";
}

export type AltTexts = {
  /** The texts that can be kept, by locale. */
  texts: Record<string, string>;
  /** Languages left out, and why. */
  dropped: { locale: string; reason: "missing" | ClaimKind }[];
};

/**
 * The model's answer read as alt texts for the languages asked for: the
 * JSON object in it, each text cleaned and checked by the claims filter.
 * Anything not asked for is ignored.
 */
export function parseAltTexts(reply: string, locales: string[]): AltTexts {
  let parsed: unknown = null;
  const object = reply.match(/\{[\s\S]*\}/);
  if (object) {
    try {
      parsed = JSON.parse(object[0]);
    } catch {
      parsed = null;
    }
  }
  const values = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  // One language asked for and plain words back: the words are its text.
  if (!object && locales.length === 1) values[locales[0]] = reply;
  const texts: Record<string, string> = {};
  const dropped: AltTexts["dropped"] = [];
  for (const locale of locales) {
    const value = values[locale] ?? values[locale.split("-")[0]];
    const text = typeof value === "string" ? cleanAltText(value) : "";
    if (!text) {
      dropped.push({ locale, reason: "missing" });
      continue;
    }
    // Colours are what a picture looks like, not claims.
    const claim = findClaims(text, { colours: false })[0];
    if (claim) {
      dropped.push({ locale, reason: claim.kind });
      continue;
    }
    texts[locale] = text;
  }
  return { texts, dropped };
}

/** A picture's alt text as the owner keeps it: the main language's, and the others' by locale. */
export function splitAltTexts(texts: Record<string, string>, mainLocale: string): { alt: string; translations: Record<string, string> } {
  const { [mainLocale]: alt = "", ...translations } = texts;
  return { alt, translations };
}

/** Staff's alt texts as the library sends them: the main language's, and the others' by locale. */
export const altTextsInput = z.object({
  alt: z.string().max(1000),
  translations: z.record(z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/), z.string().max(1000)),
});

/** An alt-text run from the library: when it started (within the last day), and whether to write the AI's earlier texts again. */
export const altRunInput = z.object({
  since: z.iso.datetime().refine((value) => {
    const age = Date.now() - Date.parse(value);
    return age >= -60_000 && age < 24 * 60 * 60 * 1000;
  }),
  rewrite: z.boolean(),
});
