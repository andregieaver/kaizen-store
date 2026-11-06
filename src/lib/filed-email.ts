import { bareAddress } from "./inbound-email";
import { pageText } from "./web-page-text";

/**
 * Email on the timeline (S5 of `docs/own-books-and-sales.md`, D476), pure: what a mail copied or forwarded to a store's filing address is
 * about. Its people are every address it was sent to, and, for a forwarded mail, the addresses in the forwarded headers (From, To, Cc, in
 * English and Norwegian), less the store's own team and the receiving domain; its words are kept whole, the forwarded part included.
 */

/** The longest text kept of a filed email. */
export const FILED_TEXT_MAX = 20_000;

/** A forwarded mail's header line: `From: Kari Nordmann <kari@example.com>`, `Fra:`, `To:`, `Til:`, `Cc:`, `Kopi:`. */
const HEADER_LINE = /^\s*(?:>\s*)*(?:\*\*)?(?:from|fra|to|til|cc|kopi|sendt fra)(?:\*\*)?\s*:\s*(.+)$/gim;
const ADDRESS = /[^\s<>(),;:"'[\]]+@[^\s<>(),;:"'[\]]+\.[a-z]{2,}/gi;

/** The addresses in a forwarded mail's header lines, lower case, in order of first appearance. */
export function forwardedAddresses(text: string): string[] {
  const found: string[] = [];
  for (const [, rest] of text.matchAll(HEADER_LINE)) {
    for (const [raw] of rest.matchAll(ADDRESS)) {
      const address = bareAddress(raw);
      if (address && !found.includes(address)) found.push(address);
    }
  }
  return found;
}

/**
 * The people a filed mail is about: its sender (when not the team), every address it went to, and those its forwarded headers name; less
 * the team's own addresses and anything at the receiving domain (the filing address itself).
 */
export function participantsOf(mail: { from: string; to: readonly string[]; cc: readonly string[]; text: string }, exclude: { team: ReadonlySet<string>; domain: string }): string[] {
  const all = [mail.from, ...mail.to, ...mail.cc].map((raw) => bareAddress(raw)).filter((a): a is string => !!a).concat(forwardedAddresses(mail.text));
  return [...new Set(all)].filter((a) => !exclude.team.has(a) && !a.endsWith(`@${exclude.domain}`));
}

/** A filed mail's words: its text part whole, or its HTML as text; cut to the most kept, saying whether it was. */
export function filedText(mail: { text: string | null; html: string | null }): { text: string; cut: boolean } {
  const raw = mail.text?.trim() ? mail.text : mail.html ? pageText(mail.html, "text/html", FILED_TEXT_MAX * 2).text : "";
  const text = raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > FILED_TEXT_MAX ? { text: text.slice(0, FILED_TEXT_MAX), cut: true } : { text, cut: false };
}
