import type { EmailFormBlock, FormButton, FormField, FormFieldKind, NewsletterBlock, NewsletterLayout, ShowWhen } from "./page-content";
import type { AnswerBounds } from "./questions";
import { normaliseEmail } from "./email-address";
import { plainWords, wordsIn, type Words } from "./words";

/**
 * Forms as their own records (D705, `docs/forms.md`): the pure parts, free of zod so the storefront can import them. A form is a row of
 * `commerce.forms`; a page's `form` component points at it by id and keeps only its look. What the site draws and the server checks is the
 * form turned into the shape of the page's own email form or sign-up (`formAsBlock()`), in one language, with the form's id as its id: the
 * checks, emails, inbox, confirmation link and limits of D93 then serve both.
 */

export type FormKind = "message" | "signup";
export type FormStatus = "active" | "archived";

export const FORM_KINDS: Record<FormKind, string> = { message: "Message", signup: "Newsletter sign-up" };

/** Months a form keeps its responses: the owner's choice, at most the retention rule's (`form_responses`, a test holds them equal). */
export const FORM_KEEP_MONTHS_MAX = 36;
export const FORM_KEEP_MONTHS_DEFAULT = 12;
export const FORM_KEEP_CHOICES = [1, 3, 6, 12, 24, 36] as const;
export const FORM_NAME_MAX = 80;
/** Forms a store may have. */
export const FORMS_MAX = 50;

/** One question: a page form's question with its words per language. */
export type FormQuestion = {
  id: string;
  kind: FormFieldKind;
  label: Words;
  required?: boolean;
  placeholder?: Words;
  options?: Words[];
  /** A line of help under the question (F3). */
  help?: Words;
  /** Half the form's width, beside the next half (F3). */
  width?: "half";
  /** A number's lowest and highest value, or a date's earliest and latest day from today (F3). */
  bounds?: AnswerBounds;
  /** Asked only when every one holds, each naming a question above it (F3). */
  showWhen?: ShowWhen[];
  /** A hidden field's address parameter (D738 F6a), such as `utm_campaign`: its answer is read from the address, never asked. */
  param?: string;
};

/** Conditions a question may have (F3). */
export const SHOW_WHEN_MAX = 5;

/** The form's own words; each left empty reads in the page's language (D93). */
export type FormWords = { submit?: Words; success?: Words; consent?: Words; placeholder?: Words };

/** Where a message goes: never sent to the browser. */
/**
 * Where a message goes: never sent to the browser. `inbox` (F3, a store's form while its support desk is on, D382): `email` only to the
 * recipients, `inbox` only to the support inbox, `both`; the desk's own choice (`form_messages`) unless set. The recipients are emailed
 * whatever the choice while the desk is off, so a form always needs one.
 */
export type FormInbox = "email" | "inbox" | "both";
export type FormDelivery = { recipients: string[]; subject: string; inbox?: FormInbox };

/** A sign-up's settings (D93, D304 J3). */
export type FormSignup = { confirm: boolean; askName: boolean; incentive?: string; tags?: string[]; topics?: string[] };

/** What the owner edits: the form without its id, store and times. */
export type FormDraft = {
  kind: FormKind;
  name: string;
  questions: FormQuestion[];
  words: FormWords;
  delivery: FormDelivery;
  signup: FormSignup | null;
  keepMonths: number;
  /**
   * The product variant a message form's visitors pay for after sending (D738 F6c): its price in the page's market, through the store's own
   * checkout, as any order. A store's forms only; left out or null: no payment.
   */
  paymentVariantId?: string | null;
};

export type FormRecord = FormDraft & { id: string; storeId: string | null; status: FormStatus; madeFrom: string | null };

/** How the page's component draws its form: the look of a button (D49) and, for a sign-up, side by side or stacked. */
export type FormLook = { button?: FormButton; layout?: NewsletterLayout };

const words = (w: Words | undefined, locale: string) => (w ? wordsIn(w, locale) : "");

/**
 * The form as a page's email form or sign-up, in one language (`locale`; the main text when it is not given), with the form's id as its id.
 * The server checks and labels answers with it in the owner's language, as D93 does; the site draws it in the visitor's.
 */
