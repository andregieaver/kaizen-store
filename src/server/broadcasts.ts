import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  broadcastContentSchema,
  broadcastInput,
  emptyCounts,
  linksOf,
  linkTarget,
  parseSuggestion,
  RECIPIENTS_KEEP_DAYS,
  keepHanded,
  sendProblems,
  SUGGEST_CAMPAIGNS_MAX,
  SUGGEST_PRODUCTS_MAX,
  suggestionClaims,
  type EmailFacts,
  type BroadcastAudience,
  type BroadcastContent,
  type BroadcastCounts,
  type BroadcastStatus,
  type BroadcastSuggestion,
} from "@/lib/broadcasts";
import { roomLeft } from "@/lib/limits";
import { limitRefusal } from "@/lib/usage-format";
import { AVOIDED_LABEL, brandGuide } from "@/lib/brand";
import { CLAIM_LABELS } from "@/lib/claims";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { describeRules, matches, SEGMENT_CAP } from "@/lib/segments";
import { siteUrl } from "@/lib/site";

import { limitFor, usageNow } from "./limits";
import { AiError, aiFor, chatWithTools, type ToolChatMessage, type ToolDefinition } from "./ai";
import { audit } from "./auth";
import { brandOf } from "./brand";
import { campaignFacts, emailMarket, findProductFacts } from "./broadcast-facts";
import { listTiers } from "./customer-tiers";
import { BATCH_MAX, deliverBatch, emailSettings, sendEmail, type Delivery, type SendOutcome } from "./email";
import { emailPictureProblem, factsForEmail, marketingEmail, marketSlugFor, resolverFor, type MarketingEmail } from "./marketing-email";
import { getSegment, segmentPeople } from "./segments";
import { storeById, type EmailStore } from "./shopper-emails";
import { RULES_STAND, UNTRUSTED_TEXT } from "@/lib/prompt-safety";

type Row = Record<string, unknown>;

/**
 * Broadcasts (wave 5 unit C, D297, `docs/wave-5-marketing.md` 5): the only writer of `commerce.broadcasts`, `broadcast_recipients` and
 * `broadcast_link_clicks`. A broadcast is written per language, tested to the staff's own address, and sent to the addresses on the subscriber list
 * that are `subscribed` (everyone, or a segment's), frozen when the send starts and sent once each, in batches, by `runBroadcasts()`.
 */

const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);

// ---------------------------------------------------------------------------
// Reading and saving
// ---------------------------------------------------------------------------

