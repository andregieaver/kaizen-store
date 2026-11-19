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
  KEY_RETRY_MINUTES,
  automated,
  bareAddress,
  cleanSubject,
  deskAddress,
  displayName,
  headerOf,
  inboundDomain,
  messageIdOf,
  messageOf,
  referencedIds,
  routeOf,
  type Headers,
} from "@/lib/inbound-email";
import { homeMarket, inView } from "@/lib/markets";
import { NO_SIGNALS } from "@/lib/recommendations";
import { CONVERSATION_MESSAGES_MAX, REOPEN_HOURS } from "@/lib/support-rules";

import { takeChatTurn, type ChatSite } from "./chat-agent";
import { chatContext, type ChatPlace } from "./chat-route";
import { fileReceived, pruneFiledEmails, storeOfFilingKey } from "./email-filing";
import { keepInboxAttachments, storeOfBooksKey, type ReceivedAttachment } from "./books-inbox";
import type { DocumentStorage } from "./invoice-storage";
import { log } from "./log";
import { getOpenStore } from "./stores";
import { SupportError, addMessage, deskSettings, transition, type DeskSettings } from "./support";
import { systemDesk, type Desk } from "./support-desk";
import { handOver } from "./support-route";
import { scoreTone, scoresTone } from "./support-tone";
import { runSupportTurn } from "./support-turn";
import type { SupportCustomer } from "./support-tools";
import type { Account } from "./auth";
import { autonomyFor } from "./autopilot-settings";
import { col, typedRow, typedRows } from "./typed-rows";
import { owned } from "./owned";
import { textList } from "./sql-arrays";
import { z } from "zod";
import { normaliseEmail } from "@/lib/email-address";
import { emailLanguage } from "@/lib/email-language";
import { PLATFORM_LANG_FACTS, PLATFORM_LANGS, isPlatformLang } from "@/lib/platform-lang";

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
  /** Where the books' inbox keeps its documents (D504); the private `documents` bucket unless given. */
  storage?: DocumentStorage | null;
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
    if (desk) [storeId, routed] = [desk.store_id ? String(desk.store_id) : (await houseEmailDesk()), true];
  } else if (route?.kind === "filing") {
    // A store's filing address (S5, D476): filed on its people by `fileReceived()`, never a conversation.
    const filingStore = await storeOfFilingKey(route.key);
    if (filingStore) [storeId, routed] = [filingStore, true];
  } else if (route?.kind === "books") {
    // A store's books address (D504): its attachments kept in the books' inbox by `keepInboxAttachments()`, never a conversation.
    const booksStore = await storeOfBooksKey(route.key);
    if (booksStore) [storeId, routed] = [booksStore, true];
  } else if (route?.kind === "reply") {
    const [conversation] = await db().execute<Row>(sql`
      select id, store_id from commerce.support_conversations where reply_key = ${route.key} and anonymised_at is null
    `);
    if (conversation) [storeId, conversationId, routed] = [conversation.store_id ? String(conversation.store_id) : null, String(conversation.id), true];
  }
  const receivedAt = Date.parse(String(data.created_at ?? event.created_at ?? "")) || Date.now();
  const [row] = await db().execute<Row>(sql`
    insert into commerce.support_inbound_emails (provider_id, store_id, routed, conversation_id, from_address, subject, message_id, status, reason, received_at, finished_at, purpose)
    values (${providerId}, ${storeId}::uuid, ${routed}, ${conversationId}::uuid, ${from}, ${cleanSubject(data.subject)}, ${messageIdOf(data.message_id)},
      ${routed ? "pending" : "refused"}, ${routed ? null : domain ? "unknown_address" : "not_set_up"}, ${new Date(receivedAt).toISOString()}::timestamptz,
      ${routed ? null : sql`now()`}, ${route?.kind === "filing" ? "filing" : route?.kind === "books" && routed ? "books" : "support"})
    on conflict (provider_id) do nothing
    returning id, status
  `);
  if (!row) return { id: null, status: "duplicate" };
  const id = String(row.id);
  // The same email reaching the desk twice (forwarded to two of its addresses, such as Kaizena Flow's two desks): only the first is answered.
  if (routed && route?.kind === "desk" && (await secondCopy(id, storeId, messageIdOf(data.message_id)))) return { id, status: "refused" };
  if (routed) after(() => processInboundEmails({ ...deps, only: id }).then(() => undefined));
  return { id, status: String(row.status) };
}

