import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { roomLeft } from "@/lib/limits";
import { starterContent } from "@/lib/automation-starters";
import {
  AUTOMATION_BATCH,
  AUTOMATION_KINDS,
  automationInput,
  CATCH_UP_DAYS,
  DELAY_RANGES,
  LIFECYCLE_KINDS,
  SENDS_KEEP_DAYS,
  type AutomationKind,
  type LifecycleKind,
} from "@/lib/automations";
import { broadcastContentSchema, sendProblems, type BroadcastContent } from "@/lib/broadcasts";

import { limitFor, usageNow } from "./limits";
import { PAID } from "./analytics-sql";
import { audit } from "./auth";
import { sendEmail, type SendOutcome } from "./email";
import { log } from "./log";
import { emailPictureProblem, factsForEmail, marketingEmail } from "./marketing-email";
import { storeById, type EmailStore } from "./shopper-emails";
import { runBackInStock, type BackInStockResult } from "./stock-requests";

type Row = Record<string, unknown>;

/**
 * Automations (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6): the only writer of `commerce.automations` and `automation_sends`. Three
 * lifecycle emails to addresses on the list that are `subscribed` (welcome, after a purchase, win-back), each once per person and trigger, and the
 * back-in-stock switch (`stock-requests.ts` keeps the requests). Only what happens after an automation was switched on starts an email.
 */

export type Automation = {
  kind: AutomationKind;
  enabled: boolean;
  enabledAt: string | null;
  /** Null for back in stock. */
  delayDays: number | null;
  /** The saved words, or the starters while it was never saved; null for back in stock. */
  content: BroadcastContent | null;
  /** It has a row: it was saved at least once. */
  saved: boolean;
};

const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);

function unsaved(kind: AutomationKind, store: Pick<EmailStore, "localization">): Automation {
  const lifecycle = kind !== "back_in_stock";
  return {
    kind,
    enabled: false,
    enabledAt: null,
    delayDays: lifecycle ? DELAY_RANGES[kind].start : null,
    content: lifecycle ? starterContent(kind, store.localization.locales) : null,
    saved: false,
  };
}

function toAutomation(row: Row): Automation {
  const content = row.content === null ? null : broadcastContentSchema.safeParse(row.content);
  return {
    kind: row.kind as AutomationKind,
    enabled: Boolean(row.enabled),
    enabledAt: iso(row.enabled_at),
    delayDays: row.delay_days === null ? null : Number(row.delay_days),
    content: content === null ? null : content.success ? content.data : {},
    saved: true,
  };
}

/** Every kind, saved or as it starts. */
export async function getAutomations(store: Pick<EmailStore, "id" | "localization">): Promise<Record<AutomationKind, Automation>> {
  const rows = await db().execute<Row>(sql`select kind, enabled, enabled_at, delay_days, content from commerce.automations where store_id = ${store.id}::uuid`);
  const saved = new Map(rows.map((r) => [String(r.kind), toAutomation(r)]));
  return Object.fromEntries(AUTOMATION_KINDS.map((kind) => [kind, saved.get(kind) ?? unsaved(kind, store)])) as Record<AutomationKind, Automation>;
}

export async function getAutomation(store: Pick<EmailStore, "id" | "localization">, kind: AutomationKind): Promise<Automation> {
  return (await getAutomations(store))[kind];
}

export type AutomationResult = { ok: true } | { ok: false; problem: string };

/** Saves a lifecycle automation's days and words (`marketing:write`); an automation that is on stays on only with words it can send. */
export async function saveAutomation(store: Pick<EmailStore, "id" | "localization">, accountId: string, kind: LifecycleKind, input: unknown): Promise<AutomationResult> {
  const parsed = automationInput(kind).safeParse(input);
  if (!parsed.success) {
    const range = DELAY_RANGES[kind];
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "delayDays") return { ok: false, problem: `The days must be a whole number from ${range.min} to ${range.max}.` };
    return { ok: false, problem: issue?.message ?? "Something is not filled in." };
  }
  const kept = new Set(store.localization.keptLocales);
  const content = Object.fromEntries(Object.entries(parsed.data.content).filter(([locale]) => kept.has(locale)));
  const picture = await emailPictureProblem(store.id, content);
  if (picture) return { ok: false, problem: picture };
  const current = await getAutomation(store, kind);
  const problems = sendProblems(content, store.localization.locales[0]);
  if (current.enabled && problems.length > 0) return { ok: false, problem: `It is on, so it needs words it can send: ${problems[0]}` };
  await db().execute(sql`
    insert into commerce.automations (store_id, kind, delay_days, content, updated_by)
    values (${store.id}::uuid, ${kind}, ${parsed.data.delayDays}, ${JSON.stringify(content)}::jsonb, ${accountId}::uuid)
    on conflict (store_id, kind) do update set delay_days = excluded.delay_days, content = excluded.content, updated_by = excluded.updated_by
  `);
  await audit(accountId, store.id, "marketing_automation.saved", { kind, delayDays: parsed.data.delayDays }, { target: { type: "automation", id: kind } });
  return { ok: true };
}

