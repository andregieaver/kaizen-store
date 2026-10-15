import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { findPages, pageHref } from "@/lib/admin-map";
import { effectiveFeatures } from "@/lib/store-features";
import { KAIZEN_SUPPORT_TOOLS } from "@/lib/support-tools";
import { CONVERSATION_MESSAGES_MAX, MESSAGE_MAX, REOPEN_HOURS } from "@/lib/support-rules";
import type { SupportChip, VisitorReply } from "@/lib/support-visitor";

import type { ToolDefinition } from "./ai";
import type { Account } from "./auth";
import type { SupportToolOutcome, SupportToolSet } from "./chat-agent";
import { chatContext, type ChatPlace } from "./chat-route";
import { getSetupProgress } from "./setup";
import { getStore } from "./stores";
import { SupportError, addMessage, transition, type Conversation } from "./support";
import { requesterDesk } from "./support-desk";
import { handOver, visitorReply } from "./support-route";
import { runSupportTurn } from "./support-turn";

type Row = Record<string, unknown>;

/**
 * Kaizen's desk for owners and staff (D216, `docs/support.md` 2.8, step 11): an account asks Kaizen from the admin (*Your requests to
 * Kaizen*, *Contact Kaizen support*, the AI manager's `contact_kaizen_support`). Such a conversation is Kaizen's (`store_id` null) with
 * source `admin` and the account as `requester_id`; it has no token: the account's session is the proof, and an account sees only
 * its own. Kaizen's AI answers first as its desk's mode says, from Kaizen's knowledge, the account's own stores' status (read-only,
 * only stores the account is a member of) and the admin's page map; it never acts on a store.
 */

/** Kaizen's site as the chat sees it: English, as the admin is. */
const KAIZEN_PLACE: ChatPlace = { site: { kind: "kaizen" }, storeId: null, lang: "en", locale: "en-GB", market: null };

const COLUMNS = sql`id, store_id, status, handler, customer_id, message_seq, ended_at, channel_key, locale, assignee_id, queued_at, contact_email, contact_changes, email_count, rating`;

// The account's own conversations ---------------------------------------------------------------------------------------------

export type RequesterRow = {
  id: string;
  status: "open" | "ended";
  handler: "ai" | "queue" | "human";
  title: string | null;
  aboutStore: string | null;
  lastMessage: string | null;
  lastMessageAt: string;
  createdAt: string;
};

/** The account's own conversations with Kaizen, newest first. */
export async function requesterConversations(account: Account, limit = 50): Promise<RequesterRow[]> {
  const rows = await db().execute<Row>(sql`
    select c.id, c.status, c.handler, c.summary ->> 'title' as title, s.name as about_store, c.last_message_at, c.created_at,
      (select m.body from commerce.support_messages m where m.conversation_id = c.id and m.author in ('customer', 'ai', 'agent') order by m.seq desc limit 1) as last_message
    from commerce.support_conversations c
    left join commerce.stores s on s.id = c.about_store_id
    where c.store_id is null and c.source = 'admin' and c.requester_id = ${account.id}::uuid and c.anonymised_at is null
    order by c.last_message_at desc nulls last, c.created_at desc
    limit ${limit}
  `);
  return rows.map((r) => ({
    id: String(r.id),
    status: r.status === "ended" ? "ended" : "open",
    handler: String(r.handler) as RequesterRow["handler"],
    title: r.title ? String(r.title) : null,
    aboutStore: r.about_store ? String(r.about_store) : null,
    lastMessage: r.last_message ? String(r.last_message).slice(0, 160) : null,
    lastMessageAt: new Date(String(r.last_message_at ?? r.created_at)).toISOString(),
    createdAt: new Date(String(r.created_at)).toISOString(),
  }));
}

