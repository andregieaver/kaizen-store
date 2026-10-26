import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { after } from "next/server";

import { db } from "@/db/client";
import { emailSettings } from "@/lib/email-settings";
import {
  ADDRESS_KEY,
  INBOUND_CLAIM_MINUTES,
  INBOUND_KEEP_DAYS,
  INBOUND_PER_DESK_DAY,
  INBOUND_PER_SENDER_HOUR,
  INBOUND_TRIES,
  automated,
  bareAddress,
  cleanSubject,
  deskAddress,
  displayName,
  headerOf,
  inboundDomain,
  messageIdOf,
  messageOf,
  routeOf,
  type Headers,
} from "@/lib/inbound-email";
import { homeMarket } from "@/lib/markets";
import { NO_SIGNALS } from "@/lib/recommendations";
import { CONVERSATION_MESSAGES_MAX, REOPEN_HOURS } from "@/lib/support-rules";

import { takeChatTurn, type ChatSite } from "./chat-agent";
import { chatContext, type ChatPlace } from "./chat-route";
import { log } from "./log";
import { getOpenStore } from "./stores";
import { SupportError, addMessage, deskSettings, transition, type DeskSettings } from "./support";
import { systemDesk, type Desk } from "./support-desk";
import { handOver } from "./support-route";
import { scoreTone, scoresTone } from "./support-tone";
import { runSupportTurn } from "./support-turn";

type Row = Record<string, unknown>;

/**
 * Email into the support desk (D332, `docs/support.md` step 16). Resend receives mail for `SUPPORT_INBOUND_DOMAIN` and tells
 * `/api/resend/webhook` (`email.received`, metadata only); `receiveInboundEvent()` keeps a row and processes it after the answer,
 * and `processInboundEmails()` (every minute) takes what is left, `INBOUND_TRIES` tries each. An email to a desk's address
 * (`desk-{key}@…`) starts a conversation by email; one to a conversation's reply address (`reply-{key}@…`) continues it when it
 * comes from the conversation's own address. The email's words are fetched from Resend, checked (a machine, DMARC failing, the desk
 * off, the store not open, too many) and added as the customer's message; the AI answers as the desk's mode says, by email: it has
 * no tool that needs a signed-in customer, since an email address proves no one. Answers go back by `sendReplyEmails()`.
 */

const RESEND_RECEIVING = "https://api.resend.com/emails/receiving";

export type InboundEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    received_for?: string[];
    message_id?: string;
    subject?: string;
    created_at?: string;
  };
};

/** The email as Resend's receiving API gives it (only what is read). */
export type ReceivedEmail = {
  from?: string;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  message_id?: string | null;
  headers?: Headers | null;
  attachments?: unknown[] | null;
  authentication?: { spf?: unknown; dkim?: unknown; dmarc?: unknown } | null;
};

