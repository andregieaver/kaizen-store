import { z } from "zod";

import { type TrackingSettings } from "./cookie-consent";

/**
 * The schemas of `cookie-consent.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

const optionalId = (pattern: RegExp, message: string) =>
  z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => value === "" || pattern.test(value), message)
    .optional();

export const trackingSchema = z
  .object({
    ga4: optionalId(/^G-[A-Z0-9]{4,15}$/, "A Google Analytics 4 id looks like G-XXXXXXXXXX."),
    gtm: optionalId(/^GTM-[A-Z0-9]{4,12}$/, "A Google Tag Manager id looks like GTM-XXXXXXX."),
    metaPixel: optionalId(/^\d{6,20}$/, "A Meta Pixel id is a number of 6 to 20 digits."),
    googleAds: optionalId(/^AW-\d{6,12}$/, "A Google Ads tag id looks like AW-123456789."),
    tiktokPixel: optionalId(/^[A-Z0-9]{15,25}$/, "A TikTok pixel code is 15 to 25 letters and digits."),
    pinterestTag: optionalId(/^\d{10,16}$/, "A Pinterest tag id is a number of 10 to 16 digits."),
  })
  // Empty fields are tools switched off.
  .transform((value) =>
    Object.fromEntries(Object.entries(value).filter(([, id]) => id)) as TrackingSettings,
  );

/** The stored value, or no tools if it is missing or damaged. */
export function parseTracking(value: unknown): TrackingSettings {
  const parsed = trackingSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}
