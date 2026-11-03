/**
 * The product question (D431): a product layout's `question` part, a short form on the product's page. Its kind is a question (unless set),
 * which goes to the store's support inbox as a conversation with the product attached (`src/server/product-questions.ts`, D382's path), or a
 * request for a quote of the product (`src/server/quote-requests.ts`). The owner sets the heading, the words over it, the button, the thank-you
 * message, which fields are asked and needed (the email address always is) and, for a question, addresses a copy goes to. Pure.
 */
import type { PublicEmailForm } from "./forms";
import type { FormField, ProductBlock, ProductFieldNeed } from "./page-content";
import type { QuoteFields } from "./quotes";

export type QuestionKind = "question" | "quote";
export const questionKindOf = (block: Pick<ProductBlock, "questionKind">): QuestionKind => (block.questionKind === "quote" ? "quote" : "question");

/** What each kind asks unless the owner chose otherwise. */
export const QUESTION_DEFAULTS: Record<QuestionKind, Required<NonNullable<ProductBlock["questionFields"]>>> = {
  question: { name: "required", phone: "hidden", company: "hidden", message: "required" },
  quote: { name: "required", phone: "optional", company: "optional", message: "optional" },
};

/** The part's fields as asked: the owner's choice per field, else the kind's default. */
export function questionFieldsOf(block: Pick<ProductBlock, "questionKind" | "questionFields">): Required<NonNullable<ProductBlock["questionFields"]>> {
  const base = QUESTION_DEFAULTS[questionKindOf(block)];
  const own = block.questionFields ?? {};
  const need = (value: ProductFieldNeed | undefined, fallback: ProductFieldNeed) => value ?? fallback;
  return { name: need(own.name, base.name), phone: need(own.phone, base.phone), company: need(own.company, base.company), message: need(own.message, base.message) };
}

/** A quote request's fields from a part of kind `quote` (the message is its note). */
export function quoteFieldsOf(block: Pick<ProductBlock, "questionKind" | "questionFields">): QuoteFields {
  const f = questionFieldsOf({ ...block, questionKind: "quote" });
  return { name: f.name, phone: f.phone, company: f.company, note: f.message };
}

/** The ids of a question's fields, as the form sends its answers. */
export const QUESTION_KEYS = { name: "name", email: "email", phone: "phone", company: "company", message: "message" } as const;

/**
 * A question part as the site's email form draws and checks it (`SiteForm`, `checkMessage()`): its fields in order, the button's and the thank-you
 * words; never where it is emailed. `words` are the shopper's language's labels, used where the owner wrote none.
 */
export function questionForm(
  block: Pick<ProductBlock, "id" | "questionKind" | "questionFields" | "buttonLabel" | "successMessage">,
  words: { company: string; message: string; button: string; sent: string },
): PublicEmailForm {
  const f = questionFieldsOf({ ...block, questionKind: "question" });
  const field = (id: string, kind: FormField["kind"], need: ProductFieldNeed, label = ""): FormField[] =>
    need === "hidden" ? [] : [{ id, kind, label, required: need === "required" }];
  return {
    id: block.id,
    type: "emailForm",
    fields: [
      ...field(QUESTION_KEYS.name, "name", f.name),
      ...field(QUESTION_KEYS.email, "email", "required"),
      ...field(QUESTION_KEYS.phone, "phone", f.phone),
      ...field(QUESTION_KEYS.company, "text", f.company, words.company),
      ...field(QUESTION_KEYS.message, "textarea", f.message, words.message),
    ],
    submitLabel: block.buttonLabel || words.button,
    successMessage: block.successMessage || words.sent,
  };
}
