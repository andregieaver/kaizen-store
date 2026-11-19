import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { after } from "next/server";

import { db } from "@/db/client";
import type { Answer } from "@/lib/forms";
import { homeMarket } from "@/lib/markets";
import { MESSAGE_MAX } from "@/lib/support-rules";

import { autonomyFor } from "./autopilot-settings";
import { log } from "./log";
import { getOpenStore } from "./stores";
import { addMessage, deskSettings } from "./support";
import { systemDesk } from "./support-desk";
import { answer, type InboundDeps } from "./support-inbound";
import { normaliseEmail } from "@/lib/email-address";

type Row = Record<string, unknown>;

/**
 * A store's email form's message in its support inbox (wave 11 unit C, D382): a conversation of source `form`, with the form's email
 * address as its contact, never tied to a customer by it. A person's answer goes back by email from the desk, as a conversation by email's
 * does (`sendReplyEmails()`), and a reply to that email continues it. Only while the desk is on and its `form_messages` is not `email`;
 * otherwise the form emails its recipients as before (D93).
 *
 * People answer it (no tone, summary, brief or partner reads it), unless the desk works AI first and its *form_ai* is on, or the store is
 * in the challenge (`docs/100-day-challenge.md` B2, D797): then it starts with the AI, which answers as an email's (`answer()`) once the
 * form's response is sent, by email to the form's address. It reads no orders by that address, which is only typed; a reply by email from
 * it lets the AI read that customer's orders as B1 (`emailCustomer()`). Without an email answer it stays with people; the database never
 * lets it go to the AI later.
 */

/** A form's message is cut into customer messages of the inbox's length, at most this many; a longer one is also emailed in full. */
const FORM_PARTS_MAX = 8;
const SUBJECT_MAX = 200;
const CONTACT_MAX = 254;
const PATH_MAX = 300;
const NAME_MAX = 120;

const newKey = () => Array.from(randomBytes(20), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

/** The answers as one text, each question over what was written, cut into parts the inbox keeps whole; `cut` when something was left out. */
export function formMessageParts(answers: readonly Answer[], max = MESSAGE_MAX.customer, parts = FORM_PARTS_MAX): { parts: string[]; cut: boolean } {
  const text = answers.map((a) => `${a.label}:\n${a.value}`).join("\n\n").trim();
  const out: string[] = [];
  let rest = text;
  while (rest.length > 0 && out.length < parts) {
    if (rest.length <= max) {
      out.push(rest);
      rest = "";
      break;
    }
    // At the last line break, else the last space, in the second half of the part; else exactly at the length.
    const window = rest.slice(0, max);
    const at = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const end = at >= max / 2 ? at : max;
    out.push(rest.slice(0, end).trimEnd());
    rest = rest.slice(end).trimStart();
  }
  return { parts: out.filter((p) => p.length > 0), cut: rest.length > 0 };
}

export type FormInbox =
  /** Kept in the inbox; `emailToo` when the form's recipients are emailed as well (the owner's choice, or the message was cut). */
  | { kept: true; conversationId: string; emailToo: boolean }
  /** Not for the inbox (Kaizena Flow's form, a desk that is off, `email`, a store not open): the recipients are emailed. */
  | { kept: false };

/**
 * Puts a form's message in the store's inbox. Never throws: a failure is logged and the form's recipients are emailed instead, so the
 * message is never lost.
 */
export async function formToInbox(
  storeId: string | null,
  /** `inbox` is the form's own choice (D705 F3: `email`, `inbox` or `both`); the desk's `form_messages` without one. */
  form: { blockId: string; subject: string; path: string; lang: string; inbox?: "email" | "inbox" | "both" },
  answers: readonly Answer[],
  /** The form's first email answer, and its name answer as typed: the conversation's contact, never proof of who wrote. */
  contact: { email: string | null; name: string | null },
  /** The AI's turn, for tests (`answer()`'s). */
  deps: Pick<InboundDeps, "turn"> = {},
): Promise<FormInbox> {
  if (!storeId) return { kept: false };
  try {
    const desk = systemDesk(storeId);
    const settings = await deskSettings(desk);
    const route = form.inbox ?? (settings?.formMessages === "email" ? "email" : settings?.formMessages === "inbox_and_email" ? "both" : "inbox");
    if (!settings || settings.mode === "off" || route === "email") return { kept: false };
    const [row] = await db().execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid and commerce.store_is_active(id)`);
    const store = row ? await getOpenStore(String(row.slug)) : null;
    if (!store) return { kept: false };
    // Answered in the visitor's language where the store has a market in it, else in its own country's.
    const market = store.markets.find((m) => m.lang === form.lang) ?? homeMarket(store);
    if (!market) return { kept: false };
    const { parts, cut } = formMessageParts(answers);
    if (parts.length === 0) return { kept: false };
    const email = contact.email && contact.email.length <= CONTACT_MAX ? normaliseEmail(contact.email) : null;
    const name = contact.name?.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) || null;
    const ai = Boolean(email) && settings.mode === "ai_first" && !settings.sensitive && (settings.formAi || (await autonomyFor(storeId)).challenge);
    const [created] = await db().execute<Row>(sql`
      insert into commerce.support_conversations (store_id, source, handler, market, locale, contact_email, contact_name, reply_key, email_subject, page_path)
      values (${storeId}::uuid, 'form', ${ai ? "ai" : "queue"}, ${market.slug}, ${market.locale.slice(0, 16)}, ${email}, ${name}, ${newKey()},
        ${form.subject.slice(0, SUBJECT_MAX)}, ${form.path.slice(0, PATH_MAX)})
      returning id
    `);
    const conversationId = String(created.id);
    for (const [n, part] of parts.entries()) {
      await addMessage(desk, conversationId, "customer", null, part, n === 0 ? { data: { form: { block: form.blockId, path: form.path, cut } } } : {});
    }
    // The AI's answer after the form's response, as an email's: a failure or a hand-over gives it to a person (`answer()`).
    if (ai && email) {
      const site = { kind: "store" as const, store, market };
      after(() => answer(desk, settings, site, conversationId, email, deps).catch((error) => log("error", "support.form_answer_failed", { storeId }, error)));
    }
    return { kept: true, conversationId, emailToo: route === "both" || cut };
  } catch (error) {
    log("error", "support.form_inbox_failed", { storeId }, error);
    return { kept: false };
  }
}
