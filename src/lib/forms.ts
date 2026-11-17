import type { BrowserMessages } from "./browser-text";

/** The texts the form functions read: only `form` as the browser has it (`browserText()`, D212); the server's `t()` has more. */
type FormTexts = Pick<BrowserMessages, "form">;
import type { EmailFormBlock, FormField, FormFieldKind, NewsletterBlock, ShowWhen } from "./page-content";
import { OPTION_FIELD_KINDS, dateAnswer, numberAnswer } from "./questions";
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

/** The option places a choice's answer names: one place for a dropdown or radio buttons, any for a tick list (`0,2`). */
export function chosenPlaces(field: Pick<FormField, "kind" | "options">, raw: string | boolean | undefined): number[] {
  if (typeof raw !== "string" || raw === "") return [];
  const count = field.options?.length ?? 0;
  const places = raw.split(",").map((p) => (/^\d{1,2}$/.test(p) ? Number(p) : -1));
  if (places.some((p) => p < 0 || p >= count)) return [];
  const unique = [...new Set(places)].sort((a, b) => a - b);
  return field.kind === "checklist" ? unique : unique.slice(0, 1);
}

/**
 * A hidden field's answer (D738 F6a): the value of `param` in the address's query (`/kampanje?utm_campaign=vinter`), one line of at most
 * 300 characters, or null. A query that cannot be read reads as none.
 */
export function fromAddress(address: string, param: string | undefined): string | null {
  if (!param) return null;
  const query = address.split("#")[0].split("?").slice(1).join("?");
  if (!query) return null;
  let value: string | null;
  try {
    value = new URLSearchParams(query).get(param);
  } catch {
    return null;
  }
  const text = value === null ? "" : line(value).slice(0, LINE_MAX);
  return text === "" ? null : text;
}

/** Questions the visitor sees: every one asked but a hidden field (D738), whose answer comes from the address. */
export const askedQuestions = (fields: readonly FormField[], values: FormRequest["values"]) => shownQuestions(fields, values).filter((f) => f.kind !== "hidden");

/** Whether one question's answer holds a condition (`showWhen`, D705 F3). */
function holds(target: FormField, raw: string | boolean | undefined, c: ShowWhen): boolean {
  const chosen = OPTION_FIELD_KINDS.includes(target.kind) ? chosenPlaces(target, raw) : [];
  switch (c.op) {
    case "answered":
      return typeof raw === "string" ? raw.trim() !== "" : raw === true;
    case "ticked":
      return target.kind === "checklist" ? chosen.length > 0 : raw === true;
    case "is":
    case "any_of":
      return chosen.some((p) => (c.values ?? []).includes(p));
    case "is_not":
      return !chosen.some((p) => (c.values ?? []).includes(p));
  }
}

/**
 * The questions asked, given the answers so far: one with conditions only while every one holds, each against a question above it that is
 * itself asked (a hidden question counts as unanswered). The browser shows these and the server checks only these, so they agree.
 */
export function shownQuestions(fields: readonly FormField[], values: FormRequest["values"]): FormField[] {
  const asked = new Map<string, FormField>();
  for (const field of fields) {
    const ok = (field.showWhen ?? []).every((c) => {
      const target = asked.get(c.question);
      return target !== undefined && holds(target, values[target.id], c);
    });
    if (ok) asked.set(field.id, field);
  }
  return [...asked.values()];
}

/**
 * A message checked against the form's questions. Errors are in the
 * visitor's language (`visitor`), by question id (and `consent`);
 * the answers are labelled in the owner's (`owner`), as the form was
 * written, choices by their place in the list. A question not asked
 * (its conditions do not hold, D705 F3) is neither checked nor sent. A
 * date's earliest and latest day count from `today` (the owner's on the
 * server, the visitor's in the browser). A hidden field (D738 F6a) is
 * answered from `address`, the page's path with its query, as it was sent:
 * never an error, and left out when the address does not have it.
 */
export function checkMessage(
  block: Pick<EmailFormBlock, "fields" | "consent">,
  values: FormRequest["values"],
  consent: boolean,
  visitor: FormTexts,
  owner: FormTexts,
  today?: string,
  address = "",
): CheckedMessage {
  const errors: FormErrors = {};
  const answers: Answer[] = [];
  let replyTo: string | null = null;
  for (const field of shownQuestions(block.fields, values)) {
    const raw = values[field.id];
    const label = fieldLabel(field, owner);
    if (field.kind === "hidden") {
      const value = fromAddress(address, field.param);
      if (value) answers.push({ label, value });
      continue;
    }
    if (field.kind === "file") {
      // A file's answer is its name (D738 F6b): the browser sends the name it chose, the server the name of the file it took and checked.
      const name = typeof raw === "string" ? line(raw).slice(0, LINE_MAX) : "";
      if (name === "") {
        if (field.required) errors[field.id] = visitor.form.fileNeeded;
        continue;
      }
      answers.push({ label, value: name });
      continue;
    }
    if (field.kind === "checkbox") {
      const ticked = raw === true;
      if (field.required && !ticked) errors[field.id] = visitor.form.consentNeeded;
      answers.push({ label, value: ticked ? owner.form.yes : owner.form.no });
      continue;
    }
    if (OPTION_FIELD_KINDS.includes(field.kind)) {
      // The browser sends the choices' places: their words may be in another language.
      const chosen = chosenPlaces(field, raw);
      if (chosen.length === 0) {
        if (field.required || (typeof raw === "string" && raw !== "")) errors[field.id] = field.kind === "checklist" ? visitor.form.chooseSome : visitor.form.required;
        continue;
      }
      answers.push({ label, value: chosen.map((p) => field.options![p]).join(", ") });
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
    if (field.kind === "number") {
      const n = numberAnswer(text, { min: field.min, max: field.max });
      if (n === null) {
        errors[field.id] = visitor.form.invalidNumber;
        continue;
      }
      answers.push({ label, value: n });
      continue;
    }
    if (field.kind === "date") {
      const day = dateAnswer(text, { min: field.min, max: field.max }, today);
      if (day === null) {
        errors[field.id] = visitor.form.invalidDate;
        continue;
      }
      answers.push({ label, value: day });
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
