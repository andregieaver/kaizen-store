import { z } from "zod";

import { FORM_KEEP_MONTHS_MAX, FORM_NAME_MAX, SHOW_WHEN_MAX } from "./form-records";
import { DATE_DAYS_MAX, NUMBER_LIMIT } from "./questions";
import {
  BUTTON_LABEL_MAX,
  FORM_FIELDS_MAX,
  FORM_FIELD_KINDS,
  FORM_LABEL_MAX,
  FORM_OPTIONS_MAX,
  FORM_RECIPIENTS_MAX,
  FORM_TEXT_MAX,
  LABELLED_KINDS,
  OPTION_FIELD_KINDS,
  SHOW_WHEN_OPS,
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

const bound = z.number().int().min(-NUMBER_LIMIT).max(NUMBER_LIMIT);

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
    help: words("a question's help", FORM_LABEL_MAX).optional(),
    width: z.literal("half").optional(),
    bounds: z.object({ min: bound.optional(), max: bound.optional() }).optional(),
    showWhen: z
      .array(z.object({ question: key, op: z.enum(SHOW_WHEN_OPS), values: z.array(z.number().int().min(0).max(FORM_OPTIONS_MAX - 1)).max(FORM_OPTIONS_MAX).optional() }))
      .max(SHOW_WHEN_MAX, `A question is asked on at most ${SHOW_WHEN_MAX} conditions.`)
      .optional(),
  })
  .refine((q) => !OPTION_FIELD_KINDS.includes(q.kind) || (q.options?.length ?? 0) > 0, { message: "A choice needs at least one option.", path: ["options"] })
  .refine((q) => !LABELLED_KINDS.includes(q.kind) || q.label.text !== "", { message: "A question needs its words.", path: ["label"] })
  .refine((q) => q.bounds?.min === undefined || q.bounds.max === undefined || q.bounds.min <= q.bounds.max, {
    message: "The lowest answer is above the highest.",
    path: ["bounds"],
  })
  .refine(
    (q) => q.kind !== "date" || !q.bounds || [q.bounds.min, q.bounds.max].every((d) => d === undefined || (d >= 0 && d <= DATE_DAYS_MAX)),
    { message: `A date's earliest and latest day are 0 to ${DATE_DAYS_MAX} days from today.`, path: ["bounds"] },
  )
  .transform((q) => ({
    ...q,
    options: OPTION_FIELD_KINDS.includes(q.kind) ? q.options : undefined,
    bounds: (q.kind === "number" || q.kind === "date") && q.bounds && (q.bounds.min !== undefined || q.bounds.max !== undefined) ? q.bounds : undefined,
    showWhen: q.showWhen?.length ? q.showWhen : undefined,
    help: q.help?.text ? q.help : undefined,
  }));

/** Why a form's conditions cannot stand (F3): each names a question above it, and asks of it what that kind of question can answer. */
export function showWhenProblems(questions: readonly z.output<typeof question>[]): string[] {
  const problems: string[] = [];
  questions.forEach((q, i) => {
    for (const c of q.showWhen ?? []) {
      const target = questions.slice(0, i).find((t) => t.id === c.question);
      if (!target) {
        problems.push("A question is asked on the answer to a question that is not above it.");
        continue;
      }
      const options = OPTION_FIELD_KINDS.includes(target.kind) ? (target.options?.length ?? 0) : 0;
      if ((c.op === "is" || c.op === "is_not" || c.op === "any_of") && (options === 0 || !c.values?.length || c.values.some((v) => v >= options))) {
        problems.push("A condition names a choice the question above does not offer.");
      }
      if (c.op === "ticked" && target.kind !== "checkbox" && target.kind !== "checklist") problems.push("Only a tick box or a tick list can be ticked.");
    }
  });
  return [...new Set(problems)];
}

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
      inbox: z.enum(["email", "inbox", "both"]).optional(),
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
  .superRefine((f, ctx) => {
    for (const message of showWhenProblems(f.questions)) ctx.addIssue({ code: "custom", message, path: ["questions"] });
  })
  .refine((f) => (f.kind === "signup") === (f.signup !== null), { message: "Only a sign-up has sign-up settings.", path: ["signup"] })
  .transform((f) => (f.kind === "signup" ? { ...f, questions: [] } : f));

/** What is kept in the row's `questions`, `words`, `delivery` and `signup`: read back with the same shapes. */
export const formRowShape = {
  questions: z.array(question),
  words: draftObject.shape.words,
  delivery: draftObject.shape.delivery,
  signup: draftObject.shape.signup,
};

/** What a form template holds (D705 F4, `FormTemplateContent`): a form's questions and words without what belongs to one store. */
export const templateContentSchema = z.object({
  questions: formRowShape.questions,
  words: formRowShape.words,
  signup: z.object({ confirm: z.boolean(), askName: z.boolean() }).nullable(),
  keepMonths: z.number().int().min(1).max(FORM_KEEP_MONTHS_MAX),
});

/** A template's name or description as kept: words in its language with others beside. */
export const templateWordsSchema = words("a template's words", 200);

/** What the owner names a template when saving or changing it (F4). */
export const templateMetaSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name.").max(FORM_NAME_MAX, `Keep the name under ${FORM_NAME_MAX} characters.`),
  description: z.string().trim().max(200, "Keep the description under 200 characters.").default(""),
  category: z.enum(["contact", "sales", "bookings", "newsletter", "feedback", "events", "other"]).default("other"),
  sharing: z.enum(["private", "stores", "marketplace"]).default("private"),
});
