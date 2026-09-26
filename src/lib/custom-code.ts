import { z } from "zod";

import { CONSENT_CATEGORIES, OPTIONAL_CATEGORIES, type ConsentCategory, type ConsentChoices, type OptionalCategory } from "./cookie-consent";
import { storeDomain } from "./paths";

/**
 * A store's own code (D61): what its owner pastes for the page's `<head>`
 * and the start and end of its `<body>`, each with the cookie category it
 * falls under (D58). Code marked necessary is added as the page starts;
 * the rest only once the shopper allows its category. Stored in
 * `stores.custom_code`; only added on the store's own host (P7), a
 * different site from the admin, so nothing in it can reach Kaizen's.
 */

export const CODE_PLACES = ["head", "bodyStart", "bodyEnd"] as const;
export type CodePlace = (typeof CODE_PLACES)[number];
export type CodeSnippet = { code: string; category: ConsentCategory };
export type CustomCode = Partial<Record<CodePlace, CodeSnippet>>;

export const CODE_PLACE_LABELS: Record<CodePlace, { title: string; hint: string }> = {
  head: { title: "In <head>", hint: "Added to the page's head: tags for tools, meta and link tags, scripts." },
  bodyStart: { title: "At the start of <body>", hint: "Added first in the body, such as a tag manager's <noscript> part." },
  bodyEnd: { title: "At the end of <body>", hint: "Added last in the body, such as a chat widget." },
};

/** Room for a tag manager's or a widget's snippet, not for a whole program. */
export const CODE_MAX_LENGTH = 20_000;

const snippet = z.object({
  code: z
    .string()
    .max(CODE_MAX_LENGTH, `Each piece of code takes at most ${CODE_MAX_LENGTH.toLocaleString("en")} characters.`)
    .transform((code) => code.trim()),
  category: z.enum(CONSENT_CATEGORIES, "Choose a cookie category for the code."),
});

/** What the owner saves; places left empty are dropped. */
export const customCodeInput = z
  .object({ head: snippet.optional(), bodyStart: snippet.optional(), bodyEnd: snippet.optional() })
  .transform((value) =>
    Object.fromEntries(CODE_PLACES.flatMap((place) => (value[place]?.code ? [[place, value[place]]] : []))) as CustomCode,
  );

/** The stored value, or none if it is missing or damaged. */
export function parseCustomCode(value: unknown): CustomCode {
  const parsed = customCodeInput.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

/** The code a storefront adds: none until stores have their own hosts (P7). */
export function liveCustomCode(code: CustomCode): CustomCode {
  return storeDomain() ? code : {};
}

/** The optional categories the code needs consent for. */
export function codeCategories(code: CustomCode): OptionalCategory[] {
  const used = new Set(CODE_PLACES.map((place) => code[place]?.category));
  return OPTIONAL_CATEGORIES.filter((category) => used.has(category));
}

/** The code shoppers' choices allow: necessary code always. */
export function allowedCode(code: CustomCode, choices: ConsentChoices | null): CodePlace[] {
  return CODE_PLACES.filter((place) => {
    const category = code[place]?.category;
    return category === "necessary" || (category !== undefined && choices !== null && choices[category]);
  });
}

// ---------------------------------------------------------------------------
// In the browser
// ---------------------------------------------------------------------------

const added = new Set<CodePlace>();

/**
 * Adds the allowed code to the page, each place once per page load. Parsed
 * as a fragment of the document, so its scripts run as if they had been in
 * the page, in the order written.
 */
export function addCustomCode(code: CustomCode, choices: ConsentChoices | null) {
  for (const place of allowedCode(code, choices)) {
    if (added.has(place)) continue;
    added.add(place);
    const fragment = document.createRange().createContextualFragment(code[place]!.code);
    // Added scripts run as soon as they arrive; these keep their order unless marked async.
    fragment.querySelectorAll("script[src]:not([async])").forEach((script) => {
      (script as HTMLScriptElement).async = false;
    });
    if (place === "head") document.head.append(fragment);
    else if (place === "bodyStart") document.body.prepend(fragment);
    else document.body.append(fragment);
  }
}