export type Broadcast = {
  id: string;
  title: string;
  audience: BroadcastAudience;
  segmentId: string | null;
  segmentName: string | null;
  /** The stored content; `{}` when it can no longer be read. */
  content: BroadcastContent;
  status: BroadcastStatus;
  scheduledFor: string | null;
  scheduleProblem: string | null;
  audienceWords: string | null;
  recipientCount: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function toBroadcast(row: Row): Broadcast {
  const content = broadcastContentSchema.safeParse(row.content);
  return {
    id: String(row.id),
    title: String(row.title),
    audience: row.audience as BroadcastAudience,
    segmentId: row.segment_id ? String(row.segment_id) : null,
    segmentName: row.segment_name ? String(row.segment_name) : null,
    content: content.success ? content.data : {},
    status: row.status as BroadcastStatus,
    scheduledFor: iso(row.scheduled_for),
    scheduleProblem: row.schedule_problem ? String(row.schedule_problem) : null,
    audienceWords: row.audience_words ? String(row.audience_words) : null,
    recipientCount: row.recipient_count === null || row.recipient_count === undefined ? null : Number(row.recipient_count),
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

const COLUMNS = sql`b.id, b.title, b.audience, b.segment_id, g.title as segment_name, b.content, b.status, b.scheduled_for, b.schedule_problem,
  b.audience_words, b.recipient_count, b.started_at, b.finished_at, b.created_at, b.updated_at`;

export async function listBroadcasts(storeId: string): Promise<Broadcast[]> {
  const rows = await db().execute<Row>(sql`
    select ${COLUMNS} from commerce.broadcasts b left join commerce.segments g on g.id = b.segment_id
    where b.store_id = ${storeId}::uuid order by coalesce(b.started_at, b.scheduled_for, b.created_at) desc limit 200
  `);
  return rows.map(toBroadcast);
}

export async function getBroadcast(storeId: string, id: string): Promise<Broadcast | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db().execute<Row>(sql`
    select ${COLUMNS} from commerce.broadcasts b left join commerce.segments g on g.id = b.segment_id
    where b.store_id = ${storeId}::uuid and b.id = ${id}::uuid
  `);
  return row ? toBroadcast(row) : null;
}

export type SaveBroadcastResult = { ok: true; id: string } | { ok: false; problem: string };

/** Saves a draft or scheduled broadcast (`marketing:write`); a sent one is refused by the database. */
export async function saveBroadcast(store: Pick<EmailStore, "id" | "localization">, accountId: string, id: string | null, input: unknown): Promise<SaveBroadcastResult> {
  const parsed = broadcastInput.safeParse(input);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Something is not filled in." };
  const value = parsed.data;
  const kept = new Set(store.localization.keptLocales);
  const content = Object.fromEntries(Object.entries(value.content).filter(([locale]) => kept.has(locale)));
  const picture = await emailPictureProblem(store.id, content);
  if (picture) return { ok: false, problem: picture };
  const segmentId = value.audience === "segment" ? value.segmentId : null;
  if (segmentId && !(await getSegment(store.id, segmentId))) return { ok: false, problem: "That segment is gone. Choose another." };
  try {
    let savedId: string;
    if (id) {
      const rows = await db().execute<Row>(sql`
        update commerce.broadcasts set title = ${value.title}, audience = ${value.audience}, segment_id = ${segmentId}::uuid,
          content = ${JSON.stringify(content)}::jsonb
        where store_id = ${store.id}::uuid and id = ${id}::uuid and status in ('draft', 'scheduled')
        returning id
      `);
      if (rows.length === 0) return { ok: false, problem: "This broadcast was sent and can no longer be changed." };
      savedId = id;
    } else {
      const [row] = await db().execute<Row>(sql`
        insert into commerce.broadcasts (store_id, title, audience, segment_id, content, created_by)
        values (${store.id}::uuid, ${value.title}, ${value.audience}, ${segmentId}::uuid, ${JSON.stringify(content)}::jsonb, ${accountId}::uuid)
        returning id
      `);
      savedId = String(row.id);
    }
    await audit(accountId, store.id, "broadcast.saved", { title: value.title }, { target: { type: "broadcast", id: savedId } });
    return { ok: true, id: savedId };
  } catch (error) {
    return { ok: false, problem: errorText(error) };
  }
}

export async function deleteBroadcast(storeId: string, accountId: string, id: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.broadcasts where store_id = ${storeId}::uuid and id = ${id}::uuid and status = 'draft' returning title
  `);
  if (rows.length === 0) return false;
  await audit(accountId, storeId, "broadcast.deleted", { title: String(rows[0].title) }, { target: { type: "broadcast", id: id } });
  return true;
}

function errorText(error: unknown): string {
  let e: unknown = error;
  for (let i = 0; i < 4 && e; i++) {
    const message = e instanceof Error ? e.message : String(e);
    if (/broadcasts\.fixed|cannot become/.test(message)) return "This broadcast was sent and can no longer be changed.";
    if (/broadcasts\.segment/.test(message)) return "That segment is another store's.";
    e = (e as { cause?: unknown }).cause;
  }
  return "It could not be saved. Try again.";
}

// ---------------------------------------------------------------------------
// The email
// ---------------------------------------------------------------------------

type Rendered = MarketingEmail;

/** One recipient's email: their language, their market's links, their own unsubscribe token. A test (`token` null) links straight to targets. */
function emailFor(
  store: EmailStore,
  broadcast: Pick<Broadcast, "id" | "content">,
  locale: string | null,
  marketCode: string | null,
  token: string | null,
  facts: EmailFacts,
): Rendered | null {
  return marketingEmail({
    store,
    content: broadcast.content,
    facts,
    locale,
    marketCode,
    token,
    link: token ? (key, _target, marketSlug) => clickUrl(broadcast.id, key, marketSlug) : undefined,
  });
}

/** The click address of a link (5.5): it names only the broadcast, the link and the market. */
export function clickUrl(broadcastId: string, key: string, marketSlug: string): string {
  return `${siteUrl()}/api/marketing/c/${broadcastId}/${encodeURIComponent(key)}${marketSlug ? `?m=${encodeURIComponent(marketSlug)}` : ""}`;
}

/** A test to the staff member's own address, in a language they choose; it counts nowhere. */
export async function sendTestBroadcast(storeId: string, to: string, id: string, locale: string): Promise<SendOutcome | "empty"> {
  const [store, broadcast] = await Promise.all([storeById(storeId), getBroadcast(storeId, id)]);
  if (!store || !broadcast) return "failed";
  if (!broadcast.content[locale]?.subject || !broadcast.content[locale]?.blocks.length) return "empty";
  const content = { [locale]: broadcast.content[locale] };
  const email = emailFor(store, { ...broadcast, content }, locale, null, null, await factsForEmail(store, content, locale, null));
  if (!email) return "empty";
  return sendEmail({
    storeId,
    kind: "marketing.broadcast.test",
    to,
    email: { ...email, subject: `[Test] ${email.subject}` },
    fromName: store.name,
    replyTo: store.details.contactEmail ?? null,
  });
}

// ---------------------------------------------------------------------------
// Starting, scheduling and stopping (5.3)
// ---------------------------------------------------------------------------

export type StartResult = { ok: true; recipients: number } | { ok: false; problem: string };

type Audience = { emails: string[] | null; words: string } | { problem: string };

/** Who a broadcast is for now: every subscribed address (`emails` null) or a segment's, with its words. */
async function audienceOf(store: EmailStore, broadcast: Broadcast): Promise<Audience> {
  if (broadcast.audience === "everyone") return { emails: null, words: "Everyone who wants your emails" };
  if (!broadcast.segmentId) return { problem: "Its segment was deleted. Choose another." };
  const segment = await getSegment(store.id, broadcast.segmentId);
  if (!segment) return { problem: "Its segment was deleted. Choose another." };
  if (!segment.rules) return { problem: "Its segment's rules can no longer be read. Open the segment and save it again." };
  const now = new Date();
  const people = await segmentPeople(store, now);
  if (people.capped) return { problem: `The segment is read from at most ${SEGMENT_CAP.toLocaleString("en-GB")} people, so it would not reach all of them.` };
  const tiers = await listTiers(store.id);
  const rules = segment.rules;
  const emails = people.people.filter((p) => p.consent === "subscribed" && matches(rules, p, now)).map((p) => p.email);
  const money = (minor: number) => formatMoney(minor, mainCurrency(store), store.localization.locales[0] ?? "en-GB");
  return { emails, words: `${segment.name}: ${describeRules(rules, { money, groupName: (gid) => tiers.find((x) => x.id === gid)?.name })}` };
}

/** How many addresses a send would go to now (the editor's count): the audience's people who are `subscribed`. */
export async function audienceCount(store: EmailStore, audience: BroadcastAudience, segmentId: string | null): Promise<{ ok: true; people: number } | { ok: false; problem: string }> {
  const found = await audienceOf(store, { audience, segmentId } as Broadcast);
  if ("problem" in found) return { ok: false, problem: found.problem };
  if (found.emails) return { ok: true, people: found.emails.length };
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.marketing_subscribers where store_id = ${store.id}::uuid and status = 'subscribed'
  `);
  return { ok: true, people: Number(row?.n ?? 0) };
}

async function storeOpen(storeId: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`select commerce.store_is_active(id) as open, starter, is_template from commerce.stores where id = ${storeId}::uuid`);
  if (!row) return "The store is gone.";
  if (row.starter || row.is_template) return "A demo store or template sends no emails to people.";
  if (!row.open) return "The store is not open, so it sends no emails.";
  return null;
}

