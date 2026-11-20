import { fillWords } from "./admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "./admin-lang";
import type { StaffEmailsMessages } from "./admin-messages/staff-emails.en";
import { dateIn } from "./dates";
import type { EmailContent } from "./email-layout";

/**
 * The sending guard (D730, step M1.6 of `docs/audits/email-marketing-2026-11.md`), pure: whether a store's recent marketing email passed
 * the line, and the email that tells its owners. Every store sent from one shared address until it had its own domain (D727), so one store's
 * bought list could put every store's mail in spam; the guard holds that store's broadcasts and automations before it does.
 */

/** Below this many marketing emails in the window nothing is judged: a handful of bounces in a small send says little. */
export const GUARD_MIN_SENT = 100;
/** Hard and soft bounces per email sent at which marketing email pauses. */
export const PAUSE_BOUNCE_RATE = 0.05;
/** Spam reports per email sent at which it pauses: Google asks bulk senders never to reach 0.3 %. */
export const PAUSE_COMPLAINT_RATE = 0.003;
/** The rates at which the owner is warned on the Marketing page, before a pause: Google asks to stay under 0.1 % spam reports. */
export const WARN_BOUNCE_RATE = 0.02;
export const WARN_COMPLAINT_RATE = 0.001;
/** How far back the guard looks (and no further back than the last resume). */
export const GUARD_WINDOW_DAYS = 7;

export type GuardCounts = { sent: number; bounced: number; complained: number };
export type GuardReason = "bounces" | "complaints";
export type GuardVerdict = { level: "ok" } | { level: "warn" | "pause"; reason: GuardReason };

/** What the counts say: a pause when either line is passed (complaints first, as they hurt most), a warning near it, else nothing. */
export function guardVerdict(c: GuardCounts): GuardVerdict {
  if (c.sent < GUARD_MIN_SENT) return { level: "ok" };
  const bounce = c.bounced / c.sent;
  const complaint = c.complained / c.sent;
  if (complaint >= PAUSE_COMPLAINT_RATE) return { level: "pause", reason: "complaints" };
  if (bounce >= PAUSE_BOUNCE_RATE) return { level: "pause", reason: "bounces" };
  if (complaint >= WARN_COMPLAINT_RATE) return { level: "warn", reason: "complaints" };
  if (bounce >= WARN_BOUNCE_RATE) return { level: "warn", reason: "bounces" };
  return { level: "ok" };
}

/** A share as the owner reads it: `5.2 %`, `0.31 %` (`0,31 %` in Norwegian). */
export function shareText(part: number, whole: number, locale = "en-GB"): string {
  if (whole <= 0) return "0 %";
  const pct = (part / whole) * 100;
  return `${pct.toLocaleString(locale, { maximumFractionDigits: pct < 1 ? 2 : 1 })} %`;
}

/** `timeZone` is the store's, which the day the guard counts from is read in (D796). */
export type PausedFacts = { storeName: string; timeZone: string; reason: GuardReason; counts: GuardCounts; since: Date; url: string };

/** The email to a store's owners when the guard pauses its marketing email, in their admin language. */
export function pausedEmail(facts: PausedFacts, words: StaffEmailsMessages, lang: AdminLang = "en"): EmailContent {
  const w = words.sendingPaused;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const n = (v: number) => v.toLocaleString(locale);
  const values = {
    store: facts.storeName,
    sent: n(facts.counts.sent),
    bounced: n(facts.counts.bounced),
    complained: n(facts.counts.complained),
    since: dateIn(facts.timeZone, facts.since, "long", lang),
    rate: shareText(facts.reason === "bounces" ? facts.counts.bounced : facts.counts.complained, facts.counts.sent, locale),
  };
  return {
    subject: fillWords(w.subject, { store: facts.storeName }),
    preview: fillWords(w.preview, { what: facts.reason === "bounces" ? w.whatBounces : w.whatComplaints }),
    lang: ADMIN_LANG_FACTS[lang].tag,
    footer: [facts.storeName, words.footer],
    blocks: [
      { type: "heading", text: w.heading },
      { type: "paragraph", text: fillWords(facts.reason === "bounces" ? w.bounces : w.complaints, values) },
      { type: "paragraph", text: w.held },
      { type: "paragraph", text: w.advice },
      { type: "button", text: w.button, url: facts.url },
    ],
  };
}
