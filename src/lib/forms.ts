import type { Messages } from "./i18n";

/** The texts the form functions read: only `form`, which the browser has too (`browserText()`, D212). */
type FormTexts = Pick<Messages, "form">;
import type { EmailFormBlock, FormField, FormFieldKind, NewsletterBlock } from "./page-content";
import type { FormRequest } from "./forms-schema";
import { normaliseEmail } from "./email-address";

/**
 * Forms on pages (D93): an email form and a newsletter sign-up. What a
 * visitor sends is checked here against the form as published, the same
 * in the browser's messages and on the server, and turned into the
 * answers emailed to the form's recipients.
 */

/** A form as the site's pages carry it: where it sends to stays on the server. */
export type PublicEmailForm = Omit<EmailFormBlock, "recipients" | "subject">;
export type PublicNewsletter = Omit<NewsletterBlock, "recipients" | "incentive" | "tags">;
export type PublicForm = PublicEmailForm | PublicNewsletter;

export function publicForm(block: EmailFormBlock | NewsletterBlock): PublicForm {
  if (block.type === "newsletter") {
    const form: PublicNewsletter & { recipients?: string[]; incentive?: string; tags?: string[] } = { ...block };
    delete form.recipients;
    delete form.incentive;
    delete form.tags;
    return form;
  }
  const form: PublicEmailForm & { recipients?: string[]; subject?: string } = { ...block };
  delete form.recipients;
  delete form.subject;
  return form;
}

/** A question's words: its own, else its kind's usual name in the language. */
export function fieldLabel(field: Pick<FormField, "kind" | "label">, m: FormTexts): string {
  if (field.label) return field.label;
  const usual: Partial<Record<FormFieldKind, string>> = { name: m.form.name, email: m.form.email, phone: m.form.phone, textarea: m.form.message };
  return usual[field.kind] ?? "";
}

/** The newsletter's email and name fields, by these keys. */
export const NEWSLETTER_KEYS = { email: "email", name: "name" } as const;
/** The key of a missing consent's message. */
export const CONSENT_KEY = "consent";

const LINE_MAX = 300;
export const MESSAGE_MAX = 5000;

/** Sent faster than this, a form was filled in by a robot. */
export const HUMAN_MS = 2000;

/** Whether a request looks sent by a robot: its hidden field filled in, or sent at once. */
export const looksAutomated = (request: Pick<FormRequest, "website" | "elapsed">) => request.website !== "" || request.elapsed < HUMAN_MS;

export type Answer = { label: string; value: string };
export type FormErrors = Record<string, string>;

export type CheckedMessage = { ok: true; answers: Answer[]; replyTo: string | null } | { ok: false; errors: FormErrors };
export type CheckedSignup = { ok: true; email: string; name: string } | { ok: false; errors: FormErrors };

/** One line of text: control characters and line breaks taken out. */
const line = (value: string) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
/** A message: line breaks kept, other control characters out. */
const paragraph = (value: string) =>
  value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ")
    .trim();

/** zod's own email rule (`z.email()`), written here so a form checks in the browser without zod. */
const EMAIL = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
export const isEmail = (value: string) => value.length <= 254 && EMAIL.test(value);
export const isPhone = (value: string) => /^\+?[0-9 ()./-]{5,30}$/.test(value) && (value.match(/[0-9]/g)?.length ?? 0) >= 5;

/**
 * A message checked against the form's questions. Errors are in the
 * visitor's language (`visitor`), by question id (and `consent`);
 * the answers are labelled in the owner's (`owner`), as the form was
 * written, choices by their place in the list.
 */
export function checkMessage(
  block: Pick<EmailFormBlock, "fields" | "consent">,
  values: FormRequest["values"],
  consent: boolean,
  visitor: FormTexts,
  owner: FormTexts,
): CheckedMessage {
  const errors: FormErrors = {};
  const answers: Answer[] = [];
  let replyTo: string | null = null;
  for (const field of block.fields) {
    const raw = values[field.id];
    const label = fieldLabel(field, owner);
    if (field.kind === "checkbox") {
      const ticked = raw === true;
      if (field.required && !ticked) errors[field.id] = visitor.form.consentNeeded;
      answers.push({ label, value: ticked ? owner.form.yes : owner.form.no });
      continue;
    }
    const text = typeof raw === "string" ? (field.kind === "textarea" ? paragraph(raw) : line(raw)) : "";
    if (text === "") {
      if (field.required) errors[field.id] = visitor.form.required;
      continue;
    }
    if (text.length > (field.kind === "textarea" ? MESSAGE_MAX : LINE_MAX)) {
      errors[field.id] = visitor.form.tooLong;
      continue;
    }
    if (field.kind === "email") {
      if (!isEmail(text)) {
        errors[field.id] = visitor.form.invalidEmail;
        continue;
      }
      replyTo ??= text;
    }
    if (field.kind === "phone" && !isPhone(text)) {
      errors[field.id] = visitor.form.invalidPhone;
      continue;
    }
    if (field.kind === "select") {
      // The browser sends the choice's place: its words may be in another language.
      const option = /^\d{1,2}$/.test(text) ? field.options?.[Number(text)] : undefined;
      if (option === undefined) {
        errors[field.id] = visitor.form.required;
        continue;
      }
      answers.push({ label, value: option });
      continue;
    }
    answers.push({ label, value: text });
  }
  if (block.consent && !consent) errors[CONSENT_KEY] = visitor.form.consentNeeded;
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, answers, replyTo };
}

/** A newsletter sign-up checked: an email address, a name if asked (never required), and the consent ticked. */
export function checkSignup(
  block: Pick<NewsletterBlock, "askName">,
  values: FormRequest["values"],
  consent: boolean,
  visitor: FormTexts,
): CheckedSignup {
  const errors: FormErrors = {};
  const raw = values[NEWSLETTER_KEYS.email];
  const email = typeof raw === "string" ? normaliseEmail(line(raw)) : "";
  if (email === "") errors[NEWSLETTER_KEYS.email] = visitor.form.required;
  else if (!isEmail(email)) errors[NEWSLETTER_KEYS.email] = visitor.form.invalidEmail;
  const rawName = values[NEWSLETTER_KEYS.name];
  const name = block.askName && typeof rawName === "string" ? line(rawName) : "";
  if (name.length > LINE_MAX) errors[NEWSLETTER_KEYS.name] = visitor.form.tooLong;
  if (!consent) errors[CONSENT_KEY] = visitor.form.consentNeeded;
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, email, name };
}

/** What `/api/forms` answers. */
export type FormResponse =
  | { ok: true; outcome: "sent" | "confirm" }
  | { ok: false; errors?: FormErrors; error?: string };

/** The address a confirmed or expired sign-up returns to: the page, marked for its form. */
export function returnPath(path: string, blockId: string, result: "confirmed" | "expired"): string {
  const [pathname, query = ""] = path.split("#")[0].split("?");
  const params = new URLSearchParams(query);
  params.set("newsletter", result);
  params.set("form", blockId);
  return `${pathname}?${params.toString()}`;
}

/** A copy with every form's recipients taken out: Kaizen's saved parts, as stores' builders are offered them. */
export function withoutRecipients<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_key, part: unknown) =>
    part && typeof part === "object" && "type" in part && (part.type === "emailForm" || part.type === "newsletter")
      ? { ...part, recipients: [], ...(part.type === "newsletter" ? { incentive: undefined, tags: undefined } : {}) }
      : part,
  ) as T;
}
