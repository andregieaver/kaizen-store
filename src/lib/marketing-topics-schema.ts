import { z } from "zod";

import { TOPIC_LINE_MAX, TOPIC_NAME_MAX } from "./marketing-topics";

/** A topic's input (email plan M4.2, D882), apart from `marketing-topics.ts` so the admin's topics card loads no zod. */

const locale = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);

/** A topic's name and optional line per language; empty languages are dropped, and one name is needed. */
export const topicInput = z.object({
  names: z
    .record(
      locale,
      z.object({
        name: z.string().trim().max(TOPIC_NAME_MAX, `A topic's name is longer than ${TOPIC_NAME_MAX} characters.`),
        line: z.string().trim().max(TOPIC_LINE_MAX, `A topic's line is longer than ${TOPIC_LINE_MAX} characters.`).default(""),
      }),
    )
    .transform((names) => Object.fromEntries(Object.entries(names).filter(([, v]) => v.name)))
    .refine((names) => Object.keys(names).length > 0, "Give the topic a name."),
  defaultOn: z.boolean().default(true),
});
