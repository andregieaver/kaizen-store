import { MESSAGE_MAX } from "./support-rules";
import { pageText } from "./web-page-text";

/**
 * Email into the support desk (D332, `docs/support.md` step 16). Pure: where an email is for (a desk's address or a conversation's
 * reply address at the receiving domain), whether it was sent by a machine, and the customer's own words of it (the quoted history
 * and signature cut). `src/server/support-inbound.ts` fetches, checks and adds it.
 */

/** One address may write to one desk this often in an hour; past it its emails are refused. */
export const INBOUND_PER_SENDER_HOUR = 10;
/** A desk takes at most this many emails a day. */
export const INBOUND_PER_DESK_DAY = 500;
/** Tries of one email before it is `failed`. */
export const INBOUND_TRIES = 3;
/** An email Resend refused to give us with our key (401, 403) is tried again this often, so it is read once the key is fixed. */
export const KEY_RETRY_MINUTES = 30;
/** How long a run holds an email before another may take it. */
export const INBOUND_CLAIM_MINUTES = 5;
/** Received emails' rows (the sender and the subject) are kept this long. */
export const INBOUND_KEEP_DAYS = 30;
/** An answer by email goes once the newest of its messages is this old, so a person's quick messages go together. */
export const EMAIL_SETTLE_SECONDS = 30;
/** Answer emails a conversation by email may get in all. */
export const EMAIL_CHANNEL_MAX = 60;
export const SUBJECT_MAX = 200;
export const MESSAGE_ID_MAX = 998;

/** A random key of an address: lower-case letters and digits, as the database's checks hold it. */
export const ADDRESS_KEY = /^[a-z0-9]{12,32}$/;

export const deskAddress = (key: string, domain: string) => `desk-${key}@${domain}`;
export const replyAddress = (key: string, domain: string) => `reply-${key}@${domain}`;

/** The receiving domain as set (lower case, no `@`), or null when receiving is not set up. */
export function inboundDomain(raw: string | undefined): string | null {
  const domain = raw?.trim().toLowerCase().replace(/^@/, "");
  return domain && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

/** An address's bare form, lower case: `"Kari" <Kari@Example.com>` → `kari@example.com`; null when it is not one. */
export function bareAddress(raw: string): string | null {
  const inner = raw.match(/<([^<>]+)>\s*$/)?.[1] ?? raw;
  const address = inner.trim().toLowerCase();
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(address) && address.length <= 320 ? address : null;
}

/** The display name of an address (`"Kari Nordmann" <kari@…>` → `Kari Nordmann`), or null. */
export function displayName(raw: string): string | null {
  const name = raw.match(/^\s*"?([^"<]*?)"?\s*</)?.[1]?.trim();
  return name ? name.slice(0, 120) : null;
}

export type Route = { kind: "desk"; key: string } | { kind: "reply"; key: string };

/** Where an email is for: the first of its addresses at the receiving domain that is a desk's or a reply address, else null. */
export function routeOf(addresses: readonly string[], domain: string): Route | null {
  for (const raw of addresses) {
    const address = bareAddress(raw);
    if (!address) continue;
    const [local, host] = [address.slice(0, address.lastIndexOf("@")), address.slice(address.lastIndexOf("@") + 1)];
    if (host !== domain) continue;
    const match = local.match(/^(desk|reply)-([a-z0-9]{12,32})$/);
    if (match) return { kind: match[1] as Route["kind"], key: match[2] };
  }
  return null;
}

export type Headers = Readonly<Record<string, string | string[] | undefined>>;

const header = (headers: Headers, name: string): string => {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  const value = key ? headers[key] : undefined;
  return (Array.isArray(value) ? value.join(", ") : (value ?? "")).trim();
};

/** Header values a reply threads by. */
export const headerOf = header;

const MACHINE_SENDERS = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounces?|notifications?)([+.-].*)?@/;

/** Why an email was sent by a machine (an auto-reply, a bounce, a list), or null when a person sent it. */
export function automated(from: string, headers: Headers, ownSender: string | null): string | null {
  const auto = header(headers, "auto-submitted").toLowerCase();
  if (auto && auto !== "no") return "auto_submitted";
  if (/^(bulk|junk|list|auto_reply)$/i.test(header(headers, "precedence"))) return "bulk";
  if (header(headers, "list-id") || header(headers, "list-unsubscribe")) return "list";
  if (header(headers, "x-autoreply") || header(headers, "x-autorespond")) return "auto_submitted";
  const sender = bareAddress(from) ?? "";
  if (MACHINE_SENDERS.test(sender)) return "machine_sender";
  if (ownSender && sender === ownSender.toLowerCase()) return "own_sender";
  return null;
}