/** Switches an automation on or off (`marketing:write`). On sets `enabled_at` to now: what happened before starts nothing. */
export async function switchAutomation(store: Pick<EmailStore, "id" | "localization">, accountId: string, kind: AutomationKind, on: boolean): Promise<AutomationResult> {
  const current = await getAutomation(store, kind);
  if (on && kind !== "back_in_stock") {
    const problems = sendProblems(current.content ?? {}, store.localization.locales[0]);
    if (!current.saved) return { ok: false, problem: "Save its words first." };
    if (problems.length > 0) return { ok: false, problem: problems[0] };
  }
  const lifecycle = kind !== "back_in_stock";
  await db().execute(sql`
    insert into commerce.automations (store_id, kind, enabled, enabled_at, delay_days, content, updated_by)
    values (
      ${store.id}::uuid, ${kind}, ${on}, case when ${on} then now() end,
      ${lifecycle ? current.delayDays : null}, ${lifecycle ? JSON.stringify(current.content ?? {}) : null}::jsonb, ${accountId}::uuid
    )
    on conflict (store_id, kind) do update set
      enabled = excluded.enabled,
      enabled_at = case when excluded.enabled and commerce.automations.enabled then commerce.automations.enabled_at else excluded.enabled_at end,
      updated_by = excluded.updated_by
  `);
  await audit(accountId, store.id, "marketing_automation.switched", { kind, on }, { target: { type: "automation", id: kind } });
  return { ok: true };
}

/** A test to the staff member's own address, in a language they choose; it counts nowhere. */
export async function sendTestAutomation(storeId: string, to: string, kind: LifecycleKind, locale: string): Promise<SendOutcome | "empty"> {
  const store = await storeById(storeId);
  if (!store) return "failed";
  const automation = await getAutomation(store, kind);
  const content = automation.content?.[locale];
  if (!content?.subject || content.blocks.length === 0) return "empty";
  const email = marketingEmail({ store, content: { [locale]: content }, locale, marketCode: null, token: null, facts: await factsForEmail(store, { [locale]: content }, locale, null) });
  if (!email) return "empty";
  return sendEmail({ storeId, kind: "marketing.automation.test", to, email: { ...email, subject: `[Test] ${email.subject}` }, fromName: store.name, replyTo: store.details.contactEmail ?? null });
}

/** How many each kind sent in the last 30 days (6.6), and how many back-in-stock requests wait, per store. */
export async function automationStats(storeId: string): Promise<{ sent: Record<LifecycleKind, number>; waiting: number; topWaiting: { productId: string; title: string; waiting: number }[] }> {
  const [sends, [waiting], top] = await Promise.all([
    db().execute<Row>(sql`
      select kind, count(*)::int as n from commerce.automation_sends
      where store_id = ${storeId}::uuid and created_at > now() - interval '30 days' and outcome in ('sent', 'logged')
      group by kind
    `),
    db().execute<Row>(sql`select count(*)::int as n from commerce.stock_requests where store_id = ${storeId}::uuid and status = 'waiting'`),
    db().execute<Row>(sql`
      select r.product_id, count(*)::int as n,
        coalesce((select t.title from commerce.product_translations t join commerce.stores s on s.id = t.store_id
                  where t.store_id = r.store_id and t.product_id = r.product_id order by t.locale = s.locales[1] desc, t.locale limit 1), '') as title
      from commerce.stock_requests r
      where r.store_id = ${storeId}::uuid and r.status = 'waiting'
      group by r.store_id, r.product_id order by n desc limit 5
    `),
  ]);
  const sent = Object.fromEntries(LIFECYCLE_KINDS.map((k) => [k, 0])) as Record<LifecycleKind, number>;
  for (const row of sends) sent[row.kind as LifecycleKind] = Number(row.n);
  return {
    sent,
    waiting: Number(waiting?.n ?? 0),
    topWaiting: top.map((r) => ({ productId: String(r.product_id), title: String(r.title), waiting: Number(r.n) })),
  };
}