/** One of the account's own conversations with Kaizen, or null (anyone else's, a store's, or one that is gone). */
export async function requesterConversation(account: Account, id: string): Promise<Conversation | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db().execute<Row>(sql`
    select ${COLUMNS} from commerce.support_conversations
    where id = ${id}::uuid and store_id is null and source = 'admin' and requester_id = ${account.id}::uuid and anonymised_at is null
  `);
  if (!row) return null;
  // The visitor readers take a reference; an admin conversation is found by its requester instead, through this one function.
  return visitorConversationOf(row);
}

const visitorConversationOf = (row: Row): Conversation => ({
  id: String(row.id),
  storeId: null,
  status: row.status === "ended" ? "ended" : "open",
  handler: String(row.handler) as Conversation["handler"],
  customerId: null,
  messageSeq: Number(row.message_seq),
  endedAt: row.ended_at ? new Date(String(row.ended_at)).toISOString() : null,
  channelKey: String(row.channel_key),
  locale: String(row.locale),
  assigneeId: row.assignee_id ? String(row.assignee_id) : null,
  queuedAt: row.queued_at ? new Date(String(row.queued_at)).toISOString() : null,
  contactEmail: null,
  contactChanges: 0,
  emailCount: Number(row.email_count ?? 0),
  rating: row.rating === "good" || row.rating === "bad" ? row.rating : null,
});

/** A store the account is a member of (not one that has expired or the platform keeps), by its address name, or null. */
async function memberStore(account: Account, slug: string): Promise<{ id: string; slug: string; name: string; status: string; role: string } | null> {
  const [row] = await db().execute<Row>(sql`
    select s.id, s.slug, s.name, s.status, m.role from commerce.store_members m
    join commerce.stores s on s.id = m.store_id and (not s.starter or exists (select 1 from commerce.store_starters st where st.store_id = s.id))
    where m.account_id = ${account.id}::uuid and s.slug = ${slug} and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
  `);
  return row ? { id: String(row.id), slug: String(row.slug), name: String(row.name), status: String(row.status), role: String(row.role) } : null;
}

export type RequesterAnswer = (Omit<VisitorReply, "conversation"> & { conversation: { id: string } }) | { error: string; status: number };

/**
 * The account's message to Kaizen: a new conversation (about one of their stores, if they named one) or the next message of their
 * own; an ended one is opened again within `REOPEN_HOURS`, else a new one starts. The message is kept first; Kaizen's AI answers
 * while it has the conversation, with Kaizen's tools for the account, and hands it to a person when it asks, fails or is missing.
 */
