import { renderEmail, type EmailBlock, type RenderedEmail } from "./email-layout";
import { emailText } from "./email-text";
import { isEmail } from "./forms";
import { moneyText, dayText, printLocale } from "./work-invoice-print";
import { documentLanguage } from "./work-invoice-text";

/**
 * The emails Work sends (docs/work.md 4.7, WP7b): an issued invoice, a credit
 * note and a payment reminder. Pure: the server (`src/server/work-emails.ts`)
 * reads the frozen document, and this turns it into the rendered email in the
 * document's own language (nb, sv, da or en; English for any other). Every
 * amount comes from the document as it was frozen, formatted with the
 * document's locale; nothing is worked out here. The email carries a link to
 * the hosted page, never the document itself (`sendEmail`'s attachments are
 * text only, so no PDF).
 */

/** What the frame of every Work email is made of. */
export type WorkEmailFrame = {
  storeName: string;
  /** Who the document is from: the seller's legal name as frozen, else the store's name. */
  sellerName: string;
  /** The hosted page's full address, or null when the store has no market to link to. */
  url: string | null;
  footer: string[];
};

export const MESSAGE_MAX = 2000;
export const WORK_EMAIL_KINDS = ["work.invoice", "work.credit_note", "work.reminder"] as const;

/** The path of the hosted page, inside a market's address (`marketPath()` puts the rest in front). */
export const hostedInvoicePath = (token: string, creditNoteId?: string | null): string =>
  `/account/invoice/${token}${creditNoteId ? `?credit=${creditNoteId}` : ""}`;

/** The token a hosted address may hold: as `findInvoiceByToken()` reads it. */
export const isInvoiceToken = (value: string): boolean => /^[A-Za-z0-9_-]{20,100}$/.test(value);

/** A message the person wrote to go on top of the email: trimmed, control characters out, at most `MESSAGE_MAX`. */
export function cleanMessage(value: string | null | undefined): string | null {
  const text = (value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  return text ? text.slice(0, MESSAGE_MAX) : null;
}

/** The message as paragraphs (blank lines separate them). */
export function messageBlocks(message: string | null): EmailBlock[] {
  return (message ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text) => ({ type: "paragraph" as const, text }));
}

export type EmailAddress = { ok: true; address: string } | { ok: false; reason: "no_email" | "invalid_email" };

/** The address to send to: what was chosen, else the first the document has; refused when it is not an email address. */
export function chooseAddress(...candidates: (string | null | undefined)[]): EmailAddress {
  const address = candidates.map((c) => c?.trim() ?? "").find((c) => c !== "");
  if (!address) return { ok: false, reason: "no_email" };
  return isEmail(address) ? { ok: true, address } : { ok: false, reason: "invalid_email" };
}

type InvoiceFacts = {
  documentNumber: string;
  dueOn: string | null;
  locale: string;
  currency: string;
  /** What is still to pay: the frozen total for a fresh invoice. */
  amountDueMinor: number;
};

const dueText = (facts: { dueOn: string | null; locale: string }): string | null =>
  facts.dueOn ? dayText(facts.dueOn, printLocale(facts.locale)) : null;

/** The invoice email: a plain statement, what is due and by when, and the link to the hosted page. */
export function invoiceEmail(frame: WorkEmailFrame, facts: InvoiceFacts, message: string | null): RenderedEmail {
  const lang = documentLanguage(facts.locale);
  const text = emailText(lang).work;
  const money = moneyText(facts.amountDueMinor, facts.currency, printLocale(facts.locale));
  const due = dueText(facts);
  return renderEmail({
    subject: text.invoiceSubject(frame.storeName, facts.documentNumber),
    preview: text.invoiceIntro(frame.sellerName),
    lang,
    footer: frame.footer,
    blocks: [
      { type: "heading", text: text.invoiceHeading(facts.documentNumber) },
      ...messageBlocks(message),
      { type: "paragraph", text: text.invoiceIntro(frame.sellerName) },
      {
        type: "lines",
        rows: [
          { label: text.invoiceAmount, value: money, strong: true },
          ...(due ? [{ label: text.invoiceDue, value: due }] : []),
        ],
      },
      ...(frame.url
        ? [
            { type: "button" as const, text: text.invoiceOpen, url: frame.url },
            { type: "paragraph" as const, text: text.invoiceHosted },
          ]
        : []),
    ],
  });
}

/** The credit note email: which invoice it corrects and for how much (as a positive amount, as the document states it). */
export function creditNoteEmail(
  frame: WorkEmailFrame,
  facts: { documentNumber: string; invoiceNumber: string; locale: string; currency: string; totalMinor: number },
  message: string | null,
): RenderedEmail {
  const lang = documentLanguage(facts.locale);
  const text = emailText(lang).work;
  return renderEmail({
    subject: text.creditSubject(frame.storeName, facts.documentNumber),
    preview: text.creditIntro(frame.sellerName, facts.invoiceNumber),
    lang,
    footer: frame.footer,
    blocks: [
      { type: "heading", text: text.creditHeading(facts.documentNumber) },
      ...messageBlocks(message),
      { type: "paragraph", text: text.creditIntro(frame.sellerName, facts.invoiceNumber) },
      {
        type: "lines",
        rows: [{ label: text.creditAmount, value: moneyText(facts.totalMinor, facts.currency, printLocale(facts.locale)), strong: true }],
      },
      ...(frame.url
        ? [
            { type: "button" as const, text: text.creditOpen, url: frame.url },
            { type: "paragraph" as const, text: text.invoiceHosted },
          ]
        : []),
    ],
  });
}

/** The reminder for an invoice that is still open: plain and factual, with what is outstanding and the link. */
export function reminderEmail(frame: WorkEmailFrame, facts: InvoiceFacts, message: string | null): RenderedEmail {
  const lang = documentLanguage(facts.locale);
  const text = emailText(lang).work;
  const due = dueText(facts) ?? "";
  return renderEmail({
    subject: text.reminderSubject(frame.storeName, facts.documentNumber),
    preview: text.reminderIntro(facts.documentNumber, due),
    lang,
    footer: frame.footer,
    blocks: [
      { type: "heading", text: text.reminderHeading },
      ...messageBlocks(message),
      { type: "paragraph", text: text.reminderIntro(facts.documentNumber, due) },
      {
        type: "lines",
        rows: [
          {
            label: text.reminderAmount,
            value: moneyText(facts.amountDueMinor, facts.currency, printLocale(facts.locale)),
            strong: true,
          },
        ],
      },
      ...(frame.url ? [{ type: "button" as const, text: text.invoiceOpen, url: frame.url }] : []),
    ],
  });
}