// ---------------------------------------------------------------------------
// The runner (6.2)
// ---------------------------------------------------------------------------

type Due = { key: string; subscriberId: string; email: string; locale: string; marketCode: string | null; token: string; orderId: string | null };

/** The stores with a lifecycle automation on, open and real (never a store template). */
async function enabledLifecycles(only?: string): Promise<{ storeId: string; kind: LifecycleKind; delayDays: number; enabledAt: string; content: unknown }[]> {
  const rows = await db().execute<Row>(sql`
    select a.store_id, a.kind, a.delay_days, a.enabled_at, a.content
    from commerce.automations a join commerce.stores s on s.id = a.store_id
    where a.enabled and a.kind <> 'back_in_stock' and commerce.store_is_active(a.store_id) and not (s.is_template or s.starter)
      and (${only ?? null}::uuid is null or a.store_id = ${only ?? null}::uuid)
    order by a.store_id, a.kind
  `);
  return rows.map((r) => ({ storeId: String(r.store_id), kind: r.kind as LifecycleKind, delayDays: Number(r.delay_days), enabledAt: String(r.enabled_at), content: r.content }));
}

const SUBSCRIBER_COLUMNS = sql`m.id as subscriber_id, m.email, m.locale, m.market_code, m.token`;
/** A moment that starts an email: after the switch, at least the delay ago, within the catch-up window. */
const inWindow = (moment: ReturnType<typeof sql>, enabledAt: string, delayDays: number, now: Date) => sql`(
  ${moment} >= ${enabledAt}::timestamptz
  and ${moment} <= ${now.toISOString()}::timestamptz - make_interval(days => ${delayDays})
  and ${moment} > ${now.toISOString()}::timestamptz - make_interval(days => ${delayDays + CATCH_UP_DAYS})
)`;
/** A paid order as D152 counts it, still the person's (never restricted or anonymised), not cancelled. */
const SOLD = sql`(${PAID} and o.status in ('paid', 'fulfilled', 'closed') and o.restricted_at is null and o.anonymised_at is null)`;

async function dueFor(storeId: string, kind: LifecycleKind, enabledAt: string, delayDays: number, now: Date): Promise<Due[]> {
  let rows: Row[];
  if (kind === "welcome") {
    const moment = sql`coalesce(m.confirmed_at, m.consented_at)`;
    rows = await db().execute<Row>(sql`
      select ${SUBSCRIBER_COLUMNS}, null::uuid as order_id, 'welcome:' || m.id as key
      from commerce.marketing_subscribers m
      where m.store_id = ${storeId}::uuid and m.status = 'subscribed' and ${inWindow(moment, enabledAt, delayDays, now)}
        and not exists (select 1 from commerce.automation_sends x where x.store_id = m.store_id and x.key = 'welcome:' || m.id)
      order by ${moment} limit ${AUTOMATION_BATCH}
    `);
  } else if (kind === "after_purchase") {
    rows = await db().execute<Row>(sql`
      select ${SUBSCRIBER_COLUMNS}, o.id as order_id, 'after_purchase:' || o.id as key
      from commerce.orders o
      join commerce.marketing_subscribers m on m.store_id = o.store_id and lower(m.email) = lower(o.email) and m.status = 'subscribed'
      where o.store_id = ${storeId}::uuid and ${SOLD} and o.delivered_at is not null and ${inWindow(sql`o.delivered_at`, enabledAt, delayDays, now)}
        and not exists (select 1 from commerce.automation_sends x where x.store_id = o.store_id and x.key = 'after_purchase:' || o.id)
      order by o.delivered_at limit ${AUTOMATION_BATCH}
    `);
  } else {
    // An address's latest paid order whose lapse (its time plus the days) falls in the window; a later paid order by the address means no lapse.
    const lapse = sql`(l.placed_at + make_interval(days => ${delayDays}))`;
    rows = await db().execute<Row>(sql`
      select distinct on (m.id) ${SUBSCRIBER_COLUMNS}, l.id as order_id, 'win_back:' || m.id || ':' || l.id as key
      from commerce.orders l
      join commerce.marketing_subscribers m on m.store_id = l.store_id and lower(m.email) = lower(l.email) and m.status = 'subscribed'
      where l.store_id = ${storeId}::uuid and l.restricted_at is null
        and l.placed_at <= ${now.toISOString()}::timestamptz - make_interval(days => ${delayDays})
        and ${lapse} >= ${enabledAt}::timestamptz
        and ${lapse} > ${now.toISOString()}::timestamptz - make_interval(days => ${CATCH_UP_DAYS})
        and exists (select 1 from commerce.orders o where o.store_id = l.store_id and o.id = l.id and ${SOLD})
        and not exists (select 1 from commerce.orders o where o.store_id = l.store_id and lower(o.email) = lower(l.email) and o.placed_at > l.placed_at and ${SOLD})
        and not exists (select 1 from commerce.automation_sends x where x.store_id = m.store_id and x.key = 'win_back:' || m.id || ':' || l.id)
      order by m.id, l.placed_at desc
      limit ${AUTOMATION_BATCH}
    `);
  }
  return rows.map((r) => ({
    key: String(r.key),
    subscriberId: String(r.subscriber_id),
    email: String(r.email),
    locale: String(r.locale),
    marketCode: r.market_code ? String(r.market_code) : null,
    token: String(r.token),
    orderId: r.order_id ? String(r.order_id) : null,
  }));
}

