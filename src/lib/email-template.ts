/**
 * A store's own words for a notification (wave 3, D238, `docs/wave-3-notifications.md` 4.2): three slots per notification and language (the subject,
 * the heading and one text block, the intro), named placeholders only. Pure and free of server modules and zod: the editor runs `templateProblems()` in
 * the browser as the owner types, and `saveTemplate()` runs it again before anything is kept.
 *
 * A template replaces exactly the `subject`, `heading` and `intro` the email's builder already makes (`orderNotice()`, `returnMail()`,
 * `sendOrderConfirmation()`, the parcel emails), through `withTemplate()`; every other block (lines, totals, VAT statement, documents, the withdrawal
 * block, tracking, pickup details, links) stays the code's. Owner text is never HTML: every slot is text the renderer escapes.
 */
import { findClaims, CLAIM_LABELS, type ClaimKind } from "./claims";
import { notificationOf, type PlaceholderName } from "./notifications";
import { fillNamed } from "./placeholder-fill";

export const TEMPLATE_SLOTS = ["subject", "heading", "body"] as const;
export type TemplateSlot = (typeof TEMPLATE_SLOTS)[number];

/** Characters typed per slot (also the database's checks on `email_templates`). */
export const SLOT_LIMITS: Record<TemplateSlot, number> = { subject: 150, heading: 120, body: 2000 };
/** Lines of the text block at most. */
export const BODY_LINES_MAX = 20;
/** A filled subject is cut to this many characters (a long store name or number). */
export const FILLED_SUBJECT_MAX = 200;
/** The mail app's preview line: the filled text's first characters. */
export const PREVIEW_CHARS = 140;

/** What a template holds; a missing or null slot is the standard text. */
export type EmailTemplate = Partial<Record<TemplateSlot, string | null>>;

/** What each placeholder becomes, for the chips beside the editor. */
export const PLACEHOLDERS: Record<PlaceholderName, { label: string }> = {
  store_name: { label: "The store's name" },
  order_number: { label: "The order's number" },
  customer_first_name: { label: "The customer's first name (left out when it is not known)" },
  order_total: { label: "The order's total, in its own currency" },
  carrier: { label: "The carrier's name" },
  tracking_number: { label: "The parcel's tracking number" },
  refund_amount: { label: "The amount refunded, in the order's currency" },
  return_number: { label: "The return's number" },
  pickup_place: { label: "The place to collect from" },
  change_number: { label: "The change's number" },
};

/** The values of a notification's placeholders for one email; null where it is not known. Money is already formatted in the order's currency. */
export type PlaceholderValues = Partial<Record<PlaceholderName, string | null>>;

export type TemplateProblemCode =
  | "unknown_placeholder"
  | "stray_brace"
  | "address"
  | "too_long"
  | "too_many_lines"
  | "empty_after_fill"
  | "claim"
  | "control";

export type TemplateProblem = {
  slot: TemplateSlot;
  code: TemplateProblemCode;
  /** The placeholder, the phrase or the address it is about, when there is one. */
  detail?: string;
  /** A claim's kind (`findClaims()`). */
  claim?: ClaimKind;
  message: string;
};

const SLOT_WORDS: Record<TemplateSlot, string> = { subject: "The subject", heading: "The heading", body: "The text" };

/** Line breaks as `\n`, and no space at the ends; a slot that is only space is empty. */
export function cleanSlot(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = value.replace(/\r\n?/g, "\n").trim();
  return text === "" ? null : text;
}

const PLACEHOLDER = /\{([a-z_]+)\}/g;
/**
 * A web address in a store's text (4.2). Mail apps (Gmail, Outlook, Apple Mail) make any bare domain a link, whatever its top-level domain, so the
 * check is the shape, never a list of domains: a word of letters, digits and hyphens, then one or more more after a dot, the last of two or more
 * letters (any script, so an IDN top-level domain too) or punycode (`xn--…`), with an optional path. The ideographic and fullwidth full stops
 * (U+3002, U+FF0E, U+FF61), which browsers read as dots in a host, count as dots. A few dotted abbreviations of the four languages are no address.
 */
const DOT = String.raw`[.\u3002\uff0e\uff61]`;
const ADDRESS = new RegExp(
  String.raw`(?:https?:\/\/\S+|www${DOT}\S+|(?<![\p{L}\p{N}@.\u3002\uff0e\uff61-])[\p{L}\p{N}][\p{L}\p{N}-]*(?:${DOT}[\p{L}\p{N}][\p{L}\p{N}-]*)*${DOT}(?:\p{L}{2,}|xn--[a-z0-9-]+)(?![\p{L}\p{N}])(?:\/\S*)?)`,
  "giu",
);
/** Dotted abbreviations whose last part reads like a top-level domain (nb/da *f.eks.*, sv *t.ex.*, *m.fl.*): words, not addresses. */
const ABBREVIATIONS = new Set(["f.eks", "t.eks", "t.ex", "f.ex", "m.fl", "e.g", "i.e"]);
const isAbbreviation = (word: string) => ABBREVIATIONS.has(word.toLowerCase());
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200d\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;

/** The text with every placeholder taken out (what the claims filter and the emptiness test read). */
const withoutPlaceholders = (text: string) => text.replace(PLACEHOLDER, " ");

/**
 * What is wrong with a template for a notification, slot by slot (4.2). Each problem refuses the save; an empty slot is no problem (it is the standard
 * text). A notification that cannot be edited (the withdrawal acknowledgement) refuses every slot.
 */