/**
 * Kaizena Flow's own store's desk, while kaizenaflow.com is served from that store (D484) and its desk takes email, or null. Email to the
 * platform's desk then goes there (step 6 of `docs/platform-parity-plan.md`: one desk for the site's visitors), so a support address
 * forwarded to both desks is answered once, by the store's assistant.
 */
async function houseEmailDesk(): Promise<string | null> {
  const house = await typedRow(
    z.object({ id: col.uuid }),
    sql`select s.id from commerce.platform_settings p
        join commerce.stores s on s.house and s.status = 'active'
        join commerce.support_settings d on d.store_id = s.id and d.email_key is not null and d.mode <> 'off'
        where p.site_from_store`,
  );
  return house?.id ?? null;
}

/**
 * Whether a received email is a second copy of one the same desk already has (the same Message-ID within a day), and if so keeps it as
 * refused (`duplicate`). Of two that arrive together, the later row stands down: each sees the other, and only one is later.
 */
async function secondCopy(id: string, storeId: string | null, messageId: string | null): Promise<boolean> {
  if (!messageId) return false;
  const earlier = await typedRow(z.object({ one: z.number() }), sql`
    select 1 as one from commerce.support_inbound_emails e, commerce.support_inbound_emails me
    where me.id = ${id}::uuid and e.id <> me.id and ${owned(storeId, sql`e.store_id`)} and e.message_id = ${messageId} and e.purpose = 'support'
      and e.created_at > now() - interval '1 day' and (e.created_at, e.id) < (me.created_at, me.id)
    limit 1
  `);
  if (!earlier) return false;
  await db().execute(sql`update commerce.support_inbound_emails set status = 'refused', reason = 'duplicate', finished_at = now()
    where id = ${id}::uuid and ${owned(storeId)} and status = 'pending'`);
  return true;
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
        where ((status = 'pending' or (status = 'running' and claimed_until < now())) and tries < ${INBOUND_TRIES}
            -- Emails Resend would not give us with our key are read again now and then, so a fixed key reads them (D332).
            or (status = 'failed' and reason = 'key_refused' and finished_at < now() - make_interval(mins => ${KEY_RETRY_MINUTES})))
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
          conversation_id = coalesce(${result.conversationId ?? null}::uuid, conversation_id), claimed_until = null, finished_at = now(),
          -- A refused key is no fault of the email: it keeps its tries for when the key works.
          tries = case when ${result.reason === "key_refused"} then 0 else tries end
        where id = ${id}::uuid
      `);
      if (result.status === "done") out.done += 1;
      else if (result.status === "failed") {
        out.failed += 1;
        log("warn", "support.inbound_key_refused", { id });
      } else out.refused += 1;
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

type Outcome = { status: "done" | "refused" | "failed"; reason?: string; conversationId?: string };
const refused = (reason: string): Outcome => ({ status: "refused", reason });

/**
 * Fetches the email's words from Resend: the email, null without a key, `key_refused` when Resend will not give it with our key (a
 * sending-only key: `RESEND_RECEIVING_KEY` needs full access), or throws (tried again).
 */
async function fetchEmail(providerId: string, deps: InboundDeps): Promise<ReceivedEmail | null | "key_refused"> {
  const env = deps.env ?? process.env;
  const key = (env.RESEND_RECEIVING_KEY ?? env.RESEND_API_KEY)?.trim();
  if (!key?.startsWith("re_")) return null;
  const response = await (deps.fetch ?? fetch)(`${RESEND_RECEIVING}/${encodeURIComponent(providerId)}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) return "key_refused";
  if (response.status === 404) throw new Error("Resend does not have the email yet");
  if (!response.ok) throw new Error(`Resend answered ${response.status}`);
  return (await response.json()) as ReceivedEmail;
}