export function formAsBlock(form: Pick<FormRecord, "id" | "kind" | "questions" | "words" | "delivery" | "signup">, locale: string | null, look: FormLook = {}): EmailFormBlock | NewsletterBlock {
  const at = (w: Words | undefined) => (locale ? words(w, locale) : (w?.text ?? ""));
  if (form.kind === "signup") {
    const signup = form.signup ?? { confirm: true, askName: false };
    return {
      id: form.id,
      type: "newsletter",
      recipients: form.delivery.recipients,
      askName: signup.askName,
      placeholder: at(form.words.placeholder),
      submitLabel: at(form.words.submit),
      successMessage: at(form.words.success),
      consent: at(form.words.consent),
      confirm: signup.confirm,
      ...(look.layout ? { layout: look.layout } : {}),
      ...(look.button ? { button: look.button } : {}),
      ...(signup.incentive ? { incentive: signup.incentive } : {}),
      ...(signup.tags?.length ? { tags: signup.tags } : {}),
      ...(signup.topics?.length ? { topics: signup.topics } : {}),
    };
  }
  const consent = at(form.words.consent);
  return {
    id: form.id,
    type: "emailForm",
    recipients: form.delivery.recipients,
    subject: form.delivery.subject,
    fields: form.questions.map(
      (q): FormField => ({
        id: q.id,
        kind: q.kind,
        label: at(q.label),
        ...(q.required ? { required: true } : {}),
        ...(q.placeholder && at(q.placeholder) ? { placeholder: at(q.placeholder) } : {}),
        ...(q.options ? { options: q.options.map((o) => at(o)) } : {}),
        ...(q.help && at(q.help) ? { help: at(q.help) } : {}),
        ...(q.width ? { width: q.width } : {}),
        ...(q.bounds?.min !== undefined ? { min: q.bounds.min } : {}),
        ...(q.bounds?.max !== undefined ? { max: q.bounds.max } : {}),
        ...(q.showWhen?.length ? { showWhen: q.showWhen } : {}),
        ...(q.param ? { param: q.param } : {}),
      }),
    ),
    submitLabel: at(form.words.submit),
    successMessage: at(form.words.success),
    ...(consent ? { consent } : {}),
    ...(look.button ? { button: look.button } : {}),
  };
}

/** A form takes answers: active, with somewhere to send to and, for a message, something to ask. */
export const formTakesAnswers = (form: Pick<FormRecord, "status" | "kind" | "questions" | "delivery">) =>
  form.status === "active" && form.delivery.recipients.length > 0 && (form.kind === "signup" || form.questions.length > 0);

/** The address to find a response by (the person's export and erasure): the first email answered, lower case. */
export function contactOf(form: Pick<FormRecord, "kind" | "questions">, values: Record<string, string | boolean>): string | null {
  if (form.kind === "signup") return typeof values.email === "string" ? normaliseEmail(values.email) || null : null;
  for (const q of form.questions) {
    const v = values[q.id];
    if (q.kind === "email" && typeof v === "string" && v.trim()) return normaliseEmail(v);
  }
  return null;
}

/** A form as the page builder offers it (D705): to pick in a `form` component and to draw on the canvas, without where it sends. */
export type BuilderForm = {
  id: string;
  name: string;
  kind: FormKind;
  status: FormStatus;
  /** It has somewhere to send to and something to ask, and is not archived. */
  takesAnswers: boolean;
  /** The form in the page's main language as the site draws it, its look left to the component. */
  preview: Omit<EmailFormBlock, "recipients" | "subject"> | Omit<NewsletterBlock, "recipients" | "incentive" | "tags">;
};

/** What the builder knows of the owner's forms, and where they are made and changed. */
export type BuilderForms = { list: BuilderForm[]; href: string };

// ---------------------------------------------------------------------------------------------------------------------------------
// Kaizena Flow's starters as written first: migration `form_templates_rules` seeded them as Kaizena Flow's form templates (F4), which is
// what stores are offered and the platform edits from then on. Kept as the seed's source and for tests; nothing offers them from here.

/** Words in the hand-written languages; English is the fallback. */
type Said = { en: string; nb?: string; sv?: string; da?: string };
type StarterQuestion = { kind: FormFieldKind; label?: Said; required?: boolean; options?: Said[] };
export type FormStarter = {
  key: string;
  kind: FormKind;
  name: Said;
  description: Said;
  /** The `NavIconName` shown on its card. */
  icon: string;
  questions: StarterQuestion[];
  consent?: Said;
};