export async function requesterTurn(
  account: Account,
  input: { conversation?: string | null; after: number; message: string; aboutStore?: string | null; path?: string | null },
): Promise<RequesterAnswer> {
  const context = await chatContext(KAIZEN_PLACE);
  if (context instanceof Response) return { error: "Kaizena Flow support is not answering in the admin right now. Email Kaizena Flow instead.", status: 503 };
  const settings = context.settings;
  const desk = requesterDesk(account);
  const words = input.message.trim().slice(0, MESSAGE_MAX.customer);
  if (!words) return { error: "Write a message first.", status: 400 };

  let conversation = input.conversation ? await requesterConversation(account, input.conversation) : null;
  if (input.conversation && !conversation) return { error: "This conversation is not here.", status: 404 };
  let after = input.after;
  if (conversation?.status === "ended") {
    const recent = conversation.endedAt !== null && Date.now() - Date.parse(conversation.endedAt) < REOPEN_HOURS * 3_600_000;
    if (recent) await transition(desk, conversation.id, "reopen", { kind: "customer" });
    else conversation = null;
  }
  if (conversation && conversation.messageSeq >= CONVERSATION_MESSAGES_MAX) return { error: "This conversation has grown long. Start a new one.", status: 409 };
  if (!conversation) {
    const about = input.aboutStore ? await memberStore(account, input.aboutStore) : null;
    const [row] = await db().execute<Row>(sql`
      insert into commerce.support_conversations (store_id, source, handler, requester_id, about_store_id, locale, page_path)
      values (null, 'admin', ${settings.mode === "people" ? "queue" : "ai"}, ${account.id}::uuid, ${about?.id ?? null}::uuid, 'en-GB', ${input.path?.slice(0, 300) ?? null})
      returning ${COLUMNS}
    `);
    conversation = visitorConversationOf(row);
    after = 0;
  }
  try {
    await addMessage(desk, conversation.id, "customer", null, words);
  } catch (error) {
    if (error instanceof SupportError) return { error: "The message could not be sent.", status: 409 };
    throw error;
  }

  let failed: string | undefined;
  const current = (await requesterConversation(account, conversation.id)) ?? conversation;
  if (current.status === "open" && current.handler === "ai") {
    if (settings.mode === "ai_first" && !context.agent) {
      await handOver(desk, conversation.id, "system", "no_ai");
    } else {
      const turn = await runSupportTurn(desk, context, conversation.id, { path: input.path ?? undefined, signals: { views: [], searches: [] } }, null, { requester: account });
      if (turn.error && settings.mode === "ai_first") await handOver(desk, conversation.id, "system", "no_ai");
      else if (turn.error) failed = turn.error;
      else if (turn.handoff && settings.mode === "ai_first") await handOver(desk, conversation.id, "ai", "ai", turn.handoff);
    }
  }
  const fresh = (await requesterConversation(account, conversation.id)) ?? conversation;
  const reply = await visitorReply(desk, settings, fresh, after, null, failed ? { error: failed } : {});
  return { state: reply.state, messages: reply.messages, ...(reply.error ? { error: reply.error } : {}), conversation: { id: conversation.id } };
}

/** What is new in one of the account's own conversations (the page asks every few seconds). */
export async function requesterFeed(account: Account, id: string, after: number): Promise<RequesterAnswer> {
  const conversation = await requesterConversation(account, id);
  if (!conversation) return { error: "This conversation is not here.", status: 404 };
  const context = await chatContext(KAIZEN_PLACE);
  const settings = context instanceof Response ? null : context.settings;
  if (!settings) return { error: "Kaizena Flow support is not answering in the admin right now.", status: 503 };
  const reply = await visitorReply(requesterDesk(account), settings, conversation, after, null);
  return { state: reply.state, messages: reply.messages, conversation: { id } };
}

/** The account ends one of its own conversations. */
export async function requesterEnd(account: Account, id: string): Promise<boolean> {
  const conversation = await requesterConversation(account, id);
  if (!conversation || conversation.status !== "open") return false;
  try {
    await transition(requesterDesk(account), id, "end", { kind: "customer" });
  } catch (error) {
    if (!(error instanceof SupportError)) throw error;
  }
  return true;
}

// Kaizen's tools for an account (the first line's, and the partner's on Kaizen's desk) ----------------------------------------

const json = (value: unknown) => JSON.stringify(value).slice(0, 6000);

/** The account's stores: name, address name, open or not, plan. */
export async function myStores(accountId: string) {
  const rows = await db().execute<Row>(sql`
    select s.slug, s.name, s.status, m.role, p.name as plan
    from commerce.store_members m
    join commerce.stores s on s.id = m.store_id and (not s.starter or exists (select 1 from commerce.store_starters st where st.store_id = s.id))
    left join commerce.store_billing b on b.store_id = s.id
    left join commerce.plans p on p.id = b.plan_id
    where m.account_id = ${accountId}::uuid and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
    order by lower(s.name), s.slug limit 50
  `);
  return rows.map((r) => ({ store: String(r.slug), name: String(r.name), status: String(r.status), yourRole: String(r.role), plan: r.plan ? String(r.plan) : null }));
}

