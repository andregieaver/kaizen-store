import { z } from "zod";

/**
 * The AI manager's form tools (D705 F5, `docs/forms.md` 7): what they take. Pure; the runners are `src/server/form-tools.ts`. A form is
 * made from a template and changed through the editor's own `saveForm()`, so the model's form is checked as the owner's is; a form is placed
 * on a page's draft, never published by these tools. What visitors sent is their own words: `form_responses` gives it as data to read.
 */

const formRef = z.string().trim().min(1).max(200).describe("The form: its name as list_forms gives it (a part of it is enough when only one form has it), or its id.");

export const listFormsInput = z.object({
  templates: z.boolean().default(false).describe("Also list the templates a new form can be made from (Kaizena Flow's, the store's own and shared ones)."),
});
export type ListFormsInput = z.output<typeof listFormsInput>;

export const makeFormInput = z.object({
  template: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe("The template's name or id as list_forms gives it with templates: true, such as Contact, Quote request or Newsletter. A form is always made from one."),
  name: z.string().trim().min(1).max(80).optional().describe("The owner's name for the new form. Left out: the template's name."),
});
export type MakeFormInput = z.output<typeof makeFormInput>;

const QUESTION_KINDS = ["name", "email", "phone", "text", "textarea", "select", "radio", "checkbox", "checklist", "number", "date"] as const;

export const formQuestionInput = z.object({
  kind: z.enum(QUESTION_KINDS).describe("name, email, phone, text (one line), textarea (a message), select (a dropdown), radio (one choice), checkbox (one tick), checklist (any of the choices), number or date."),
  label: z.string().trim().max(200).default("").describe("The question, in the site's main language. Left empty for name, email, phone and textarea: the usual words in the visitor's language."),
  required: z.boolean().default(false),
  choices: z.array(z.string().trim().min(1).max(200)).max(20).optional().describe("The choices of a select, radio or checklist question, in order."),
  help: z.string().trim().max(200).optional().describe("A line of help under the question."),
});

export type FormQuestionArgs = z.output<typeof formQuestionInput>;

export const changeFormInput = z.object({
  form: formRef,
  name: z.string().trim().min(1).max(80).optional().describe("A new name for the owner's list; never shown on the site."),
  questions: z
    .array(formQuestionInput)
    .min(1)
    .max(20)
    .optional()
    .describe("A message form's questions, whole and in order: what it asks from now on. A question kept as it was keeps its words in other languages."),
  recipients: z.array(z.email().max(254)).min(1).max(5).optional().describe("Where its messages are emailed, whole: only addresses the owner gave."),
  button: z.string().trim().max(60).optional().describe("The button's words; empty: the usual words."),
  thanks: z.string().trim().max(1000).optional().describe("What visitors read after sending; empty: the usual words."),
});
export type ChangeFormInput = z.output<typeof changeFormInput>;

export const placeFormInput = z.object({
  form: formRef,
  page: z.string().trim().min(1).max(200).describe("The page: its id, or its address (slug) as list_pages gives it."),
  at: z.number().int().min(1).max(100).optional().describe("The row it goes in as, counted from the top (1 is first). Left out: the end of the page."),
});
export type PlaceFormInput = z.output<typeof placeFormInput>;

export const formResponsesInput = z.object({
  form: formRef,
  limit: z.number().int().min(1).max(25).default(10).describe("How many of the newest responses to read, at most 25."),
  only_new: z.boolean().default(false).describe("Only responses not yet opened in the admin."),
});
export type FormResponsesInput = z.output<typeof formResponsesInput>;

/** A text as one short line for a card: line breaks and control characters out, cut with an ellipsis. */
const line = (value: unknown, max: number): string => {
  const text = String(value ?? "")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** The card for a form change: what changes, from the arguments, with the addresses written out (they decide where visitors' messages go). */
export function changeFormSummary(given: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof given.name === "string") parts.push(`name it "${line(given.name, 60)}"`);
  if (Array.isArray(given.questions)) parts.push(`ask ${given.questions.length} question${given.questions.length === 1 ? "" : "s"}`);
  if (Array.isArray(given.recipients)) parts.push(`email its messages to ${given.recipients.map((r) => line(r, 80)).join(", ")}`);
  if (typeof given.button === "string") parts.push("change its button's words");
  if (typeof given.thanks === "string") parts.push("change its thank-you message");
  return `Change the form ${line(given.form, 60)}: ${parts.length > 0 ? parts.join(", ") : "nothing given"}. A page that shows it shows the change at once.`;
}