/** Why it cannot be sent now, before reading anyone: the store, the words. */
async function readiness(store: EmailStore, broadcast: Broadcast): Promise<string | null> {
  const closed = await storeOpen(store.id);
  if (closed) return closed;
  const problems = sendProblems(broadcast.content, store.localization.locales[0]);
  if (problems.length > 0) return problems[0];
  return null;
}

/** Nobody would get it: the start is rolled back. */
class Nobody extends Error {}
/** A send larger than the marketing emails left this month (D314). */
class OverLimit extends Error {}

/**
 * Starts a send: freezes the addresses that are `subscribed` now (the audience's) as its recipients, in one transaction under the broadcast's lock,
 * and sets it `sending`. The emails go out from `runBroadcasts()`.
 */
export async function startBroadcast(storeId: string, accountId: string | null, id: string): Promise<StartResult> {
  const [store, broadcast] = await Promise.all([storeById(storeId), getBroadcast(storeId, id)]);
  if (!store || !broadcast) return { ok: false, problem: "Unknown broadcast." };
  if (broadcast.status !== "draft" && broadcast.status !== "scheduled") return { ok: false, problem: "This broadcast was sent already." };
  const notReady = await readiness(store, broadcast);
  if (notReady) return { ok: false, problem: notReady };
  const audience = await audienceOf(store, broadcast);
  if ("problem" in audience) return { ok: false, problem: audience.problem };
  if (audience.emails && audience.emails.length === 0) return { ok: false, problem: "Nobody in the segment wants your emails, so nobody would get it." };
  const wanted = audience.emails;
  // The marketing emails the store's plan allows this month (D314): a send that would pass it does not start.
  const allowed = await limitFor(storeId, "marketing_emails_month");
  const room = allowed === null ? Infinity : roomLeft(await usageNow(storeId, "marketing_emails_month"), allowed);
  const result = await db().transaction(async (tx) => {
    const [locked] = await tx.execute<Row>(sql`
      select status from commerce.broadcasts where store_id = ${storeId}::uuid and id = ${id}::uuid for update
    `);
    if (!locked || (locked.status !== "draft" && locked.status !== "scheduled")) return { ok: false as const, problem: "This broadcast was sent already." };
    await tx.execute(sql`
      update commerce.broadcasts set status = 'sending', started_at = now(), audience_words = ${audience.words}, schedule_problem = null
      where id = ${id}::uuid
    `);
    const inserted = await tx.execute<Row>(sql`
      insert into commerce.broadcast_recipients (store_id, broadcast_id, subscriber_id, email, locale, market_code)
      select s.store_id, ${id}::uuid, s.id, lower(s.email), s.locale, s.market_code
      from commerce.marketing_subscribers s
      where s.store_id = ${storeId}::uuid and s.status = 'subscribed'
        ${wanted ? sql`and lower(s.email) in (select jsonb_array_elements_text(${JSON.stringify(wanted)}::jsonb))` : sql``}
      returning subscriber_id
    `);
    if (inserted.length === 0) throw new Nobody();
    if (inserted.length > room) throw new OverLimit();
    await tx.execute(sql`update commerce.broadcasts set recipient_count = ${inserted.length} where id = ${id}::uuid`);
    return { ok: true as const, recipients: inserted.length };
  }).catch((error: unknown) => {
    if (error instanceof Nobody) return { ok: false as const, problem: "Nobody on your list wants your emails yet, so nobody would get it." };
    if (error instanceof OverLimit && allowed !== null) return { ok: false as const, problem: limitRefusal("marketing_emails_month", allowed) };
    throw error;
  });
  if (result.ok) await audit(accountId, storeId, "broadcast.started", { title: broadcast.title, recipients: result.recipients }, { target: { type: "broadcast", id: id } });
  return result;
}