/** What processing needs from outside, replaced in tests. */
export type InboundDeps = {
  fetch?: typeof fetch;
  turn?: typeof runSupportTurn;
  env?: Record<string, string | undefined>;
};

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const newKey = () => {
  const bytes = randomBytes(20);
  return Array.from(bytes, (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
};
const senderKey = (address: string) => `email:${createHash("sha256").update(`${address}|kaizen-support-email`).digest("hex").slice(0, 32)}`;

/**
 * Keeps a received email's row (once per Resend id) with where it is for, then processes it after the answer. An email that is for no
 * desk of this platform is kept as refused, so it is never fetched. Never throws for a malformed event.
 */
export async function receiveInboundEvent(event: InboundEvent, deps: InboundDeps = {}): Promise<{ id: string | null; status: string }> {
  const data = event.data ?? {};
  const providerId = typeof data.email_id === "string" ? data.email_id.slice(0, 200) : "";
  const from = bareAddress(typeof data.from === "string" ? data.from : "");
  if (!providerId || !from) return { id: null, status: "ignored" };
  const domain = inboundDomain((deps.env ?? process.env).SUPPORT_INBOUND_DOMAIN);
  const route = domain ? routeOf([...strings(data.to), ...strings(data.cc), ...strings(data.bcc), ...strings(data.received_for)], domain) : null;

  let storeId: string | null = null;
  let conversationId: string | null = null;
  let routed = false;
  if (route?.kind === "desk") {
    const [desk] = await db().execute<Row>(sql`select store_id from commerce.support_settings where email_key = ${route.key}`);
    if (desk) [storeId, routed] = [desk.store_id ? String(desk.store_id) : null, true];
  } else if (route?.kind === "reply") {
    const [conversation] = await db().execute<Row>(sql`
      select id, store_id from commerce.support_conversations where reply_key = ${route.key} and anonymised_at is null
    `);
    if (conversation) [storeId, conversationId, routed] = [conversation.store_id ? String(conversation.store_id) : null, String(conversation.id), true];
  }
  const receivedAt = Date.parse(String(data.created_at ?? event.created_at ?? "")) || Date.now();
  const [row] = await db().execute<Row>(sql`
    insert into commerce.support_inbound_emails (provider_id, store_id, routed, conversation_id, from_address, subject, message_id, status, reason, received_at, finished_at)
    values (${providerId}, ${storeId}::uuid, ${routed}, ${conversationId}::uuid, ${from}, ${cleanSubject(data.subject)}, ${messageIdOf(data.message_id)},
      ${routed ? "pending" : "refused"}, ${routed ? null : domain ? "unknown_address" : "not_set_up"}, ${new Date(receivedAt).toISOString()}::timestamptz,
      ${routed ? null : sql`now()`})
    on conflict (provider_id) do nothing
    returning id, status
  `);
  if (!row) return { id: null, status: "duplicate" };
  const id = String(row.id);
  if (routed) after(() => processInboundEmails({ ...deps, only: id }).then(() => undefined));
  return { id, status: String(row.status) };
}

export type InboundRun = { done: number; refused: number; failed: number };

/** Takes the emails waiting (or one, `only`) and processes each; a failure is tried again later, `INBOUND_TRIES` in all. Never throws. */
export async function processInboundEmails(deps: InboundDeps & { only?: string; limit?: number } = {}): Promise<InboundRun> {
  const out: InboundRun = { done: 0, refused: 0, failed: 0 };
  let rows: Row[];
  try {
    rows = await db().execute<Row>(sql`
      update commerce.support_inbound_emails e set status = 'running', tries = e.tries + 1,
        claimed_until = now() + make_interval(mins => ${INBOUND_CLAIM_MINUTES})
      where e.id in (
        select id from commerce.support_inbound_emails
        where (status = 'pending' or (status = 'running' and claimed_until < now())) and tries < ${INBOUND_TRIES}
          ${deps.only ? sql`and id = ${deps.only}::uuid` : sql``}
        order by created_at limit ${deps.limit ?? 20}
        for update skip locked
      )
      returning e.*
    `);
    // Emails whose tries ran out while held by a run that never finished.
    if (!deps.only) {
      await db().execute(sql`
        update commerce.support_inbound_emails set status = 'failed', reason = 'tries', finished_at = now()
        where status = 'running' and claimed_until < now() and tries >= ${INBOUND_TRIES}
      `);
    }
  } catch (error) {
    log("error", "support.inbound_claim_failed", {}, error);
    return out;
  }
  for (const row of rows) {
    const id = String(row.id);
    try {
      const result = await processOne(row, deps);
      await db().execute(sql`
        update commerce.support_inbound_emails set status = ${result.status}, reason = ${result.reason ?? null},
          conversation_id = coalesce(${result.conversationId ?? null}::uuid, conversation_id), claimed_until = null, finished_at = now()
        where id = ${id}::uuid
      `);
      if (result.status === "done") out.done += 1;
      else out.refused += 1;
    } catch (error) {
      out.failed += 1;
      log("warn", "support.inbound_failed", { id, tries: Number(row.tries) }, error);
      await db()
        .execute(sql`
          update commerce.support_inbound_emails set claimed_until = null,
            status = case when tries >= ${INBOUND_TRIES} then 'failed' else 'pending' end,
            reason = case when tries >= ${INBOUND_TRIES} then 'tries' else reason end,
            finished_at = case when tries >= ${INBOUND_TRIES} then now() end
          where id = ${id}::uuid
        `)
        .catch(() => undefined);
    }
  }
  return out;
}

type Outcome = { status: "done" | "refused"; reason?: string; conversationId?: string };
const refused = (reason: string): Outcome => ({ status: "refused", reason });

/** Fetches the email's words from Resend, or throws (tried again). */
async function fetchEmail(providerId: string, deps: InboundDeps): Promise<ReceivedEmail | null> {
  const env = deps.env ?? process.env;
  const key = (env.RESEND_RECEIVING_KEY ?? env.RESEND_API_KEY)?.trim();
  if (!key?.startsWith("re_")) return null;
  const response = await (deps.fetch ?? fetch)(`${RESEND_RECEIVING}/${encodeURIComponent(providerId)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) throw new Error("Resend does not have the email yet");
  if (!response.ok) throw new Error(`Resend answered ${response.status}`);
  return (await response.json()) as ReceivedEmail;
}

const fails = (value: unknown) => String((value as { result?: unknown } | null)?.result ?? value ?? "").toLowerCase() === "fail";

async function processOne(row: Row, deps: InboundDeps): Promise<Outcome> {
  const env = deps.env ?? process.env;
  if (!inboundDomain(env.SUPPORT_INBOUND_DOMAIN)) return refused("not_set_up");
  const storeId = row.store_id ? String(row.store_id) : null;
  const from = String(row.from_address);
  const desk = systemDesk(storeId);
  const settings = await deskSettings(desk);
  if (!settings || settings.mode === "off") return refused("desk_off");
  const site = await siteOf(storeId);
  if (!site) return refused("store_closed");

  const email = await fetchEmail(String(row.provider_id), deps);
  if (!email) return refused("not_set_up");
  const headers = email.headers ?? {};
  const machine = automated(email.from ?? from, headers, emailSettings(env)?.from ?? null);
  if (machine) return refused(machine);
  if (fails(email.authentication?.dmarc)) return refused("dmarc_fail");

  const [counts] = await db().execute<Row>(sql`
    select
      count(*) filter (where from_address = ${from} and created_at > now() - interval '1 hour')::int as sender,
      count(*)::int as desk
    from commerce.support_inbound_emails
    where store_id is not distinct from ${storeId}::uuid and routed and status = 'done' and created_at > now() - interval '1 day'
  `);
  if (Number(counts?.sender ?? 0) >= INBOUND_PER_SENDER_HOUR) return refused("sender_limit");
  if (Number(counts?.desk ?? 0) >= INBOUND_PER_DESK_DAY) return refused("desk_limit");

  const messageId = messageIdOf(email.message_id ?? (row.message_id ? String(row.message_id) : headerOf(headers, "message-id")));
  const thread = row.conversation_id ? await existingThread(desk, String(row.conversation_id), from) : null;
  const message = messageOf({ text: email.text ?? null, html: email.html ?? null, subject: email.subject ?? (row.subject ? String(row.subject) : null) }, { withSubject: thread === null });
  if (!message.body) return refused("empty");

  const conversationId = thread ?? (await newConversation(desk, settings, site, { from, name: displayName(email.from ?? ""), subject: cleanSubject(email.subject ?? (row.subject ? String(row.subject) : null)), messageId }));
  if (thread) {
    await db().execute(sql`
      update commerce.support_conversations set email_message_id = coalesce(${messageId}, email_message_id),
        email_subject = coalesce(email_subject, ${cleanSubject(email.subject)}), reply_key = coalesce(reply_key, ${newKey()})
      where id = ${thread}::uuid
    `);
  }
  const attachments = Array.isArray(email.attachments) ? email.attachments.length : 0;
  const added = await addMessage(desk, conversationId, "customer", null, message.body, { data: { email: { attachments, cut: message.cut } } });
  if (added && scoresTone(settings)) await scoreTone(desk, conversationId, added.seq).catch((error) => log("warn", "support.inbound_tone_failed", { conversationId }, error));
  await answer(desk, settings, site, conversationId, from, deps);
  return { status: "done", conversationId };
}

/** The site a desk answers for: a store that is open, in its own country, or Kaizena Flow's; null for a store that is not open. */
async function siteOf(storeId: string | null): Promise<ChatSite | null> {
  if (!storeId) return { kind: "kaizen" };
  const [row] = await db().execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid and commerce.store_is_active(id)`);
  const store = row ? await getOpenStore(String(row.slug)) : null;
  const market = store ? homeMarket(store) : undefined;
  return store && market ? { kind: "store", store, market } : null;
}

const placeOf = (site: ChatSite): ChatPlace =>
  site.kind === "store"
    ? { site, storeId: site.store.id, lang: site.market.lang, locale: site.market.locale, market: site.market.slug }
    : { site, storeId: null, lang: "en", locale: "en-GB", market: null };

/**
 * The conversation a reply address names, when the email may continue it: from the conversation's own address (the address its
 * answers went to), open, or ended within `REOPEN_HOURS` (reopened), and not full. Anything else starts a new conversation.
 */
async function existingThread(desk: Desk, conversationId: string, from: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select c.id, c.status, c.ended_at, c.message_seq, lower(coalesce(cu.email, c.contact_email)) as address
    from commerce.support_conversations c
    left join commerce.customers cu on cu.store_id = c.store_id and cu.id = c.customer_id
    where c.id = ${conversationId}::uuid and c.store_id is not distinct from ${desk.storeId}::uuid and c.anonymised_at is null and c.source <> 'admin'
  `);
  if (!row || row.address !== from || Number(row.message_seq) >= CONVERSATION_MESSAGES_MAX) return null;
  if (row.status === "open") return conversationId;
  const endedAt = row.ended_at ? Date.parse(String(row.ended_at)) : 0;
  if (Date.now() - endedAt >= REOPEN_HOURS * 3_600_000) return null;
  try {
    await transition(desk, conversationId, "reopen", { kind: "customer" });
    return conversationId;
  } catch (error) {
    if (error instanceof SupportError) return null;
    throw error;
  }
}

/** A new conversation by email: in the store's own language, the sender as its contact, never tied to a customer. */
async function newConversation(
  desk: Desk,
  settings: DeskSettings,
  site: ChatSite,
  email: { from: string; name: string | null; subject: string | null; messageId: string | null },
): Promise<string> {
  const place = placeOf(site);
  const [row] = await db().execute<Row>(sql`
    insert into commerce.support_conversations (store_id, source, handler, market, locale, contact_email, contact_name, reply_key, email_subject, email_message_id)
    values (${desk.storeId}::uuid, 'email', ${settings.mode === "people" ? "queue" : "ai"}, ${place.market}, ${place.locale.slice(0, 16)},
      ${email.from}, ${email.name}, ${newKey()}, ${email.subject}, ${email.messageId})
    returning id
  `);
  return String(row.id);
}

/**
 * The AI's answer while it has the conversation (the AI first): counted under the sender's address before any model is asked; past
 * a limit, without an agent or a model, or when it fails, the conversation goes to a person, as on the site; a hand-over the AI asks
 * for is kept with its words. With people only, nothing: the message waits in the queue.
 */
async function answer(desk: Desk, settings: DeskSettings, site: ChatSite, conversationId: string, from: string, deps: InboundDeps): Promise<void> {
  if (settings.mode !== "ai_first") return;
  const [current] = await db().execute<Row>(sql`select status, handler from commerce.support_conversations where id = ${conversationId}::uuid`);
  if (current?.status !== "open" || current.handler !== "ai") return;
  const context = await chatContext(placeOf(site));
  if (context instanceof Response || !context.agent) {
    await handOver(desk, conversationId, "system", "no_ai");
    return;
  }
  const turn = await takeChatTurn(context.storeId, senderKey(from), context.agent.dailyLimit);
  if (turn !== "ok") {
    await handOver(desk, conversationId, "system", "limit");
    return;
  }
  const result = await (deps.turn ?? runSupportTurn)(desk, context, conversationId, { signals: NO_SIGNALS }, null, null, { email: true });
  if (result.error) await handOver(desk, conversationId, "system", "no_ai");
  else if (result.handoff) await handOver(desk, conversationId, "ai", "ai", result.handoff);
}

/**
 * The desk's address to forward a store's support email to (made on first ask), or null while receiving is not set up. Shown on the
 * desk's settings page to the people who may read it.
 */
export async function deskEmailAddress(desk: Desk, env: Record<string, string | undefined> = process.env): Promise<string | null> {
  const domain = inboundDomain(env.SUPPORT_INBOUND_DOMAIN);
  if (!domain) return null;
  const [row] = await db().execute<Row>(sql`
    update commerce.support_settings set email_key = coalesce(email_key, ${newKey()})
    where store_id is not distinct from ${desk.storeId}::uuid
    returning email_key
  `);
  const key = row?.email_key ? String(row.email_key) : null;
  return key && ADDRESS_KEY.test(key) ? deskAddress(key, domain) : null;
}

/** Received emails' rows (sender and subject) older than `INBOUND_KEEP_DAYS` go; their messages stay with the conversation's own period. */
export async function pruneInboundEmails(now: Date = new Date()): Promise<number> {
  const rows = await db().execute(sql`
    delete from commerce.support_inbound_emails where created_at < ${now.toISOString()}::timestamptz - make_interval(days => ${INBOUND_KEEP_DAYS}) returning id
  `);
  return rows.length;
}
