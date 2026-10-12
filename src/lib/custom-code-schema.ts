import { z } from "zod";

import { CONSENT_CATEGORIES } from "./cookie-consent";
import { CODE_MAX_LENGTH, CODE_PLACES, type CustomCode } from "./custom-code";

/**
 * The schemas of `custom-code.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

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