/** Schedules a draft for a later time (at least five minutes from now, at most a year), checked as a send is, except the audience. */
export async function scheduleBroadcast(storeId: string, accountId: string, id: string, when: Date): Promise<StartResult> {
  const now = Date.now();
  if (!(when.getTime() >= now + 5 * 60_000)) return { ok: false, problem: "Choose a time at least five minutes from now." };
  if (when.getTime() > now + 366 * 86_400_000) return { ok: false, problem: "Choose a time within a year." };
  const [store, broadcast] = await Promise.all([storeById(storeId), getBroadcast(storeId, id)]);
  if (!store || !broadcast) return { ok: false, problem: "Unknown broadcast." };
  const notReady = await readiness(store, broadcast);
  if (notReady) return { ok: false, problem: notReady };
  const audience = await audienceOf(store, broadcast);
  if ("problem" in audience) return { ok: false, problem: audience.problem };
  const rows = await db().execute<Row>(sql`
    update commerce.broadcasts set status = 'scheduled', scheduled_for = ${when.toISOString()}::timestamptz, schedule_problem = null
    where store_id = ${storeId}::uuid and id = ${id}::uuid and status in ('draft', 'scheduled')
    returning id
  `);
  if (rows.length === 0) return { ok: false, problem: "This broadcast was sent already." };
  await audit(accountId, storeId, "broadcast.scheduled", { title: broadcast.title, at: when.toISOString() }, { target: { type: "broadcast", id: id } });
  return { ok: true, recipients: 0 };
}