/** Lines that start a reply's quoted history: "On … wrote:" and its kin in the languages Kaizena Flow writes and those near them. */
const QUOTE_INTROS = [
  /^on .+ wrote:\s*$/i,
  /^den .+ skrev .+:\s*$/i,
  /^.+ skrev\s*(følgende)?:\s*$/i,
  /^am .+ schrieb .+:\s*$/i,
  /^le .+ a écrit\s*:\s*$/i,
  /^-{2,}\s*(original message|opprinnelig melding|ursprungligt meddelande|oprindelig meddelelse|ursprüngliche nachricht)\s*-{2,}\s*$/i,
  /^-{2,}\s*(forwarded message|videresendt melding|vidarebefordrat meddelande|videresendt meddelelse)\s*-{2,}\s*$/i,
  /^_{10,}\s*$/,
];

/** A header block of a quoted email, as clients write it: "From: …" with "Sent:"/"Date:" or "Subject:" below. */
const QUOTED_HEADER = /^(from|fra|från|von|de)\s*:/i;
const QUOTED_HEADER_NEXT = /^(sent|sendt|skickat|gesendet|envoyé|date|dato|datum|to|til|till|an|à|subject|emne|ämne|betreff|objet)\s*:/i;

/**
 * The customer's own words of a reply: the quoted history (lines starting with `>`, an "On … wrote:" line and all below it, a quoted
 * header block) and the signature (`-- `) cut, blank runs closed. Never empties a message that is only quote: then the quote stays.
 */
export function replyOnly(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "--" || line === "-- ") break;
    if (QUOTE_INTROS.some((re) => re.test(trimmed))) break;
    // A line wrapped by the client: "On Mon, 3 Mar 2026 at 10:00, Kari" / "<kari@example.com> wrote:".
    if (/^on .+/i.test(trimmed) && /wrote:\s*$/i.test(lines[i + 1]?.trim() ?? "")) break;
    if (QUOTED_HEADER.test(trimmed) && QUOTED_HEADER_NEXT.test(lines[i + 1]?.trim() ?? "")) break;
    if (trimmed.startsWith(">")) continue;
    kept.push(line);
  }
  const words = kept.join("\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return words || text.replace(/^>\s?/gm, "").trim();
}

/** The email's words as a customer message: the text part, else the HTML as text; the reply alone; the subject first in a new conversation. */
export function messageOf(email: { text: string | null; html: string | null; subject: string | null }, opts: { withSubject: boolean }): { body: string; cut: boolean } {
  const raw = email.text?.trim() ? email.text : email.html ? pageText(email.html, "text/html", 20_000).text : "";
  const words = replyOnly(raw);
  const subject = cleanSubject(email.subject);
  const full = opts.withSubject && subject ? (words ? `${subject}\n\n${words}` : subject) : words;
  const max = MESSAGE_MAX.customer;
  if (full.length <= max) return { body: full, cut: false };
  return { body: `${full.slice(0, max - 2).trimEnd()} …`, cut: true };
}

/** A subject as kept: one line, without `Re:`/`Sv:`/`Aw:`/`Fwd:` prefixes, at most `SUBJECT_MAX` characters; null when empty. */
export function cleanSubject(subject: string | null | undefined): string | null {
  const one = (subject ?? "").replace(/\s+/g, " ").trim().replace(/^((re|sv|aw|vs|fw|fwd|vb|wg|tr)\s*:\s*)+/i, "").trim();
  return one ? one.slice(0, SUBJECT_MAX) : null;
}

/** The subject of an answer: `Re: {subject}`, or the given fallback when the conversation has none. */
export const answerSubject = (subject: string | null, fallback: string) => (subject ? `Re: ${subject}`.slice(0, SUBJECT_MAX + 4) : fallback);

/** A Message-ID as a header carries it (`<…>`), or null when it is not one. */
export function messageIdOf(raw: string | null | undefined): string | null {
  const id = (raw ?? "").trim();
  if (!id || id.length > MESSAGE_ID_MAX || /[\r\n]/.test(id)) return null;
  return id.startsWith("<") ? id : `<${id}>`;
}
