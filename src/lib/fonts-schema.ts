import { z } from "zod";

import { FONT_FAMILY } from "./fonts";

/**
 * The schemas of `fonts.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

export const fontFamily = z.string().trim().regex(FONT_FAMILY, "Choose a font from the list.");

/** A site's own fonts (D59): headings and the rest; unset keeps the system's. */
export const siteFontsSchema = z.object({
  heading: fontFamily.optional(),
  body: fontFamily.optional(),
});

export type SiteFonts = z.infer<typeof siteFontsSchema>;

/** The stored value, or no fonts if it is missing or damaged. */
export function parseSiteFonts(value: unknown): SiteFonts {
  const parsed = siteFontsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}