export async function unscheduleBroadcast(storeId: string, accountId: string, id: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    update commerce.broadcasts set status = 'draft' where store_id = ${storeId}::uuid and id = ${id}::uuid and status = 'scheduled' returning title
  `);
  if (rows.length === 0) return false;
  await audit(accountId, storeId, "broadcast.unscheduled", { title: String(rows[0].title) }, { target: { type: "broadcast", id: id } });
  return true;
}

/** Stops a send: the addresses not yet sent are skipped. A batch already handed to the email service may still arrive. */
export async function stopBroadcast(storeId: string, accountId: string | null, id: string, reason = "staff"): Promise<boolean> {
  const stopped = await db().transaction(async (tx) => {
    const rows = await tx.execute<Row>(sql`
      update commerce.broadcasts set status = 'cancelled', finished_at = now()
      where store_id = ${storeId}::uuid and id = ${id}::uuid and status = 'sending' returning title
    `);
    if (rows.length === 0) return null;
    await tx.execute(sql`
      update commerce.broadcast_recipients set status = 'skipped', skip_reason = 'stopped'
      where broadcast_id = ${id}::uuid and status = 'queued'
    `);
    return String(rows[0].title);
  });
  if (stopped === null) return false;
  await audit(accountId, storeId, "broadcast.stopped", { title: stopped, reason }, { target: { type: "broadcast", id: id } });
  return true;
}

// ---------------------------------------------------------------------------
// Sending (5.3)
// ---------------------------------------------------------------------------

/** A run claims at most this many recipients in all, and stops claiming after its time. */
const RUN_MAX = 3000;
const RUN_MS = 40_000;
/** Between two calls to the batch endpoint, so a run stays under the email service's rate. */
const PACE_MS = 600;
/** A recipient whose email failed to go for this long is failed, not tried again. */
const GIVE_UP_HOURS = 24;

export type RunResult = { started: number; returned: number; stopped: number; sent: number; skipped: number; failed: number; finished: number };

type Claimed = {
  storeId: string;
  broadcastId: string;
  subscriberId: string;
  email: string;
  locale: string;
  marketCode: string | null;
  status: string;
  token: string;
};

/**
 * Scheduled sends whose time has come are started, sends of stores no longer open are stopped, and queued recipients are sent a batch at a time
 * within the run's time (never throws). `only` limits it to one broadcast (the press that started it, from `after()`).
 */
export async function runBroadcasts(options: { only?: string; deadline?: number; pace?: number; fetcher?: typeof fetch } = {}): Promise<RunResult> {
  const result: RunResult = { started: 0, returned: 0, stopped: 0, sent: 0, skipped: 0, failed: 0, finished: 0 };
  const deadline = options.deadline ?? Date.now() + RUN_MS;
  try {
    if (!options.only) await startDue(result);
    if (!options.only) await stopClosed(result);
    let claimed = 0;
    const stores = new Map<string, EmailStore | null>();
    const broadcasts = new Map<string, Broadcast | null>();
    while (claimed < RUN_MAX && Date.now() < deadline) {
      const batch = await claim(options.only ?? null, Math.min(BATCH_MAX, RUN_MAX - claimed));
      if (batch.length === 0) break;
      claimed += batch.length;
      await sendBatch(batch, stores, broadcasts, result, options.fetcher);
      if (Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, options.pace ?? PACE_MS));
    }
    result.finished = await finishDone(options.only ?? null);
  } catch (error) {
    console.error("[broadcasts] run failed", error);
  }
  return result;
}

async function startDue(result: RunResult) {
  const due = await db().execute<Row>(sql`
    select id, store_id from commerce.broadcasts where status = 'scheduled' and scheduled_for <= now() order by scheduled_for limit 10
  `);
  for (const row of due) {
    const started = await startBroadcast(String(row.store_id), null, String(row.id)).catch(() => ({ ok: false as const, problem: "It could not be started." }));
    if (started.ok) {
      result.started += 1;
      continue;
    }
    await db().execute(sql`
      update commerce.broadcasts set status = 'draft', schedule_problem = ${started.problem}
      where id = ${String(row.id)}::uuid and status = 'scheduled'
    `);
    result.returned += 1;
  }
}

async function stopClosed(result: RunResult) {
  const rows = await db().execute<Row>(sql`
    select b.id, b.store_id from commerce.broadcasts b where b.status = 'sending' and not commerce.store_is_active(b.store_id)
  `);
  for (const row of rows) if (await stopBroadcast(String(row.store_id), null, String(row.id), "store_closed")) result.stopped += 1;
}

async function claim(only: string | null, limit: number): Promise<Claimed[]> {
  const rows = await db().execute<Row>(sql`
    with picked as (
      select r.broadcast_id, r.subscriber_id
      from commerce.broadcast_recipients r
      join commerce.broadcasts b on b.id = r.broadcast_id and b.store_id = r.store_id and b.status = 'sending'
      where r.status = 'queued' and (r.claimed_until is null or r.claimed_until < now())
        ${only ? sql`and r.broadcast_id = ${only}::uuid` : sql``}
      order by b.started_at, r.created_at, r.subscriber_id
      limit ${limit}
      for update of r skip locked
    )
    update commerce.broadcast_recipients r set claimed_until = now() + interval '2 minutes'
    from picked, commerce.marketing_subscribers s
    where r.broadcast_id = picked.broadcast_id and r.subscriber_id = picked.subscriber_id
      and s.store_id = r.store_id and s.id = r.subscriber_id
    returning r.store_id, r.broadcast_id, r.subscriber_id, r.email, r.locale, r.market_code, s.status, s.token
  `);
  return rows.map((row) => ({
    storeId: String(row.store_id),
    broadcastId: String(row.broadcast_id),
    subscriberId: String(row.subscriber_id),
    email: String(row.email),
    locale: String(row.locale),
    marketCode: row.market_code ? String(row.market_code) : null,
    status: String(row.status),
    token: String(row.token),
  }));
}

const keyOf = (r: Pick<Claimed, "broadcastId" | "subscriberId">) => `broadcast:${r.broadcastId}:${r.subscriberId}`;

async function markRecipient(r: Claimed, status: "sent" | "failed" | "skipped", messageId: string | null, skip: string | null = null) {
  await db().execute(sql`
    update commerce.broadcast_recipients set status = ${status}, email_message_id = ${messageId}::uuid, skip_reason = ${skip},
      sent_at = ${status === "sent" ? sql`now()` : sql`null`}, claimed_until = null
    where broadcast_id = ${r.broadcastId}::uuid and subscriber_id = ${r.subscriberId}::uuid and status = 'queued'
  `);
}

async function sendBatch(
  batch: Claimed[],
  stores: Map<string, EmailStore | null>,
  broadcasts: Map<string, Broadcast | null>,
  result: RunResult,
  fetcher?: typeof fetch,
) {
  const toSend: { r: Claimed; id: string; store: EmailStore; email: Rendered }[] = [];
  // The products and campaigns are read once per broadcast, market and language in a batch (D352).
  const facts = new Map<string, Promise<EmailFacts>>();
  const factsOf = (store: EmailStore, broadcast: Broadcast, r: Claimed) => {
    const key = `${broadcast.id}:${r.marketCode ?? ""}:${r.locale ?? ""}`;
    if (!facts.has(key)) facts.set(key, factsForEmail(store, broadcast.content, r.locale, r.marketCode));
    return facts.get(key)!;
  };
  for (const r of batch) {
    if (r.status !== "subscribed") {
      await markRecipient(r, "skipped", null, "unsubscribed");
      result.skipped += 1;
      continue;
    }
    if (!stores.has(r.storeId)) stores.set(r.storeId, await storeById(r.storeId));
    if (!broadcasts.has(r.broadcastId)) broadcasts.set(r.broadcastId, await getBroadcast(r.storeId, r.broadcastId));
    const store = stores.get(r.storeId);
    const broadcast = broadcasts.get(r.broadcastId);
    const email = store && broadcast ? emailFor(store, broadcast, r.locale, r.marketCode, r.token, await factsOf(store, broadcast, r)) : null;
    if (!store || !email) {
      await markRecipient(r, "failed", null);
      result.failed += 1;
      continue;
    }
    // Kept first, under the recipient's own key: a batch that is tried again finds the same row and never sends twice.
    await db().execute(sql`
      insert into commerce.email_messages (store_id, kind, idempotency_key, to_address, subject, html, text)
      values (${r.storeId}::uuid, 'marketing.broadcast', ${keyOf(r)}, ${r.email}, ${email.subject}, ${email.html}, ${email.text})
      on conflict (idempotency_key) do nothing
    `);
    const [kept] = await db().execute<Row>(sql`
      select id, status, created_at from commerce.email_messages where idempotency_key = ${keyOf(r)}
    `);
    const status = String(kept.status);
    if (status !== "queued" && status !== "failed") {
      await markRecipient(r, "sent", String(kept.id));
      result.sent += 1;
      continue;
    }
    if (status === "failed" && Date.now() - new Date(String(kept.created_at)).getTime() > GIVE_UP_HOURS * 3_600_000) {
      await markRecipient(r, "failed", String(kept.id));
      result.failed += 1;
      continue;
    }
    toSend.push({ r, id: String(kept.id), store, email });
  }
  if (toSend.length === 0) return;

  const settings = emailSettings();
  if (!settings) {
    for (const item of toSend) {
      await db().execute(sql`update commerce.email_messages set status = 'logged' where id = ${item.id}::uuid`);
      await markRecipient(item.r, "sent", item.id);
      result.sent += 1;
    }
    return;
  }
  const deliveries: Delivery[] = await deliverBatch(
    settings,
    toSend.map((item) => ({
      id: item.id,
      message: {
        storeId: item.r.storeId,
        kind: "marketing.broadcast",
        to: item.r.email,
        email: { subject: item.email.subject, html: item.email.html, text: item.email.text },
        fromName: item.store.name,
        replyTo: item.store.details.contactEmail ?? null,
        headers: item.email.headers,
      },
    })),
    fetcher,
  );
  for (const [i, delivery] of deliveries.entries()) {
    const item = toSend[i];
    if (delivery.ok) {
      await db().execute(sql`
        update commerce.email_messages set status = 'sent', provider_reference = ${delivery.id}, sent_at = now(), error = null where id = ${item.id}::uuid
      `);
      await markRecipient(item.r, "sent", item.id);
      result.sent += 1;
    } else {
      await db().execute(sql`update commerce.email_messages set status = 'failed', error = ${delivery.error} where id = ${item.id}::uuid`);
      // Busy or down: left queued, its claim runs out and a later run tries again (the same kept email). Refused: failed.
      if (/^(429|5\d\d)|network|abort|timeout/i.test(delivery.error)) {
        await db().execute(sql`
          update commerce.broadcast_recipients set claimed_until = now() + interval '4 minutes'
          where broadcast_id = ${item.r.broadcastId}::uuid and subscriber_id = ${item.r.subscriberId}::uuid
        `);
      } else {
        await markRecipient(item.r, "failed", item.id);
        result.failed += 1;
      }
    }
  }
}

async function finishDone(only: string | null): Promise<number> {
  const rows = await db().execute<Row>(sql`
    update commerce.broadcasts b set status = 'sent', finished_at = now()
    where b.status = 'sending' ${only ? sql`and b.id = ${only}::uuid` : sql``}
      and not exists (select 1 from commerce.broadcast_recipients r where r.broadcast_id = b.id and r.status = 'queued')
    returning id
  `);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Clicks (5.5) and the report (5.6)
// ---------------------------------------------------------------------------

/** The address a link of a sent broadcast goes to, counting the press; null when there is no such link. Nothing of the person is kept. */
export async function recordClick(broadcastId: string, key: string, marketSlug: string | null): Promise<string | null> {
  if (!z.uuid().safeParse(broadcastId).success || key.length > 20) return null;
  const [row] = await db().execute<Row>(sql`
    select store_id, content from commerce.broadcasts where id = ${broadcastId}::uuid and status in ('sending', 'sent', 'cancelled')
  `);
  if (!row) return null;
  const content = broadcastContentSchema.safeParse(row.content);
  if (!content.success) return null;
  const target = linkTarget(content.data, key);
  if (!target) return null;
  const store = await storeById(String(row.store_id));
  if (!store) return null;
  const market = marketSlug && store.markets.some((m) => m.code.toLowerCase() === marketSlug) ? marketSlug : marketSlugFor(store, null);
  await db().execute(sql`
    insert into commerce.broadcast_link_clicks (store_id, broadcast_id, link, clicks) values (${String(row.store_id)}::uuid, ${broadcastId}::uuid, ${key}, 1)
    on conflict (broadcast_id, link) do update set clicks = commerce.broadcast_link_clicks.clicks + 1
  `);
  return resolverFor(store, market)(target);
}

export type BroadcastReport = {
  counts: BroadcastCounts & { logged: number };
  links: { key: string; locale: string; label: string; url: string; clicks: number }[];
  /** The figures are the ones frozen when the recipients were removed. */
  frozen: boolean;
};

async function countRecipients(storeId: string, id: string): Promise<BroadcastCounts & { logged: number }> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as recipients,
      count(*) filter (where r.status = 'queued')::int as queued,
      count(*) filter (where r.status = 'skipped')::int as skipped,
      count(*) filter (where r.status = 'failed' or (r.status = 'sent' and e.status = 'failed'))::int as failed,
      count(*) filter (where r.status = 'sent' and e.status in ('sent', 'delivered', 'bounced', 'complained'))::int as sent,
      count(*) filter (where r.status = 'sent' and e.status = 'logged')::int as logged,
      count(*) filter (where e.status = 'delivered')::int as delivered,
      count(*) filter (where e.status = 'bounced')::int as bounced,
      count(*) filter (where e.status = 'complained')::int as complained,
      count(*) filter (where s.status = 'unsubscribed' and s.unsubscribed_at >= b.started_at)::int as unsubscribed
    from commerce.broadcast_recipients r
    join commerce.broadcasts b on b.id = r.broadcast_id
    left join commerce.email_messages e on e.id = r.email_message_id
    left join commerce.marketing_subscribers s on s.store_id = r.store_id and s.id = r.subscriber_id
    where r.store_id = ${storeId}::uuid and r.broadcast_id = ${id}::uuid
  `);
  const n = (key: string) => Number(row?.[key] ?? 0);
  return {
    recipients: n("recipients"),
    queued: n("queued"),
    sent: n("sent"),
    logged: n("logged"),
    delivered: n("delivered"),
    bounced: n("bounced"),
    complained: n("complained"),
    failed: n("failed"),
    skipped: n("skipped"),
    unsubscribed: n("unsubscribed"),
  };
}