/** One of the account's stores: open or not, plan, card payments ready, setup steps left, features on. Null for a store that is not theirs. */
export async function storeStatus(accountId: string, slug: string) {
  const [row] = await db().execute<Row>(sql`
    select s.id, s.slug, s.name, s.status, p.name as plan, b.status as billing,
      exists (select 1 from commerce.stripe_accounts a where a.store_id = s.id and a.mode = 'live' and a.card_payments = 'active') as live_cards,
      exists (select 1 from commerce.stripe_accounts a where a.store_id = s.id and a.mode = 'test' and a.card_payments = 'active') as test_cards
    from commerce.store_members m
    join commerce.stores s on s.id = m.store_id and (not s.starter or exists (select 1 from commerce.store_starters st where st.store_id = s.id))
    left join commerce.store_billing b on b.store_id = s.id
    left join commerce.plans p on p.id = b.plan_id
    where m.account_id = ${accountId}::uuid and s.slug = ${slug} and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
  `);
  if (!row) return null;
  const store = row.status === "active" ? await getStore(String(row.slug)) : null;
  const setup = store ? await getSetupProgress(store) : null;
  const left = setup
    ? (["features", "details", "countries", "payments", "shipping", "products", "plan"] as const).filter((step) => !setup[step])
    : [];
  return {
    store: String(row.slug),
    name: String(row.name),
    status: String(row.status),
    plan: row.plan ? String(row.plan) : null,
    billing: row.billing ? String(row.billing) : null,
    cardPayments: row.live_cards ? "ready (live)" : row.test_cards ? "test mode only" : "not ready",
    ...(setup ? { setupStepsLeft: left, readyToOpen: setup.readyToOpen } : {}),
    featuresOn: store ? effectiveFeatures(store) : [],
  };
}

/** The admin's pages for what the person wants (the AI manager's map), with addresses in the store they asked about. */
export function adminPages(question: string, storeSlug: string | null) {
  const store = findPages("store", question).map((page) => ({ page, href: storeSlug ? pageHref(page, {}, storeSlug) : null }));
  return store.map(({ page, href }) => ({ title: page.title, what: page.what, ...(page.tasks ? { canDo: page.tasks } : {}), href }));
}

/** The first line's tools for an account's conversation with Kaizen (4.3a): their stores, a store's status, the admin's pages. */
export function kaizenToolsFor(account: Account, aboutStore: string | null): SupportToolSet {
  const offered = KAIZEN_SUPPORT_TOOLS.filter((tool) => tool.name !== "handoff_to_human");
  const definitions: ToolDefinition[] = offered.map((tool) => ({ name: tool.name, description: tool.description, parameters: z.toJSONSchema(tool.input) as Record<string, unknown> }));
  return {
    definitions,
    run: async (name, args): Promise<SupportToolOutcome> => {
      const tool = offered.find((candidate) => candidate.name === name);
      const input = tool?.input.safeParse(args);
      if (!tool || !input?.success) return { result: json({ error: "invalid" }) };
      const data = input.data as Record<string, unknown>;
      switch (name) {
        case "my_stores":
          return { result: json({ stores: await myStores(account.id) }) };
        case "store_status": {
          const status = await storeStatus(account.id, String(data.store));
          return { result: json(status ?? { error: "not_found", note: "Not one of the person's stores. Use my_stores." }) };
        }
        case "find_admin_page": {
          const stores = await myStores(account.id);
          const slug = aboutStore ?? (stores.length === 1 ? stores[0].store : null);
          const pages = adminPages(String(data.query), slug);
          const chips: SupportChip[] = pages.flatMap((page) => (page.href ? [{ kind: "page" as const, label: page.title, href: page.href }] : []));
          return {
            result: json({ pages, note: slug ? "Links to these pages are shown under your answer." : "Ask which store it is about to link the pages." }),
            chips: chips.slice(0, 4),
          };
        }
      }
      return { result: json({ error: "unknown_tool" }) };
    },
  };
}

/** The store an admin conversation is about, by its id (for the turn's tools). */
export async function aboutStoreOf(conversationId: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select s.slug from commerce.support_conversations c join commerce.stores s on s.id = c.about_store_id where c.id = ${conversationId}::uuid
  `);
  return row ? String(row.slug) : null;
}
