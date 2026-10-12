import { z } from "zod";

import { MESSAGE_MAX } from "./forms";

/**
 * The schemas of `forms.ts`, apart from it so the browser's parts that use its plain helpers do not load zod (D211,
 * `storefront-bundle.scan.test.ts`). The server and the admin import what checks input from here.
 */

const key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** What the browser sends (`/api/forms`). */
export const formRequest = z.object({
  /** The site's owner: a store's id, or null for Kaizen's own pages. */
  store: z.uuid().nullable(),
  block: key,
  values: z
    .record(key, z.union([z.string().max(MESSAGE_MAX * 2), z.boolean()]))
    .refine((values) => Object.keys(values).length <= 30, "Too many answers."),
  consent: z.boolean().default(false),
  /** A field people never see: only robots fill it in. */
  website: z.string().max(1000).default(""),
  lang: z.string().regex(/^[a-z]{2,3}$/).default("en"),
  /** The page it is sent from, a path on the site. */
  path: z
    .string()
    .max(500)
    .refine((path) => path.startsWith("/") && !path.startsWith("//") && !/[\\\s]/.test(path), "The page's address could not be read."),
  /** Milliseconds from showing the form to sending it: people take a few seconds. */
  elapsed: z.number().int().min(0).max(1e10).default(0),
});

export type FormRequest = z.infer<typeof formRequest>;