export async function broadcastReport(storeId: string, broadcast: Broadcast): Promise<BroadcastReport> {
  const [[stored], clicks] = await Promise.all([
    db().execute<Row>(sql`select counts from commerce.broadcasts where store_id = ${storeId}::uuid and id = ${broadcast.id}::uuid`),
    db().execute<Row>(sql`select link, clicks from commerce.broadcast_link_clicks where store_id = ${storeId}::uuid and broadcast_id = ${broadcast.id}::uuid`),
  ]);
  const frozen = Boolean(stored?.counts);
  const counts = frozen ? { ...emptyCounts(), logged: 0, ...(stored.counts as Partial<BroadcastCounts & { logged: number }>) } : await countRecipients(storeId, broadcast.id);
  const pressed = new Map(clicks.map((c) => [String(c.link), Number(c.clicks)]));
  return { counts, frozen, links: linksOf(broadcast.content).map((link) => ({ ...link, clicks: pressed.get(link.key) ?? 0 })) };
}

/** Daily: the recipients of sends that ended more than 90 days ago are removed, their figures kept on the broadcast (5.6). */
export async function pruneBroadcastRecipients(): Promise<number> {
  const due = await db().execute<Row>(sql`
    select id, store_id from commerce.broadcasts
    where status in ('sent', 'cancelled') and counts is null and finished_at < now() - make_interval(days => ${RECIPIENTS_KEEP_DAYS})
    limit 50
  `);
  for (const row of due) {
    const storeId = String(row.store_id);
    const id = String(row.id);
    const counts = await countRecipients(storeId, id);
    await db().transaction(async (tx) => {
      await tx.execute(sql`update commerce.broadcasts set counts = ${JSON.stringify(counts)}::jsonb where id = ${id}::uuid`);
      await tx.execute(sql`delete from commerce.broadcast_recipients where broadcast_id = ${id}::uuid`);
    });
  }
  return due.length;
}

