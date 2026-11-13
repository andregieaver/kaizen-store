import { z } from "zod";

import { FIELD_LABEL_MAX, FIELDS_MAX, type CheckoutField, type CheckoutFieldKind, type Words } from "./checkout-rules";
import { fieldInputSchema, type FieldInput } from "./checkout-rules-schema";
import { localeFor } from "./quote-tools";

/**
 * The AI manager's questions at checkout (D357, task 1 of `docs/checkout-fields-tasks.md`): what `checkout_questions` and
 * `save_checkout_question` take, the change laid over the question as it is (`questionChange()`), and what the owner is asked to approve.
 * Pure; the runners are `src/server/checkout-question-tools.ts`, which save through Settings, Checkout rules' own writers.
 */

const HELP_MAX = 200;
const language = z.string().trim().min(2).max(10).describe("One of the store's languages, by code (nb, sv, en) or locale (nb-NO).");

const inLanguage = (max: number) =>
  z
    .array(z.object({ language, text: z.string().trim().max(max).describe('The words in that language; "" takes them away there.') }))
    .max(20);

export const checkoutQuestionsInput = z.object({});

export const saveCheckoutQuestionInput = z.object({
  id: z.uuid().optional().describe("The question to change, from checkout_questions; left out to add one."),
  kind: z.enum(["text", "checkbox"]).optional().describe("text: a line the shopper types (at most 500 characters); checkbox: a tick box. Adding: text unless given."),
  required: z.boolean().optional().describe("Must be answered before the order is placed (a tick box: ticked). Adding: optional unless given."),
  question: z
    .string()
    .trim()
    .min(1)
    .max(FIELD_LABEL_MAX)
    .optional()
    .describe("The question in the store's main language, in the owner's words. Needed when adding."),
  question_in: inLanguage(FIELD_LABEL_MAX).optional().describe("The question in the store's other languages; only the languages given change."),
  help: z.string().trim().max(HELP_MAX).nullable().optional().describe('A line under the question in the main language; "" or null takes it away.'),
  help_in: inLanguage(HELP_MAX).optional().describe("The help line in the store's other languages; only the languages given change."),
  on: z.boolean().optional().describe("Asked at checkout (true) or kept but not asked (false). Adding: on unless given."),
  place: z.int().min(1).optional().describe("Where it is asked, 1 being first; the others keep their order. A place past the end is the end."),
});
export type SaveCheckoutQuestionInput = z.output<typeof saveCheckoutQuestionInput>;

/** What a call changes: the question as it should be saved (null: its words and kind stay), its switch and its place (0 first). */
export type QuestionChange = { field: FieldInput | null; on: boolean | undefined; to: number | undefined };

/** Words with another language's laid over them, matched to the store's locales; "" takes a language away. */
function overlay(had: Words, given: { language: string; text: string }[] | undefined, locales: readonly string[], problems: string[]): Words {
  const byLocale = { ...had.byLocale };
  for (const line of given ?? []) {
    const locale = localeFor(line.language, locales.slice(1));
    if (!locale) {
      problems.push(`${line.language} is not one of the store's other languages (${locales.slice(1).join(", ") || "it has none"}).`);
      continue;
    }
    if (line.text) byLocale[locale] = line.text;
    else delete byLocale[locale];
  }
  return { text: had.text, byLocale };
}

/**
 * The change a call asks for, laid over the question it names (or a new one), checked as the editor checks it. `locales` are the store's,
 * its main one first; `count` how many questions it has. Problems are sentences for the model to repeat.
 */
export function questionChange(
  input: SaveCheckoutQuestionInput,
  had: CheckoutField | null,
  locales: readonly string[],
  count: number,
): { ok: true; change: QuestionChange } | { ok: false; problems: string[] } {
  if (!had && input.id) return { ok: false, problems: ["That question is not one of this store's. Read checkout_questions."] };
  const problems: string[] = [];
  if (!had && !input.id && count >= FIELDS_MAX) problems.push(`A checkout asks at most ${FIELDS_MAX} questions; this store has ${count}.`);
  if (!had && !input.question) return { ok: false, problems: [...problems, "Give the question in the store's main language (question)."] };
  const words = input.question !== undefined || input.question_in !== undefined || input.help !== undefined || input.help_in !== undefined;
  const changes = words || input.kind !== undefined || input.required !== undefined;
  let field: FieldInput | null = null;
  if (!had || changes) {
    const label = overlay({ text: input.question ?? had?.label.text ?? "", byLocale: had?.label.byLocale ?? {} }, input.question_in, locales, problems);
    const helpText = input.help === undefined ? (had?.help?.text ?? "") : (input.help ?? "");
    const help = overlay({ text: helpText, byLocale: had?.help?.byLocale ?? {} }, input.help_in, locales, problems);
    const parsed = fieldInputSchema.safeParse({
      kind: input.kind ?? had?.kind ?? "text",
      required: input.required ?? had?.required ?? false,
      label,
      help: help.text.trim() ? help : null,
    });
    if (parsed.success) field = parsed.data;
    else problems.push(...new Set(parsed.error.issues.map((i) => `${i.path.join(".") || "question"}: ${i.message}`)));
  }
  if (had && !changes && input.on === undefined && input.place === undefined) problems.push("Say what changes: the words, kind, required, on or place.");
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, change: { field, on: input.on, to: input.place === undefined ? undefined : input.place - 1 } };
}

const KIND_WORDS: Record<CheckoutFieldKind, string> = { text: "a line to type", checkbox: "a tick box" };

/** What the owner says yes to, from the call's own arguments; `name` is the question's words as the store has them, for a change. */
export function checkoutQuestionSummary(input: Record<string, unknown>, name?: string): string {
  const text = (key: string) => String(input[key] ?? "");
  const parts: string[] = [];
  if (typeof input.question === "string" && input.id) parts.push(`reword it to "${text("question")}"`);
  if (Array.isArray(input.question_in) && input.question_in.length > 0) parts.push(`set its words in ${input.question_in.map((l) => String((l as { language: unknown }).language)).join(", ")}`);
  if (input.help !== undefined || (Array.isArray(input.help_in) && input.help_in.length > 0)) parts.push(input.help === "" || input.help === null ? "take its help line away" : "change its help line");
  if (typeof input.kind === "string" && input.id) parts.push(`make it ${KIND_WORDS[input.kind as CheckoutFieldKind] ?? text("kind")}`);
  if (typeof input.required === "boolean" && input.id) parts.push(input.required ? "make it required" : "make it optional");
  if (typeof input.on === "boolean") parts.push(input.on ? "ask it at checkout" : "stop asking it (it is kept)");
  if (typeof input.place === "number") parts.push(`ask it in place ${input.place}`);
  if (!input.id) {
    const kind = KIND_WORDS[(input.kind as CheckoutFieldKind) ?? "text"] ?? "a line to type";
    const required = input.required === true ? "required" : "optional";
    // Whether a new question is on is said once, after its words.
    const rest = parts.filter((p) => !p.startsWith("ask it at checkout") && !p.startsWith("stop asking it"));
    return `Ask shoppers a new question at checkout: "${text("question")}" (${kind}, ${required})${input.on === false ? ", kept off for now" : ""}${rest.length > 0 ? `; ${rest.join("; ")}` : ""}. The answers are kept on the order.`;
  }
  return `Change the checkout question${name ? ` "${name}"` : ""}: ${parts.join("; ") || "nothing"}.`;
}