export const FORM_STARTERS: readonly FormStarter[] = [
  {
    key: "contact",
    kind: "message",
    icon: "mail",
    name: { en: "Contact", nb: "Kontakt", sv: "Kontakt", da: "Kontakt" },
    description: { en: "Name, email and a message.", nb: "Navn, e-post og en melding.", sv: "Namn, e-post och ett meddelande.", da: "Navn, e-mail og en besked." },
    questions: [{ kind: "name", required: true }, { kind: "email", required: true }, { kind: "textarea", required: true }],
  },
  {
    key: "quote",
    kind: "message",
    icon: "receipt",
    name: { en: "Quote request", nb: "Be om tilbud", sv: "Offertförfrågan", da: "Tilbudsforespørgsel" },
    description: { en: "What they need, with company and phone.", nb: "Hva de trenger, med firma og telefon.", sv: "Vad de behöver, med företag och telefon.", da: "Hvad de har brug for, med firma og telefon." },
    questions: [
      { kind: "name", required: true },
      { kind: "text", label: { en: "Company", nb: "Firma", sv: "Företag", da: "Firma" } },
      { kind: "email", required: true },
      { kind: "phone" },
      { kind: "textarea", label: { en: "What do you need?", nb: "Hva trenger du?", sv: "Vad behöver du?", da: "Hvad har du brug for?" }, required: true },
    ],
  },
  {
    key: "booking",
    kind: "message",
    icon: "calendar",
    name: { en: "Booking enquiry", nb: "Bookingforespørsel", sv: "Bokningsförfrågan", da: "Bookingforespørgsel" },
    description: { en: "A preferred date and how many.", nb: "Ønsket dato og hvor mange.", sv: "Önskat datum och hur många.", da: "Ønsket dato og hvor mange." },
    questions: [
      { kind: "name", required: true },
      { kind: "email", required: true },
      { kind: "phone" },
      { kind: "text", label: { en: "Preferred date", nb: "Ønsket dato", sv: "Önskat datum", da: "Ønsket dato" }, required: true },
      {
        kind: "select",
        label: { en: "How many people?", nb: "Hvor mange personer?", sv: "Hur många personer?", da: "Hvor mange personer?" },
        options: [{ en: "1" }, { en: "2" }, { en: "3–5" }, { en: "6–10" }, { en: "More than 10", nb: "Flere enn 10", sv: "Fler än 10", da: "Flere end 10" }],
      },
      { kind: "textarea" },
    ],
  },
  {
    key: "callback",
    kind: "message",
    icon: "megaphone",
    name: { en: "Call me back", nb: "Ring meg opp", sv: "Ring upp mig", da: "Ring mig op" },
    description: { en: "A phone number and the best time to call.", nb: "Et telefonnummer og når det passer å ringe.", sv: "Ett telefonnummer och när det passar att ringa.", da: "Et telefonnummer og hvornår det passer at ringe." },
    questions: [
      { kind: "name", required: true },
      { kind: "phone", required: true },
      {
        kind: "select",
        label: { en: "Best time to call", nb: "Når passer det best?", sv: "När passar det bäst?", da: "Hvornår passer det bedst?" },
        options: [
          { en: "Morning", nb: "Formiddag", sv: "Förmiddag", da: "Formiddag" },
          { en: "Afternoon", nb: "Ettermiddag", sv: "Eftermiddag", da: "Eftermiddag" },
          { en: "Evening", nb: "Kveld", sv: "Kväll", da: "Aften" },
        ],
      },
    ],
  },
  {
    key: "feedback",
    kind: "message",
    icon: "star",
    name: { en: "Feedback", nb: "Tilbakemelding", sv: "Feedback", da: "Feedback" },
    description: { en: "How it went, in their own words.", nb: "Hvordan det gikk, med egne ord.", sv: "Hur det gick, med egna ord.", da: "Hvordan det gik, med egne ord." },
    questions: [
      {
        kind: "select",
        label: { en: "How was it?", nb: "Hvordan var det?", sv: "Hur var det?", da: "Hvordan var det?" },
        required: true,
        options: [
          { en: "Very good", nb: "Veldig bra", sv: "Mycket bra", da: "Meget godt" },
          { en: "Good", nb: "Bra", sv: "Bra", da: "Godt" },
          { en: "Not so good", nb: "Ikke så bra", sv: "Inte så bra", da: "Ikke så godt" },
        ],
      },
      { kind: "textarea", label: { en: "Tell us more", nb: "Fortell oss mer", sv: "Berätta mer", da: "Fortæl os mere" } },
      { kind: "email" },
    ],
  },
  {
    key: "event",
    kind: "message",
    icon: "users",
    name: { en: "Event registration", nb: "Påmelding til arrangement", sv: "Anmälan till evenemang", da: "Tilmelding til arrangement" },
    description: { en: "Who is coming, with a box to agree.", nb: "Hvem som kommer, med en boks å krysse av.", sv: "Vem som kommer, med en ruta att kryssa i.", da: "Hvem der kommer, med en boks at krydse af." },
    questions: [
      { kind: "name", required: true },
      { kind: "email", required: true },
      { kind: "text", label: { en: "Company", nb: "Firma", sv: "Företag", da: "Firma" } },
      { kind: "textarea", label: { en: "Allergies or other needs", nb: "Allergier eller andre behov", sv: "Allergier eller andra behov", da: "Allergier eller andre behov" } },
    ],
    consent: { en: "I agree that my details are used for this event.", nb: "Jeg godtar at opplysningene mine brukes til dette arrangementet.", sv: "Jag godkänner att mina uppgifter används för detta evenemang.", da: "Jeg accepterer, at mine oplysninger bruges til dette arrangement." },
  },
  {
    key: "newsletter",
    kind: "signup",
    icon: "send",
    name: { en: "Newsletter", nb: "Nyhetsbrev", sv: "Nyhetsbrev", da: "Nyhedsbrev" },
    description: { en: "An email address, confirmed by the visitor.", nb: "En e-postadresse, bekreftet av den besøkende.", sv: "En e-postadress, bekräftad av besökaren.", da: "En e-mailadresse, bekræftet af den besøgende." },
    questions: [],
  },
] as const;