// ---------------------------------------------------------------------------
// Written with AI (5.7)
// ---------------------------------------------------------------------------

export type SuggestResult = { ok: true; suggestion: BroadcastSuggestion } | { ok: false; problem: string };

const LANGUAGE_NAMES: Record<string, string> = { nb: "Norwegian (Bokmål)", nn: "Norwegian (Nynorsk)", sv: "Swedish", da: "Danish", en: "English", de: "German", fi: "Finnish", fr: "French", nl: "Dutch", es: "Spanish", it: "Italian", pl: "Polish" };

/** At most this many rounds of tools before the writer must answer. */
const WRITER_ROUNDS = 4;

const WRITER_TOOLS: ToolDefinition[] = [
  {
    name: "find_products",
    description:
      "The shop's products offered to these readers: id, title, whether it has a picture, its price as the shop shows it, a short summary. Words find products by keyword; without words, or when none match, the newest. To show a product in the email, put its id in your answer's products: the email then shows its picture, price and link itself.",
    parameters: { type: "object", properties: { words: { type: "string", description: "Words to find products by, such as 'wool socks'." } } },
  },
  {
    name: "running_campaigns",
    description:
      "The shop's campaigns running now: id, name, its offer in the shop's own words, when it ends and what it reaches. To show one in the email, put its id in your answer's campaigns: the email then states the offer itself.",
    parameters: { type: "object", properties: {} },
  },
];

/**
 * A suggestion for the editor, never saved or sent (D297, D352): from the staff's few words, the store's name, the segment it is for (its
 * description, never its people) and the store's own facts the writer asks for through two read-only tools (`find_products`,
 * `running_campaigns`, read in the store's own country and the email's language). The model writes words and chooses products and
 * campaigns by id; `keepHanded()` keeps only those its tools handed it, and code draws them into each email. Every text passes the claims
 * filter and the brand's words to avoid.
 */
