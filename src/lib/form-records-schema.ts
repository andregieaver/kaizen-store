import { z } from "zod";

import { FORM_KEEP_MONTHS_MAX, FORM_NAME_MAX } from "./form-records";
import {
  BUTTON_LABEL_MAX,
  FORM_FIELDS_MAX,
  FORM_FIELD_KINDS,
  FORM_LABEL_MAX,
  FORM_OPTIONS_MAX,
  FORM_RECIPIENTS_MAX,
  FORM_TEXT_MAX,
  LABELLED_KINDS,
  SIGNUP_TAGS_MAX,
  type FormFieldKind,
} from "./page-content";

/**
 * The schemas of `form-records.ts` (D705), apart from it so the storefront does not load zod: what the owner's editor, the AI manager and the
 * server check a form against before it is saved. The limits are the page form's own (D93), so a form holds what a page's form did.
 */

const key = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Part of the form could not be read. Reload the page and try again.");
const locale = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/);

const words = (what: string, max = FORM_TEXT_MAX) =>
  z.object({
    text: z.string().trim().max(max, `Keep ${what} under ${max} characters.`),
    byLocale: z
      .record(locale, z.string().trim().max(max, `Keep ${what} under ${max} characters.`))
      .default({})
      .transform((all) => Object.fromEntries(Object.entries(all).filter(([, v]) => v !== ""))),
  });

const question = z
  .object({
    id: key,
    kind: z.enum(Object.keys(FORM_FIELD_KINDS) as [FormFieldKind, ...FormFieldKind[]], "A question is of an unknown kind."),
    label: words("a question", FORM_LABEL_MAX),
    required: z.boolean().optional(),
    placeholder: words("a hint", FORM_LABEL_MAX).optional(),
    options: z
      .array(words("a choice", FORM_LABEL_MAX).refine((w) => w.text !== "", "A choice needs its words."))
      .max(FORM_OPTIONS_MAX, `A question offers at most ${FORM_OPTIONS_MAX} choices.`)
      .optional(),
  })
  .refine((q) => q.kind !== "select" || (q.options?.length ?? 0) > 0, { message: "A choice from a list needs at least one choice.", path: ["options"] })
  .refine((q) => !LABELLED_KINDS.includes(q.kind) || q.label.text !== "", { message: "A question needs its words.", path: ["label"] })
  .transform((q) => (q.kind === "select" ? q : { ...q, options: undefined }));

const draftObject = z.object({
    kind: z.enum(["message", "signup"]),
    name: z.string().trim().min(1, "Give the form a name.").max(FORM_NAME_MAX, `Keep the name under ${FORM_NAME_MAX} characters.`),
    questions: z
      .array(question)
      .max(FORM_FIELDS_MAX, `A form asks at most ${FORM_FIELDS_MAX} questions.`)
      .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Two questions have the same id. Reload the page and try again."),
    words: z.object({
      submit: words("the button's text", BUTTON_LABEL_MAX).optional(),
      success: words("the thank-you message").optional(),
      consent: words("the tick box's words").optional(),
      placeholder: words("the email field's hint", FORM_LABEL_MAX).optional(),
    }),
    delivery: z.object({
      recipients: z
        .array(z.email("A form sends to an address that is not an email address.").trim().toLowerCase().max(254))
        .max(FORM_RECIPIENTS_MAX, `A form sends to at most ${FORM_RECIPIENTS_MAX} addresses.`)
        .refine((list) => new Set(list).size === list.length, "A form sends to the same address twice."),
      subject: z.string().trim().max(FORM_LABEL_MAX, `Keep the subject under ${FORM_LABEL_MAX} characters.`).default(""),
    }),
    signup: z
      .object({
        confirm: z.boolean(),
        askName: z.boolean(),
        incentive: z.uuid().optional(),
        tags: z.array(z.string().trim().min(1).max(40)).max(SIGNUP_TAGS_MAX, `A sign-up puts at most ${SIGNUP_TAGS_MAX} tags on an address.`).optional(),
      })
      .nullable(),
    keepMonths: z.number().int().min(1).max(FORM_KEEP_MONTHS_MAX, `Responses are kept at most ${FORM_KEEP_MONTHS_MAX} months.`),
  });

export const formDraftSchema = draftObject
  .refine((f) => (f.kind === "signup") === (f.signup !== null), { message: "Only a sign-up has sign-up settings.", path: ["signup"] })
  .transform((f) => (f.kind === "signup" ? { ...f, questions: [] } : f));

/** What is kept in the row's `questions`, `words`, `delivery` and `signup`: read back with the same shapes. */
export const formRowShape = {
  questions: z.array(question),
  words: draftObject.shape.words,
  delivery: draftObject.shape.delivery,
  signup: draftObject.shape.signup,
};