export function templateProblems(template: EmailTemplate, notificationId: string): TemplateProblem[] {
  const notification = notificationOf(notificationId);
  const allowed = new Set<string>(notification?.placeholders ?? []);
  const problems: TemplateProblem[] = [];
  for (const slot of TEMPLATE_SLOTS) {
    const text = cleanSlot(template[slot]);
    if (text === null) continue;
    const add = (code: TemplateProblemCode, message: string, more: Partial<TemplateProblem> = {}) => problems.push({ slot, code, message, ...more });
    if (!notification || !notification.editable) {
      add("unknown_placeholder", "This email cannot be changed.");
      continue;
    }
    const length = [...text].length;
    if (length > SLOT_LIMITS[slot]) add("too_long", `${SLOT_WORDS[slot]} is ${length} characters long; at most ${SLOT_LIMITS[slot]}.`);
    const lines = text.split("\n");
    if (slot !== "body" && lines.length > 1) add("too_many_lines", `${SLOT_WORDS[slot]} must be one line.`);
    if (slot === "body" && lines.length > BODY_LINES_MAX) add("too_many_lines", `The text has ${lines.length} lines; at most ${BODY_LINES_MAX}.`);
    if (CONTROL.test(text)) add("control", `${SLOT_WORDS[slot]} holds a character that cannot be shown. Type it again.`);
    const unknown = new Set<string>();
    for (const match of text.matchAll(PLACEHOLDER)) if (!allowed.has(match[1])) unknown.add(match[1]);
    for (const name of unknown) add("unknown_placeholder", `{${name}} is not a placeholder of this email.`, { detail: `{${name}}` });
    const rest = text.replace(PLACEHOLDER, "");
    if (/[{}]/.test(rest)) add("stray_brace", `${SLOT_WORDS[slot]} has a { or } that is not part of a placeholder. Placeholders are written {name}.`);
    const bare = withoutPlaceholders(text);
    for (const match of bare.matchAll(ADDRESS)) {
      if (isAbbreviation(match[0])) continue;
      add("address", `${SLOT_WORDS[slot]} holds a web address (${match[0]}). Links are added by Kaizen as buttons; leave addresses out.`, { detail: match[0] });
    }
    if (slot !== "body" && fillNamed(text, Object.fromEntries([...allowed].map((n) => [n, null])), { dropBareLines: true }).replace(/[\s\p{P}]/gu, "") === "") {
      add("empty_after_fill", `${SLOT_WORDS[slot]} would be empty when its placeholders have no value. Add some words.`);
    }
    for (const claim of findClaims(bare)) {
      add("claim", `${SLOT_WORDS[slot]} says "${claim.phrase}": ${CLAIM_LABELS[claim.kind].toLowerCase()}. Order emails state facts; offers and claims are marketing.`, {
        detail: claim.phrase,
        claim: claim.kind,
      });
    }
  }
  return problems;
}

/** A slot's text with its placeholders filled (4.2); a line left with only punctuation goes. */
export function fillTemplate(text: string, values: PlaceholderValues): string {
  return fillNamed(text, values as Record<string, string | null | undefined>, { dropBareLines: true });
}

/** What an email's builder made (the fixed text, already filled by code). */
export type BuiltSlots = { subject: string; heading: string; intro: string; preview?: string };

export type TemplatedSlots = {
  subject: string;
  heading: string;
  intro: string;
  preview: string;
  /** Which slots came from the store's template. */
  fromTemplate: Record<TemplateSlot, boolean>;
};

/** One line, ordinary spaces only: a no-break space inside a formatted amount ("646,00 €") stays. */
const oneLine = (text: string) => text.replace(/[ \t\r\n]+/g, " ").trim();
const cut = (text: string, max: number) => {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : text;
};

/**
 * The email's subject, heading and intro: per slot the store's template when it has that slot and it passes `templateProblems()` now, else the fixed
 * text the builder made (4.2: never another language's template; the caller passes the template of the order's language). A filled slot that comes out
 * empty gives way to the fixed text too.
 */
export function withTemplate(built: BuiltSlots, template: EmailTemplate | null | undefined, notificationId: string, values: PlaceholderValues): TemplatedSlots {
  const problems = template ? templateProblems(template, notificationId) : [];
  const usable = (slot: TemplateSlot): string | null => {
    const text = cleanSlot(template?.[slot]);
    if (text === null || problems.some((p) => p.slot === slot)) return null;
    const filled = fillTemplate(text, values).trim();
    return filled === "" ? null : filled;
  };
  const subject = usable("subject");
  const heading = usable("heading");
  const body = usable("body");
  return {
    subject: subject ? cut(oneLine(subject), FILLED_SUBJECT_MAX) : built.subject,
    heading: heading ? oneLine(heading) : built.heading,
    intro: body ?? built.intro,
    preview: body ? cut(oneLine(body), PREVIEW_CHARS) : (built.preview ?? built.intro),
    fromTemplate: { subject: subject !== null, heading: heading !== null, body: body !== null },
  };
}

/** The slots a template has (for the list's *Your text*), and whether it has any. */
export const filledSlots = (template: EmailTemplate | null | undefined): TemplateSlot[] =>
  TEMPLATE_SLOTS.filter((slot) => cleanSlot(template?.[slot]) !== null);