const LANGS = ["en", "nb", "sv", "da"] as const;
/** The starter's words: the main language's (English unless it has them), with the others it has under their language. */
function saidAs(said: Said | undefined, main: string, langs: readonly string[]): Words {
  if (!said) return plainWords("");
  const pick = (lang: string) => (said as Record<string, string | undefined>)[lang];
  const byLocale: Record<string, string> = {};
  for (const lang of langs) if (lang !== main && LANGS.includes(lang as (typeof LANGS)[number]) && pick(lang)) byLocale[lang] = pick(lang)!;
  return { text: pick(main) ?? said.en, byLocale };
}

/** A starter's name in a language. */
export const starterName = (starter: FormStarter, lang: string) => (starter.name as Record<string, string | undefined>)[lang] ?? starter.name.en;
export const starterDescription = (starter: FormStarter, lang: string) => (starter.description as Record<string, string | undefined>)[lang] ?? starter.description.en;

/**
 * A new form from a starter, in the store's main language with its other languages' words where the starter has them, sending to
 * `recipients` (the owner's address, so the form is ready to place).
 */
export function draftFromStarter(starter: FormStarter, main: string, langs: readonly string[], recipients: string[]): FormDraft {
  return {
    kind: starter.kind,
    name: starterName(starter, main),
    questions: starter.questions.map((q, i) => ({
      id: `q${i + 1}`,
      kind: q.kind,
      label: saidAs(q.label, main, langs),
      ...(q.required ? { required: true } : {}),
      ...(q.options ? { options: q.options.map((o) => saidAs(o, main, langs)) } : {}),
    })),
    words: starter.consent ? { consent: saidAs(starter.consent, main, langs) } : {},
    delivery: { recipients, subject: "" },
    signup: starter.kind === "signup" ? { confirm: true, askName: false } : null,
    keepMonths: FORM_KEEP_MONTHS_DEFAULT,
  };
}

/** A blank form of a kind. */
export function blankDraft(kind: FormKind, name: string, recipients: string[]): FormDraft {
  return {
    kind,
    name,
    questions: kind === "message" ? [{ id: "q1", kind: "name", label: plainWords("") }, { id: "q2", kind: "email", label: plainWords(""), required: true }, { id: "q3", kind: "textarea", label: plainWords("") }] : [],
    words: {},
    delivery: { recipients, subject: "" },
    signup: kind === "signup" ? { confirm: true, askName: false } : null,
    keepMonths: FORM_KEEP_MONTHS_DEFAULT,
  };
}

/** A question id not yet used in the form. */
export function newQuestionId(questions: readonly Pick<FormQuestion, "id">[]): string {
  const used = new Set(questions.map((q) => q.id));
  for (let n = questions.length + 1; ; n++) if (!used.has(`q${n}`)) return `q${n}`;
}
