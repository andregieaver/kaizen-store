import { FORM_KEEP_MONTHS_DEFAULT, type FormDraft, type FormKind, type FormQuestion, type FormWords } from "./form-records";
import type { Words } from "./words";

/**
 * Form templates (D705 F4, `docs/forms.md` 12): Kaizena Flow's own (the seven starters, seeded, and any the platform saves) and a store's
 * own, saved from one of its forms and shared as D125's templates are. A template holds a form without what belongs to one store
 * (`FormTemplateContent`: no recipients, subject, inbox, welcome code or tags), its words in `lang` with the other languages it has. Using
 * one copies it into a new form in the store's languages; a later edit of the template never reaches a form already made. Pure: the
 * screens and the server share it.
 */

export const FORM_TEMPLATE_CATEGORIES = ["contact", "sales", "bookings", "newsletter", "feedback", "events", "other"] as const;
export type FormTemplateCategory = (typeof FORM_TEMPLATE_CATEGORIES)[number];

/** Each category's card icon (a `NavIconName`). */
export const CATEGORY_ICONS: Record<FormTemplateCategory, string> = {
  contact: "mail",
  sales: "receipt",
  bookings: "calendar",
  newsletter: "send",
  feedback: "star",
  events: "users",
  other: "files",
};

export const TEMPLATE_SHARING = ["private", "stores", "marketplace"] as const;
export type TemplateSharing = (typeof TEMPLATE_SHARING)[number];

/** What the owner names a template when saving or changing it. */
export type TemplateMeta = { name: string; description: string; category: FormTemplateCategory; sharing: TemplateSharing };

/** The most templates a store keeps of its own. */
export const FORM_TEMPLATES_MAX = 50;
export const TEMPLATE_DESCRIPTION_MAX = 200;

/** What a template holds: a form's questions and words, a sign-up's confirm and name, and the months its responses are kept. */
export type FormTemplateContent = {
  questions: FormQuestion[];
  words: FormWords;
  signup: { confirm: boolean; askName: boolean } | null;
  keepMonths: number;
};

/** A template as a list shows it, in one language, with what the store may do to it. */
export type FormTemplateItem = {
  id: string;
  kind: FormKind;
  category: FormTemplateCategory;
  name: string;
  description: string;
  /** How many questions it asks (a sign-up's own email and name not counted). */
  questions: number;
  /** `kaizen` (Kaizena Flow's), `own` (this store's), `stores` (its owner's other stores') or `marketplace` (another owner's). */
  source: "kaizen" | "own" | "stores" | "marketplace";
  /** The publishing store's name, for another store's; null for Kaizena Flow's and this store's own. */
  publisher: string | null;
  sharing: TemplateSharing;
  starterKey: string | null;
  /** The owner's form it is updated from, for this store's own. */
  formId: string | null;
  updatedAt: string;
};

/** The template's words of a form: what belongs to one store left out. */
export function templateContentOf(draft: Pick<FormDraft, "questions" | "words" | "signup" | "keepMonths">): FormTemplateContent {
  return {
    questions: draft.questions,
    words: draft.words,
    signup: draft.signup ? { confirm: draft.signup.confirm, askName: draft.signup.askName } : null,
    keepMonths: draft.keepMonths,
  };
}

/**
 * Words written in `from` (their `text`) with other languages beside, made over for a store whose main language is `main` and whose
 * other languages are `langs`: the main language's own words where the template has them (else the template's), and the others it has.
 */
export function wordsFor(words: Words | undefined, from: string, main: string, langs: readonly string[]): Words {
  if (!words) return { text: "", byLocale: {} };
  const all: Record<string, string> = { ...words.byLocale, [from]: words.text };
  const byLocale: Record<string, string> = {};
  for (const lang of langs) if (lang !== main && all[lang]) byLocale[lang] = all[lang];
  return { text: all[main] ?? words.text, byLocale };
}

/** Words in one language: its own, else the main text. */
export const wordsInLang = (words: Words, from: string, lang: string): string => (lang === from ? words.text : (words.byLocale[lang] ?? words.text));

/** A new form from a template, in the store's languages, sending to `recipients` (the owner's own address, so it is ready to place). */
export function draftFromTemplate(
  template: { kind: FormKind; name: Words; lang: string; content: FormTemplateContent },
  main: string,
  langs: readonly string[],
  recipients: string[],
): FormDraft {
  const w = (words: Words | undefined) => wordsFor(words, template.lang, main, langs);
  const c = template.content;
  const words: FormWords = {};
  for (const key of ["submit", "success", "consent", "placeholder"] as const) if (c.words[key]) words[key] = w(c.words[key]);
  return {
    kind: template.kind,
    name: w(template.name).text.slice(0, 80),
    questions: template.kind === "message"
      ? c.questions.map((q) => ({
          ...q,
          label: w(q.label),
          ...(q.placeholder ? { placeholder: w(q.placeholder) } : {}),
          ...(q.help ? { help: w(q.help) } : {}),
          ...(q.options ? { options: q.options.map(w) } : {}),
        }))
      : [],
    words,
    delivery: { recipients, subject: "" },
    signup: template.kind === "signup" ? { confirm: c.signup?.confirm ?? true, askName: c.signup?.askName ?? false } : null,
    keepMonths: c.keepMonths || FORM_KEEP_MONTHS_DEFAULT,
  };
}
