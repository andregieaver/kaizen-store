import { createHash } from "node:crypto";

import { z } from "zod";

import { fillWords } from "./admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "./admin-lang";
import { staffEmailsEn, type StaffEmailsMessages } from "./admin-messages/staff-emails.en";
import { normaliseEmail } from "./email-address";
import { EMAIL_CHANGE_HOURS, NAME_MAX } from "./email-change-limits";
import type { EmailContent } from "./email-layout";
import type { RandomBytes } from "./recovery-codes";

/**
 * A person's own name and email (D836), pure: how a name is read, what a new address must be, the link's token and its hash, how an address
 * is shown half hidden, and the three emails of a change (the link to the new address, and the notices to the old one). The server decides
 * who may change what, and when (`src/server/email-change.ts`). Never import this from a "use client" file: it hashes with `node:crypto`.
 */

export { EMAIL_CHANGE_HOURS, NAME_MAX };

export type NameProblem = "empty" | "long";

/** A name as typed, kept as a person reads it: spaces around and in a row taken out, nothing that is not printed; never empty, at most `NAME_MAX`. */
export function cleanName(raw: unknown): { ok: true; name: string } | { ok: false; problem: NameProblem } {
  const name = String(raw ?? "")
    // Control characters (a line break pasted in, a tab) are never part of a name.
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (name === "") return { ok: false, problem: "empty" };
  if ([...name].length > NAME_MAX) return { ok: false, problem: "long" };
  return { ok: true, name };
}

export type AddressProblem = "invalid" | "same";

const ADDRESS = z.email().max(254);

/** A new address as the accounts keep it (`normaliseEmail()`), or why it cannot be one: not an address, or the one the account has. */
export function newAddress(raw: unknown, current: string): { ok: true; email: string } | { ok: false; problem: AddressProblem } {
  const email = normaliseEmail(String(raw ?? ""));
  if (!ADDRESS.safeParse(email).success) return { ok: false, problem: "invalid" };
  if (email === normaliseEmail(current)) return { ok: false, problem: "same" };
  return { ok: true, email };
}

/** `a•••@example.com`: enough for the person to know their address, and nothing more for anyone who reads the old address's mail. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${address.slice(0, 1)}•••${address.slice(at)}`;
}

/** The link's token: 32 random bytes as base64url, 43 characters. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The SHA-256 the table keeps: the token is 256 random bits, so a plain hash cannot be walked back. */
const hashOf = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/** A new link's token (sent, never kept) and its hash (kept). Randomness is given in, so a test can hold it. */
export function makeEmailChangeToken(random: RandomBytes): { token: string; hash: string } {
  const bytes = random(32);
  if (bytes.length < 32) throw new Error("an email change's token needs 32 random bytes");
  const token = Buffer.from(bytes.subarray(0, 32)).toString("base64url");
  return { token, hash: hashOf(token) };
}

/** The hash to look a link up by, or null when what came cannot be a token (so nothing is asked of the database). */
export function emailChangeTokenHash(token: unknown): string | null {
  return typeof token === "string" && TOKEN.test(token) ? hashOf(token) : null;
}

/** Whether a link still works at `now`: not used, and before its end. */
export const linkWorks = (change: { expiresAt: string | Date; usedAt: string | Date | null }, now: Date): boolean =>
  change.usedAt === null && new Date(change.expiresAt).getTime() > now.getTime();

export type EmailChangeEmailKind = "confirm" | "requested" | "changed";

export type EmailChangeFacts = {
  /** The person's name or current email, for the greeting. */
  person: string;
  /** The new address: whole in the link's email, half hidden (`maskEmail()`) in the notices to the old address. */
  email: string;
  /** When it happened, as the reader reads it (`2026-10-03 14:05 UTC`). */
  when: string;
  /** A platform admin asked for it, for the person. */
  byAdmin: boolean;
  /** The link (the confirmation page with its token) or, for the notices, the sign-in page. */
  url: string;
};

/** One of a change's three emails, from the `staffEmails` catalogue in the account's admin language (D312 A10); none signs anyone in. */
export function emailChangeEmail(kind: EmailChangeEmailKind, facts: EmailChangeFacts, words: StaffEmailsMessages = staffEmailsEn, lang: AdminLang = "en"): EmailContent {
  const w = words.emailChange;
  const values = { email: facts.email, when: facts.when, hours: EMAIL_CHANGE_HOURS };
  const head = { lang: ADMIN_LANG_FACTS[lang].tag, footer: [words.footer] };
  const hello = { type: "paragraph" as const, text: fillWords(w.hello, { person: facts.person }) };
  if (kind === "confirm") {
    return {
      ...head,
      subject: w.confirm.subject,
      preview: w.confirm.subject,
      blocks: [
        { type: "heading", text: w.confirm.subject },
        hello,
        { type: "paragraph", text: fillWords(facts.byAdmin ? w.confirm.introByAdmin : w.confirm.intro, values) },
        { type: "button", text: w.confirm.button, url: facts.url },
        { type: "paragraph", text: fillWords(w.confirm.expires, values) },
        { type: "paragraph", text: w.confirm.ignore },
      ],
    };
  }
  const t = kind === "requested" ? w.requested : w.changed;
  const intro = kind === "requested" && facts.byAdmin ? w.requested.introByAdmin : t.intro;
  return {
    ...head,
    subject: t.subject,
    preview: t.subject,
    blocks: [
      { type: "heading", text: t.subject },
      hello,
      { type: "paragraph", text: fillWords(intro, values) },
      { type: "paragraph", text: t.notYou },
      { type: "button", text: words.security.signIn, url: facts.url },
    ],
  };
}
