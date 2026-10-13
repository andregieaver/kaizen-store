import { z } from "zod";

import { REPLY_BODY_MAX, REPLY_SHORTCUT_MAX, REPLY_TITLE_MAX, SHORTCUT } from "./support-replies";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

/**
 * A saved reply from the page's form (D216, step 13). Every reply has a shortcut: the table's key on (desk, shortcut) treats two
 * empty ones as the same, and the `/` picker finds replies by it.
 */
export const replyInput = z.object({
  id: z.preprocess(blankToNull, z.string().uuid().nullable()).default(null),
  title: z.string().trim().min(1, "Give the reply a title.").max(REPLY_TITLE_MAX, `A title has at most ${REPLY_TITLE_MAX} characters.`),
  body: z
    .string()
    .trim()
    .min(1, "Write the reply.")
    .max(REPLY_BODY_MAX, `A reply has at most ${REPLY_BODY_MAX} characters.`)
    .transform((body) => body.replaceAll("\u0000", "")),
  shortcut: z
    .string()
    .trim()
    .toLowerCase()
    .max(REPLY_SHORTCUT_MAX, `A shortcut has at most ${REPLY_SHORTCUT_MAX} characters.`)
    .regex(SHORTCUT, "A shortcut is lower-case letters, digits and dashes, starting with a letter or a digit."),
  locale: z.preprocess(blankToNull, z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/, "Choose a language.").nullable()).default(null),
});
export type ReplyInput = z.infer<typeof replyInput>;
