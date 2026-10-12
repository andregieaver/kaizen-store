import { z } from "zod";

import { AUTOPLAY_SECONDS, CAROUSEL_SNAPS, type CarouselSnap } from "./carousel-settings";

/**
 * The schemas of `carousel-settings.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

/** The settings in the page's JSON, for `pageInput`: a part of the content grid's and testimonials' schemas. */
export const carouselSettingsSchema = z.object({
  arrows: z.boolean().optional(),
  dots: z.boolean().optional(),
  snap: z.enum(Object.keys(CAROUSEL_SNAPS) as [CarouselSnap, ...CarouselSnap[]], "A carousel rests on an unknown part of its tiles.").optional(),
  rewind: z.boolean().optional(),
  autoplay: z
    .object({
      seconds: z
        .number("Give the seconds a carousel stays on a page as a number.")
        .int(`A carousel stays on a page a whole number of seconds, from ${AUTOPLAY_SECONDS.min} to ${AUTOPLAY_SECONDS.max}.`)
        .min(AUTOPLAY_SECONDS.min, `A carousel stays on a page at least ${AUTOPLAY_SECONDS.min} seconds.`)
        .max(AUTOPLAY_SECONDS.max, `A carousel stays on a page at most ${AUTOPLAY_SECONDS.max} seconds.`),
    })
    .optional(),
});