const fails = (value: unknown) => String((value as { result?: unknown } | null)?.result ?? value ?? "").toLowerCase() === "fail";

/** A mail to a store's filing address (S5, D476): read as every received email is, then filed on its people (`fileReceived()`). */
async function fileOne(row: Row, storeId: string | null, deps: InboundDeps): Promise<Outcome> {
  const env = deps.env ?? process.env;
  if (!storeId) return refused("unknown_address");
  const email = await fetchEmail(String(row.provider_id), deps);
  if (email === "key_refused") return { status: "failed", reason: "key_refused" };
  if (!email) return refused("not_set_up");
  const headers = email.headers ?? {};
  const machine = automated(email.from ?? String(row.from_address), headers, emailSettings(env)?.from ?? null);
  if (machine) return refused(machine);
  if (fails(email.authentication?.dmarc)) return refused("dmarc_fail");
  const list = (name: string) => (headerOf(headers, name) ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  const filed = await fileReceived(
    storeId,
    {
      from: email.from ?? String(row.from_address),
      to: list("to"),
      cc: list("cc"),
      subject: cleanSubject(email.subject ?? (row.subject ? String(row.subject) : null)),
      text: email.text ?? null,
      html: email.html ?? null,
      messageId: messageIdOf(email.message_id ?? (row.message_id ? String(row.message_id) : headerOf(headers, "message-id"))),
      sentAt: new Date(String(row.received_at ?? new Date().toISOString())).toISOString(),
    },
    env,
  );
  return filed.status === "done" ? { status: "done" } : refused(filed.reason ?? "refused");
}

/**
 * A mail to a store's books address (D504): its PDFs and pictures kept in the books' inbox (`keepInboxAttachments()`). A supplier's own
 * billing system sends it, so mail sent by a machine is taken; mail that fails DMARC is not.
 */
async function booksOne(row: Row, storeId: string | null, deps: InboundDeps): Promise<Outcome> {
  if (!storeId) return refused("unknown_address");
  const email = await fetchEmail(String(row.provider_id), deps);
  if (email === "key_refused") return { status: "failed", reason: "key_refused" };
  if (!email) return refused("not_set_up");
  if (fails(email.authentication?.dmarc)) return refused("dmarc_fail");
  const kept = await keepInboxAttachments(
    storeId,
    {
      providerId: String(row.provider_id),
      from: email.from ?? String(row.from_address),
      subject: cleanSubject(email.subject ?? (row.subject ? String(row.subject) : null)),
      receivedAt: new Date(String(row.received_at ?? new Date().toISOString())).toISOString(),
      attachments: Array.isArray(email.attachments) ? (email.attachments as ReceivedAttachment[]) : [],
    },
    { fetch: deps.fetch, env: deps.env, storage: deps.storage },
  );
  return kept.status === "done" ? { status: "done" } : refused(kept.reason ?? "refused");
}

async function processOne(row: Row, deps: InboundDeps): Promise<Outcome> {
  const env = deps.env ?? process.env;
  if (!inboundDomain(env.SUPPORT_INBOUND_DOMAIN)) return refused("not_set_up");
  const storeId = row.store_id ? String(row.store_id) : null;
  const from = String(row.from_address);
  if (row.purpose === "filing") return fileOne(row, storeId, deps);
  if (row.purpose === "books") return booksOne(row, storeId, deps);
  const desk = systemDesk(storeId);
  const settings = await deskSettings(desk);
  if (!settings || settings.mode === "off") return refused("desk_off");
  const site = await siteOf(storeId);
  if (!site) return refused("store_closed");

  const email = await fetchEmail(String(row.provider_id), deps);
  if (email === "key_refused") return { status: "failed", reason: "key_refused" };
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
    where ${owned(storeId)} and routed and status = 'done' and created_at > now() - interval '1 day'
  `);
  if (Number(counts?.sender ?? 0) >= INBOUND_PER_SENDER_HOUR) return refused("sender_limit");
  if (Number(counts?.desk ?? 0) >= INBOUND_PER_DESK_DAY) return refused("desk_limit");

  const messageId = messageIdOf(email.message_id ?? (row.message_id ? String(row.message_id) : headerOf(headers, "message-id")));
  // A reply address names its conversation; an email to the desk's own address may still continue one by its headers (D332).
  const named = row.conversation_id ? String(row.conversation_id) : await threadOfHeaders(desk, from, referencedIds(headers));
  const thread = named ? await existingThread(desk, named, from) : null;
  const message = messageOf({ text: email.text ?? null, html: email.html ?? null, subject: email.subject ?? (row.subject ? String(row.subject) : null) }, { withSubject: thread === null });
  if (!message.body) return refused("empty");

  const spoken = inEmailLanguage(site, message.body);
  const conversationId = thread ?? (await newConversation(desk, settings, spoken, { from, name: displayName(email.from ?? ""), subject: cleanSubject(email.subject ?? (row.subject ? String(row.subject) : null)), messageId }));
  if (thread) {
    await db().execute(sql`
      update commerce.support_conversations set email_message_id = coalesce(${messageId}, email_message_id),
        email_subject = coalesce(email_subject, ${cleanSubject(email.subject)}), reply_key = coalesce(reply_key, ${newKey()}),
        locale = ${placeOf(spoken).locale.slice(0, 16)}, market = ${placeOf(spoken).market}
      where id = ${thread}::uuid
    `);
  }
  const attachments = Array.isArray(email.attachments) ? email.attachments.length : 0;
  const added = await addMessage(desk, conversationId, "customer", null, message.body, { data: { email: { attachments, cut: message.cut } } });
  if (added && scoresTone(settings)) await scoreTone(desk, conversationId, added.seq).catch((error) => log("warn", "support.inbound_tone_failed", { conversationId }, error));
  await answer(desk, settings, spoken, conversationId, from, deps);
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
    : isPlatformLang(site.lang) && site.lang !== "en"
      ? { site, storeId: null, lang: site.lang, locale: PLATFORM_LANG_FACTS[site.lang].locale, market: null }
      : { site, storeId: null, lang: "en", locale: "en-GB", market: null };

/**
 * The site in the language an email is written in (D332, `emailLanguage()`): a store's market in that language, or Kaizena Flow's site in
 * one of its languages; the site as it is when the email does not say clearly or the site has no such language. The conversation keeps
 * that language, so the AI's answer and the email around it are written in it.
 */
export function inEmailLanguage(site: ChatSite, text: string): ChatSite {
  if (site.kind === "store") {
    // The store's languages: those it offers (a country may be shown in another of them, as Kaizena Flow's Norway is in English and
    // Norwegian), and each country's own.
    const offered = [...new Set([...site.store.localization.locales, ...site.store.markets.map((market) => market.locale)])];
    const lang = emailLanguage(text, offered);
    if (!lang || lang === site.market.lang) return site;
    const market = site.store.markets.find((candidate) => candidate.lang === lang);
    if (market) return { ...site, market };
    const locale = offered.find((candidate) => candidate.split("-")[0].toLowerCase() === lang);
    return locale ? { ...site, market: inView(site.market, { locale }) } : site;
  }
  const lang = emailLanguage(text, PLATFORM_LANGS);
  return lang && lang !== (site.lang ?? "en") ? { ...site, lang } : site;
}

/**
 * The conversation a reply address names, when the email may continue it: from the conversation's own address (the address its
 * answers went to), open, or ended within `REOPEN_HOURS` (reopened), and not full. Anything else starts a new conversation.
 */
async function existingThread(desk: Desk, conversationId: string, from: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select c.id, c.status, c.ended_at, c.message_seq, lower(coalesce(cu.email, c.contact_email)) as address
    from commerce.support_conversations c
    left join commerce.customers cu on cu.store_id = c.store_id and cu.id = c.customer_id
    where c.id = ${conversationId}::uuid and ${owned(desk.storeId, sql`c.store_id`)} and c.anonymised_at is null and c.source <> 'admin'
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

/**
 * The conversation an email to the desk's own address continues, by the message ids its `In-Reply-To` and `References` name (D332): a
 * conversation by email from the same address whose latest customer message, or any email received for it in the last
 * `INBOUND_KEEP_DAYS`, has one of those ids. Null when none does; `existingThread()` then decides as for a reply address (the sender,
 * open or reopenable, not full). Without it, a person who wrote to the support address again from the thread, or whose mail app
 * ignored Reply-To, started a new conversation each time.
 */
async function threadOfHeaders(desk: Desk, from: string, ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const found = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      select c.id from commerce.support_conversations c
      where ${owned(desk.storeId, sql`c.store_id`)} and c.source = 'email' and c.anonymised_at is null
        and lower(c.contact_email) = ${from}
        and (
          c.email_message_id = any(${textList(ids)})
          or c.id in (
            select e.conversation_id from commerce.support_inbound_emails e
            where ${owned(desk.storeId, sql`e.store_id`)} and e.conversation_id is not null and e.message_id = any(${textList(ids)})
          )
        )
      order by c.created_at desc
      limit 1
    `,
  );
  return found?.id ?? null;
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
    values (${desk.storeId}::uuid, 'email', ${settings.mode === "people" || settings.sensitive ? "queue" : "ai"}, ${place.market}, ${place.locale.slice(0, 16)},
      ${email.from}, ${email.name}, ${newKey()}, ${email.subject}, ${email.messageId})
    returning id
  `);
  return String(row.id);
}

/**
 * The AI's answer while it has the conversation (the AI first): counted under the sender's address before any model is asked; past
 * a limit, without an agent or a model, or when it fails, the conversation goes to a person, as on the site; a hand-over the AI asks
 * for is kept with its words. With people only, or a store that handles sensitive information (PSI REG-11), nothing: the message waits
 * in the queue for a person.
 */
export async function answer(desk: Desk, settings: DeskSettings, site: ChatSite, conversationId: string, from: string, deps: InboundDeps = {}): Promise<void> {
  if (settings.mode !== "ai_first") return;
  const [current] = await db().execute<Row>(sql`select status, handler from commerce.support_conversations where id = ${conversationId}::uuid`);
  if (current?.status !== "open" || current.handler !== "ai") return;
  // A store that handles sensitive information gives every email to a person (PSI REG-11): a new one, and one the AI held before.
  if (settings.sensitive) {
    await handOver(desk, conversationId, "system", "no_ai");
    return;
  }
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
  const customer = await emailCustomer(desk, settings, conversationId);
  const account = await emailAccount(desk, settings, conversationId);
  const result = await (deps.turn ?? runSupportTurn)(desk, context, conversationId, { signals: NO_SIGNALS }, customer, null, { email: true, account });
  if (result.error) await handOver(desk, conversationId, "system", "no_ai");
  else if (result.handoff) await handOver(desk, conversationId, "ai", "ai", result.handoff, result.escalation);
}

/**
 * The customer an email conversation is from, for the AI to read their own orders (`docs/100-day-challenge.md` B1), or null: only while the
 * desk's *Answer emails about orders* is on, or the store is in the challenge, and only the one customer of the store whose address is the
 * conversation's own. That address is safe to answer about: an email reaches the AI only when its DMARC check did not fail and, in a thread,
 * only from the conversation's address, and every answer goes to that address alone (`sendReplyEmails()`), so whoever sent it, only the
 * address's owner reads what the orders say. A form's conversation (B2, D797) counts only once the customer wrote in it by email: a form's
 * address is only typed, a reply from it passed the same checks.
 */
export async function emailCustomer(desk: Desk, settings: DeskSettings, conversationId: string): Promise<SupportCustomer> {
  if (!desk.storeId || settings.sensitive) return null;
  if (!settings.emailOrders && !(await autonomyFor(desk.storeId)).challenge) return null;
  const conversation = await typedRow(
    z.object({ contact_email: col.textOrNull }),
    sql`select c.contact_email from commerce.support_conversations c
        where c.id = ${conversationId}::uuid and c.store_id = ${desk.storeId}::uuid
          and (c.source = 'email' or (c.source = 'form' and exists (
            select 1 from commerce.support_messages m
            where m.conversation_id = c.id and m.store_id = c.store_id and m.author = 'customer' and m.data ? 'email')))`,
  );
  const address = conversation?.contact_email ? normaliseEmail(conversation.contact_email) : "";
  if (!address) return null;
  const found = await typedRows(
    z.object({ id: col.uuid, email: col.text }),
    sql`select id, email from commerce.customers where store_id = ${desk.storeId}::uuid and lower(email) = ${address} limit 2`,
  );
  return found.length === 1 ? { id: found[0].id, email: found[0].email } : null;
}

/**
 * The Kaizena Flow account an email conversation is from, for the AI to read that account's own stores (`my_stores`, `store_status`), or
 * null: only on Kaizena Flow's own desks (the platform's, and the house store's, D484), never on a desk for sensitive information, and only
 * the one account whose address is the conversation's own. As with `emailCustomer()`, the email reached the AI only with a DMARC check that
 * did not fail and, in a thread, only from that address; every answer goes to that address alone, and the tools only read.
 */
export async function emailAccount(desk: Desk, settings: DeskSettings, conversationId: string): Promise<Account | null> {
  if (settings.sensitive) return null;
  if (desk.storeId) {
    const store = await typedRow(z.object({ house: col.bool }), sql`select house from commerce.stores where id = ${desk.storeId}::uuid`);
    if (!store?.house) return null;
  }
  const conversation = await typedRow(
    z.object({ contact_email: col.textOrNull }),
    sql`select contact_email from commerce.support_conversations where id = ${conversationId}::uuid and ${owned(desk.storeId)} and source = 'email'`,
  );
  const address = conversation?.contact_email ? normaliseEmail(conversation.contact_email) : "";
  if (!address) return null;
  const found = await typedRows(
    z.object({ id: col.uuid, email: col.text, name: col.textOrNull }),
    sql`select id, email, name from commerce.accounts where lower(email) = ${address} limit 2`,
  );
  return found.length === 1 ? { id: found[0].id, email: found[0].email, name: found[0].name, platformAdmin: false } : null;
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
    where ${owned(desk.storeId)}
    returning email_key
  `);
  const key = row?.email_key ? String(row.email_key) : null;
  return key && ADDRESS_KEY.test(key) ? deskAddress(key, domain) : null;
}

/**
 * How many emails to the desk wait because Resend refused the key that reads them (`RESEND_RECEIVING_KEY`, D332), for the settings
 * card; 0 when none do.
 */
export async function deskEmailsKeyRefused(desk: Desk): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.support_inbound_emails
    where ${owned(desk.storeId)} and routed and status = 'failed' and reason = 'key_refused'
  `);
  return Number(row?.n ?? 0);
}

/** Received emails' rows (sender and subject) older than `INBOUND_KEEP_DAYS` go; their messages stay with the conversation's own period. */
export async function pruneInboundEmails(now: Date = new Date()): Promise<number> {
  const rows = await db().execute(sql`
    delete from commerce.support_inbound_emails where created_at < ${now.toISOString()}::timestamptz - make_interval(days => ${INBOUND_KEEP_DAYS}) returning id
  `);
  // Mail filed on the timeline (S5, D476) goes after the email bodies' retention rule.
  return rows.length + (await pruneFiledEmails());
}