export type AutomationRunResult = { sent: number; failed: number; skipped: number; backInStock: BackInStockResult };

/** One run (the every-minute marketing job and tests): each enabled lifecycle automation's due people, then back in stock. Never throws. */
export async function runAutomations(options: { only?: string; deadline?: number; now?: Date } = {}): Promise<AutomationRunResult> {
  const result: AutomationRunResult = { sent: 0, failed: 0, skipped: 0, backInStock: { sent: 0, failed: 0 } };
  const now = options.now ?? new Date();
  const late = () => options.deadline !== undefined && Date.now() > options.deadline;
  try {
    const stores = new Map<string, EmailStore | null>();
    const rooms = new Map<string, number>();
    for (const automation of await enabledLifecycles(options.only)) {
      if (late()) break;
      const content = broadcastContentSchema.safeParse(automation.content);
      if (!content.success) continue;
      if (!stores.has(automation.storeId)) stores.set(automation.storeId, await storeById(automation.storeId));
      const store = stores.get(automation.storeId);
      if (!store) continue;
      for (const due of await dueFor(automation.storeId, automation.kind, automation.enabledAt, automation.delayDays, now)) {
        if (late()) break;
        // The row first: a key is never sent twice, even by two runs at once.
        const [claimed] = await db().execute<Row>(sql`
          insert into commerce.automation_sends (store_id, key, kind, subscriber_id, order_id)
          values (${automation.storeId}::uuid, ${due.key}, ${automation.kind}, ${due.subscriberId}::uuid, ${due.orderId}::uuid)
          on conflict do nothing returning key
        `);
        if (!claimed) {
          result.skipped++;
          continue;
        }
        // The marketing emails the store's plan allows this month (D314): one that would pass it is not sent, and never later either.
        if (!rooms.has(automation.storeId)) {
          const allowed = await limitFor(automation.storeId, "marketing_emails_month");
          rooms.set(automation.storeId, allowed === null ? Infinity : roomLeft(await usageNow(automation.storeId, "marketing_emails_month", now), allowed));
        }
        if ((rooms.get(automation.storeId) ?? 0) < 1) {
          await db().execute(sql`update commerce.automation_sends set outcome = 'suppressed' where store_id = ${automation.storeId}::uuid and key = ${due.key}`);
          result.skipped++;
          continue;
        }
        rooms.set(automation.storeId, (rooms.get(automation.storeId) ?? 0) - 1);
        const facts = await factsForEmail(store, content.data, due.locale, due.marketCode);
        const email = marketingEmail({ store, content: content.data, locale: due.locale, marketCode: due.marketCode, token: due.token, facts });
        const outcome: SendOutcome = email
          ? await sendEmail({
              storeId: automation.storeId,
              kind: "marketing.automation",
              to: due.email,
              email,
              fromName: store.name,
              replyTo: store.details.contactEmail ?? null,
              idempotencyKey: `automation:${automation.storeId}:${due.key}`,
              headers: email.headers,
            })
          : "failed";
        const kept = outcome === "duplicate" ? "sent" : outcome;
        await db().execute(sql`update commerce.automation_sends set outcome = ${kept} where store_id = ${automation.storeId}::uuid and key = ${due.key}`);
        if (kept === "sent" || kept === "logged") result.sent++;
        else result.failed++;
      }
    }
    if (!late()) result.backInStock = await runBackInStock({ only: options.only, deadline: options.deadline });
  } catch (error) {
    log("error", "automations.run_failed", {}, error);
  }
  return result;
}

/** Daily: sends older than 90 days go (every key's window is long past). */
export async function pruneAutomations(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.automation_sends where created_at < now() - make_interval(days => ${SENDS_KEEP_DAYS}) returning 1
  `);
  return rows.length;
}
