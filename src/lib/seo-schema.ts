import { z } from "zod";

import { DESCRIPTION_MAX, LLMS_MAX, RULES_MAX, type StoreSeo, TITLE_MAX } from "./seo";

/**
 * A store's search settings as they are checked and read (bloat review step 2.46): parseStoreSeo() and the settings form's schema,
 * apart from the limits and the robots, llms and JSON-LD helpers in seo.ts, so a screen that only reads a limit loads no zod. Import
 * this file only where a schema runs.
 */

const localized = z.record(z.string(), z.string()).catch({});

const storedSeo = z.object({
  title: localized.default({}),
  description: localized.default({}),
  image: z
    .object({ url: z.string(), alt: localized.default({}) })
    .nullable()
    .catch(null)
    .default(null),
  sameAs: z.array(z.string()).catch([]).default([]),
  hidden: z.boolean().catch(false).default(false),
  aiAssistants: z.boolean().catch(true).default(true),
  aiTraining: z.boolean().catch(true).default(true),
  robots: z.string().catch("").default(""),
  llms: z.string().catch("").default(""),
  verification: z
    .object({ google: z.string().catch("").default(""), bing: z.string().catch("").default("") })
    .catch({ google: "", bing: "" })
    .default({ google: "", bing: "" }),
});

/** Reads saved settings; anything missing or malformed gets its default. */
export function parseStoreSeo(value: unknown): StoreSeo {
  const parsed = storedSeo.safeParse(value ?? {});
  return parsed.success ? parsed.data : storedSeo.parse({});
}

/** A verification code as Google and Bing give it: letters, digits, `-` and `_`. */
const verificationCode = z
  .string()
  .trim()
  .max(100)
  .transform((value) => value.match(/content="([^"]+)"/)?.[1] ?? value)
  .refine((value) => /^[A-Za-z0-9_-]*$/.test(value), {
    message: "A verification code is letters, digits, - and _. Paste the code or the whole meta tag.",
  });

/** What the settings form may send, with the checks shown to the owner. */
export const storeSeoInput = z.object({
  title: z.record(z.string(), z.string().trim().max(TITLE_MAX, `Keep titles under ${TITLE_MAX} characters.`)),
  description: z.record(
    z.string(),
    z.string().trim().max(DESCRIPTION_MAX, `Keep descriptions under ${DESCRIPTION_MAX} characters.`),
  ),
  image: z
    .object({
      url: z.url("The share picture has an invalid address.").max(1000),
      alt: z.record(z.string(), z.string().trim().max(300)),
    })
    .nullable(),
  sameAs: z
    .array(z.url("Profiles must be full web addresses, starting with https://.").max(300))
    .max(20, "Add at most 20 profiles."),
  hidden: z.boolean(),
  aiAssistants: z.boolean(),
  aiTraining: z.boolean(),
  robots: z.string().max(RULES_MAX, `Keep the rules under ${RULES_MAX} characters.`),
  llms: z.string().trim().max(LLMS_MAX, `Keep the text under ${LLMS_MAX} characters.`),
  verification: z.object({ google: verificationCode, bing: verificationCode }),
});