export async function suggestBroadcast(
  store: EmailStore,
  accountId: string,
  brief: string,
  locale: string,
  options: { segmentId?: string | null; complete?: typeof chatWithTools } = {},
): Promise<SuggestResult> {
  const words = brief.trim().slice(0, 1000);
  if (words.length < 5) return { ok: false, problem: "Say in a few words what the email is about." };
  const connection = await aiFor(store.id, { feature: "marketing_email", accountId });
  if (!connection?.textModel) return { ok: false, problem: "No AI with a text model is set up for this store." };
  const language = LANGUAGE_NAMES[locale.slice(0, 2)] ?? locale;
  // The brand guides the words (D330 F2b); its words to avoid are refused as claims are.
  const brand = await brandOf(store.id);
  const guide = brandGuide(brand);
  const audience = await audienceWords(store, options.segmentId ?? null);
  const market = emailMarket(store, null, locale);
  const handed = { products: new Map<string, { handle: string; title: string }>(), campaigns: new Map<string, { name: string }>() };
  const runTool = async (name: string, raw: string): Promise<unknown> => {
    if (!market) return { error: "The shop sells in no country yet." };
    if (name === "find_products") {
      let query = "";
      try {
        const args = JSON.parse(raw || "{}") as { words?: unknown };
        query = typeof args.words === "string" ? args.words : "";
      } catch {
        query = "";
      }
      const found = await findProductFacts(store, market, query);
      for (const p of found) handed.products.set(p.id, { handle: p.handle, title: p.title });
      return { products: found };
    }
    if (name === "running_campaigns") {
      const found = await campaignFacts(store, market);
      for (const c of found) handed.campaigns.set(c.id, { name: c.name });
      return { campaigns: found };
    }
    return { error: `No tool called ${name}.` };
  };
  const messages: ToolChatMessage[] = [
    {
      role: "system",
      content: [
        `You write a short marketing email for the shop "${store.name}" to people who asked for its news, in ${language}.`,
        audience,
        "Write only from what the shop's staff say it is about and what the tools find_products and running_campaigns return.",
        "To show products or a campaign, put their ids in your answer: the email shows each product's picture, price and link, and each campaign's offer, itself.",
        "So never write a price, a discount, an amount off, a stock level or a delivery time in your words, and never name a product or an offer the tools did not return.",
        "No urgency or scarcity (no 'only today', 'last chance', 'few left'), no best or lowest price claims, no environmental claims such as sustainable or eco-friendly.",
        RULES_STAND,
        UNTRUSTED_TEXT,
        `Plain, warm and short. Answer only with JSON: {"subject": string, "preview": string, "heading": string, "paragraphs": string[] (1 to 3), "button": string (a few words, or empty), "products": string[] (ids, at most ${SUGGEST_PRODUCTS_MAX}, or empty), "campaigns": string[] (ids, at most ${SUGGEST_CAMPAIGNS_MAX}, or empty)}.`,
        ...(guide ? [`\n\n${guide}`] : []),
      ].join(" "),
    },
    { role: "user", content: `<staff-words>${words.replace(/</g, "‹")}</staff-words>` },
  ];
  const chat = options.complete ?? chatWithTools;
  try {
    let answer: string | null = null;
    for (let round = 0; round < WRITER_ROUNDS && answer === null; round++) {
      const last = round === WRITER_ROUNDS - 1;
      const reply = await chat(connection, messages, last ? [] : WRITER_TOOLS, { maxTokens: 1200, timeoutMs: 45_000 });
      if (reply.toolCalls.length === 0 || last) {
        answer = reply.content;
        break;
      }
      messages.push({ role: "assistant", content: reply.content, tool_calls: reply.toolCalls });
      for (const call of reply.toolCalls.slice(0, 4)) {
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(await runTool(call.function.name, call.function.arguments)) });
      }
      for (const call of reply.toolCalls.slice(4)) messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ error: "Ask for at most four at a time." }) });
    }
    const draft = answer ? parseSuggestion(answer) : null;
    if (!draft) return { ok: false, problem: "The AI did not answer with an email. Try again or write it yourself." };
    const suggestion = keepHanded(draft, handed);
    const claims = suggestionClaims(suggestion, brand.avoid);
    if (claims.length > 0) {
      const found = [...new Set(claims.map((c) => `${(c.kind === "avoided" ? AVOIDED_LABEL : CLAIM_LABELS[c.kind]).toLowerCase()} ("${c.phrase}")`))].join(", ");
      return { ok: false, problem: `The suggestion made claims we do not let AI make: ${found}. Try again, or write it yourself.` };
    }
    return { ok: true, suggestion };
  } catch (error) {
    if (error instanceof AiError) return { ok: false, problem: "The AI did not answer. Try again in a moment." };
    throw error;
  }
}

/** Who the email is for, in words for the writer (D352): the segment's name and rules, never its people; everyone on the list without one. */
async function audienceWords(store: EmailStore, segmentId: string | null): Promise<string> {
  const segment = segmentId ? await getSegment(store.id, segmentId) : null;
  if (!segment?.rules) return "It goes to everyone on the shop's list.";
  const tiers = await listTiers(store.id);
  const money = (minor: number) => formatMoney(minor, mainCurrency(store), store.localization.locales[0] ?? "en-GB");
  const rules = describeRules(segment.rules, { money, groupName: (gid) => tiers.find((x) => x.id === gid)?.name });
  return `It goes to the segment "${segment.name.replace(/[<>]/g, "")}": ${rules}. Write for them.`;
}
