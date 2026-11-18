import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { roomLeft } from "@/lib/limits";
import { starterContent } from "@/lib/automation-starters";
import {
  AUTOMATION_BATCH,
  AUTOMATION_KINDS,
  automationInput,
  CATCH_UP_DAYS,
  DELAY_RANGES,
  FOLLOW_UP_DAYS,
  FOLLOW_UP_POSITIONS,
  followUpInput,
  isPickKind,
  LIFECYCLE_KINDS,
  PICKS_SHOWN,
  SENDS_KEEP_DAYS,
  stepKey,
  withPicks,
  type AutomationKind,
  type FollowUpPosition,
  type LifecycleKind,
  type ProductPick,
  type PickKind,
} from "@/lib/automations";
import { broadcastContentSchema, sendProblems, type BroadcastContent } from "@/lib/broadcasts";

import { limitFor, usageNow } from "./limits";
import { FIRST_KINDS, policyVerdict, type ContactPolicy, type PolicyReason } from "@/lib/contact-policy";
import { nextSendTime } from "@/lib/sms";
import { getContactPolicy, recentContacts } from "./contact-policy";
import { PAID } from "./analytics-sql";
import { orderCredit } from "./order-credit";
import { creditOf } from "@/lib/order-credit";
import { audit } from "./auth";
import { sendEmail, type SendOutcome } from "./email";
import { log } from "./log";
import { emailPictureProblem, factsForEmail, marketingEmail } from "./marketing-email";
import { storeById, type EmailStore } from "./shopper-emails";
import { inStockNow, OFFERED } from "./product-conditions";
import { runBackInStock, type BackInStockResult } from "./stock-requests";
import { PRODUCT_VIEW_DAYS } from "@/lib/automation-kinds";
import { col, typedRows } from "./typed-rows";
import { isPaused } from "./sending-guard";

type Row = Record<string, unknown>;

/**
 * Automations (wave 5 unit D, D298, `docs/wave-5-marketing.md` 6): the only writer of `commerce.automations`, `automation_steps` and
 * `automation_sends`. Lifecycle emails to addresses on the list that are `subscribed` (welcome, after a purchase, win-back, and since D653
 * cross-sell and restock, whose products code chooses for each reader), each once per person and trigger, with up to two follow-ups (D653),
 * and the back-in-stock switch (`stock-requests.ts` keeps the requests). Only what happens after an automation was switched on starts an email.
 */

/** A follow-up (D653): the automation's second or third email, its days after the one before. */
export type FollowUp = { position: FollowUpPosition; delayDays: number; content: BroadcastContent };

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
  /** Its follow-ups in order (D653); none for back in stock. */
  followUps: FollowUp[];
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
    followUps: [],
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
    followUps: [],
  };
}

const STEP_ROW = z.object({ kind: z.enum(LIFECYCLE_KINDS), position: z.union([z.literal(2), z.literal(3)]), delay_days: col.int, content: z.unknown() });

/** The store's follow-ups by kind, in order (D653). */
async function followUpsOf(storeId: string): Promise<Map<LifecycleKind, FollowUp[]>> {
  const rows = await typedRows(
    STEP_ROW,
    sql`select kind, position, delay_days, content from commerce.automation_steps where store_id = ${storeId}::uuid order by kind, position`,
  );
  const out = new Map<LifecycleKind, FollowUp[]>();
  for (const r of rows) {
    const content = broadcastContentSchema.safeParse(r.content);
    out.set(r.kind, [...(out.get(r.kind) ?? []), { position: r.position, delayDays: r.delay_days, content: content.success ? content.data : {} }]);
  }
  return out;
}

/** Every kind, saved or as it starts. */
export async function getAutomations(store: Pick<EmailStore, "id" | "localization">): Promise<Record<AutomationKind, Automation>> {
  const [rows, followUps] = await Promise.all([
    db().execute<Row>(sql`select kind, enabled, enabled_at, delay_days, content from commerce.automations where store_id = ${store.id}::uuid`),
    followUpsOf(store.id),
  ]);
  const saved = new Map(rows.map((r) => [String(r.kind), { ...toAutomation(r), followUps: followUps.get(r.kind as LifecycleKind) ?? [] }]));
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
  // Browse off (D691): the product views kept for it go at once; nothing is kept for an email that will not go.
  if (kind === "browse" && !on) await db().execute(sql`delete from commerce.customer_product_views where store_id = ${store.id}::uuid`);
  await audit(accountId, store.id, "marketing_automation.switched", { kind, on }, { target: { type: "automation", id: kind } });
  return { ok: true };
}

/**
 * Saves a follow-up's days and words (D653, `marketing:write`): `position` null adds the next one (the second email, then the third), else
 * changes that one. The automation must have been saved; one that is on takes only words it can send.
 */
export async function saveFollowUp(
  store: Pick<EmailStore, "id" | "localization">,
  accountId: string,
  kind: LifecycleKind,
  position: FollowUpPosition | null,
  input: unknown,
): Promise<AutomationResult & { position?: FollowUpPosition }> {
  const parsed = followUpInput.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "delayDays") return { ok: false, problem: `The days must be a whole number from ${FOLLOW_UP_DAYS.min} to ${FOLLOW_UP_DAYS.max}.` };
    return { ok: false, problem: issue?.message ?? "Something is not filled in." };
  }
  const kept = new Set(store.localization.keptLocales);
  const content = Object.fromEntries(Object.entries(parsed.data.content).filter(([locale]) => kept.has(locale)));
  const picture = await emailPictureProblem(store.id, content);
  if (picture) return { ok: false, problem: picture };
  const current = await getAutomation(store, kind);
  if (!current.saved) return { ok: false, problem: "Save the first email before adding a second." };
  const at = position ?? FOLLOW_UP_POSITIONS[current.followUps.length];
  if (at === undefined) return { ok: false, problem: "An automation has at most three emails." };
  if (position !== null && !current.followUps.some((f) => f.position === position)) return { ok: false, problem: "That email no longer exists." };
  const problems = sendProblems(content, store.localization.locales[0]);
  if (current.enabled && problems.length > 0) return { ok: false, problem: `It is on, so it needs words it can send: ${problems[0]}` };
  const written = position === null
    ? await db().execute<Row>(sql`
        insert into commerce.automation_steps (store_id, kind, position, delay_days, content, updated_by)
        values (${store.id}::uuid, ${kind}, ${at}, ${parsed.data.delayDays}, ${JSON.stringify(content)}::jsonb, ${accountId}::uuid)
        on conflict do nothing returning position
      `)
    : await db().execute<Row>(sql`
        update commerce.automation_steps set delay_days = ${parsed.data.delayDays}, content = ${JSON.stringify(content)}::jsonb, updated_by = ${accountId}::uuid, updated_at = now()
        where store_id = ${store.id}::uuid and kind = ${kind} and position = ${at} returning position
      `);
  if (written.length === 0) return { ok: false, problem: "Someone else changed the emails just now. Open the automation again." };
  await audit(accountId, store.id, "marketing_automation.follow_up_saved", { kind, position: at, delayDays: parsed.data.delayDays }, { target: { type: "automation", id: kind } });
  return { ok: true, position: at };
}

/** Deletes a follow-up (D653, `marketing:write`); the third becomes the second when the second goes. */
export async function deleteFollowUp(store: Pick<EmailStore, "id">, accountId: string, kind: LifecycleKind, position: FollowUpPosition): Promise<AutomationResult> {
  const gone = await db().transaction(async (tx) => {
    const deleted = await tx.execute<Row>(sql`
      delete from commerce.automation_steps where store_id = ${store.id}::uuid and kind = ${kind} and position = ${position} returning position
    `);
    if (deleted.length > 0 && position === 2) {
      await tx.execute(sql`update commerce.automation_steps set position = 2 where store_id = ${store.id}::uuid and kind = ${kind} and position = 3`);
    }
    return deleted.length > 0;
  });
  if (!gone) return { ok: false, problem: "That email no longer exists." };
  await audit(accountId, store.id, "marketing_automation.follow_up_deleted", { kind, position }, { target: { type: "automation", id: kind } });
  return { ok: true };
}

/** A test of a follow-up to the staff member's own address (D653); it counts nowhere. */
export async function sendTestFollowUp(storeId: string, to: string, kind: LifecycleKind, position: FollowUpPosition, locale: string): Promise<SendOutcome | "empty"> {
  const store = await storeById(storeId);
  if (!store) return "failed";
  const followUp = (await getAutomation(store, kind)).followUps.find((f) => f.position === position);
  return testEmail(store, to, followUp?.content[locale], locale);
}

async function testEmail(store: EmailStore, to: string, content: BroadcastContent[string] | undefined, locale: string): Promise<SendOutcome | "empty"> {
  if (!content?.subject || content.blocks.length === 0) return "empty";
  const email = marketingEmail({ store, content: { [locale]: content }, locale, marketCode: null, token: null, facts: await factsForEmail(store, { [locale]: content }, locale, null) });
  if (!email) return "empty";
  return sendEmail({ storeId: store.id, kind: "marketing.automation.test", to, email: { ...email, subject: `[Test] ${email.subject}` }, fromName: store.name, replyTo: store.details.contactEmail ?? null });
}

/** A test to the staff member's own address, in a language they choose; it counts nowhere. */
export async function sendTestAutomation(storeId: string, to: string, kind: LifecycleKind, locale: string): Promise<SendOutcome | "empty"> {
  const store = await storeById(storeId);
  if (!store) return "failed";
  const automation = await getAutomation(store, kind);
  return testEmail(store, to, automation.content?.[locale], locale);
}

/** What a kind's emails brought in the last 30 days: paid orders their readers placed within `ORDER_AFTER_DAYS`, per currency. */
export type AutomationRevenue = { orders: number; minor: Record<string, number> };

export type AutomationStats = {
  sent: Record<LifecycleKind, number>;
  revenue: Record<LifecycleKind, AutomationRevenue>;
  waiting: number;
  topWaiting: { productId: string; title: string; waiting: number }[];
};

/** A paid order as D152 counts it, still the person's (never restricted or anonymised), not cancelled. */
const SOLD = sql`(${PAID} and o.status in ('paid', 'fulfilled', 'closed') and o.restricted_at is null and o.anonymised_at is null)`;

/**
 * Orders after an automation's emails in the last 30 days, by the one rule for every message (D761, `orderCredit()`): a paid order placed
 * within `ORDER_AFTER_DAYS` of the latest email or text that reached its buyer counts for that one, so an order after a cart reminder and
 * a broadcast is counted once. An order the person would have placed anyway counts too: the figure says what followed, not what it caused.
 */
async function automationRevenue(storeId: string): Promise<Record<LifecycleKind, AutomationRevenue>> {
  const now = new Date();
  const credit = await orderCredit(storeId, new Date(now.getTime() - 30 * 86_400_000), now);
  return Object.fromEntries(LIFECYCLE_KINDS.map((k) => [k, creditOf(credit, `automation:${k}`)])) as Record<LifecycleKind, AutomationRevenue>;
}

/** How many each kind sent in the last 30 days (6.6) and the orders after them, and how many back-in-stock requests wait, per store. */
export async function automationStats(storeId: string): Promise<AutomationStats> {
  const [sends, [waiting], top, revenue] = await Promise.all([
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
    automationRevenue(storeId),
  ]);
  const sent = Object.fromEntries(LIFECYCLE_KINDS.map((k) => [k, 0])) as Record<LifecycleKind, number>;
  for (const row of sends) sent[row.kind as LifecycleKind] = Number(row.n);
  return {
    sent,
    revenue,
    waiting: Number(waiting?.n ?? 0),
    topWaiting: top.map((r) => ({ productId: String(r.product_id), title: String(r.title), waiting: Number(r.n) })),
  };
}

// ---------------------------------------------------------------------------
// The runner (6.2)
// ---------------------------------------------------------------------------

type Due = {
  /** The key of the flow's first email; a follow-up's own key is `stepKey(firstKey, step)`. */
  firstKey: string;
  subscriberId: string;
  email: string;
  locale: string;
  marketCode: string | null;
  token: string;
  orderId: string | null;
};

type Flow = {
  storeId: string;
  kind: LifecycleKind;
  delayDays: number;
  enabledAt: string;
  content: unknown;
  steps: { position: FollowUpPosition; delayDays: number; content: unknown }[];
};

const FLOW_ROW = z.object({
  store_id: col.uuid,
  kind: z.enum(LIFECYCLE_KINDS),
  delay_days: col.int,
  enabled_at: col.timestamp,
  content: z.unknown(),
  steps: z.array(z.object({ position: z.union([z.literal(2), z.literal(3)]), delay_days: z.number().int(), content: z.unknown() })),
});

/** The stores with a lifecycle automation on, open and real (never a store template), each with its follow-ups in order. */
async function enabledLifecycles(only?: string): Promise<Flow[]> {
  const rows = await typedRows(
    FLOW_ROW,
    sql`
      select a.store_id, a.kind, a.delay_days, a.enabled_at, a.content,
        coalesce((
          select jsonb_agg(jsonb_build_object('position', st.position, 'delay_days', st.delay_days, 'content', st.content) order by st.position)
          from commerce.automation_steps st where st.store_id = a.store_id and st.kind = a.kind
        ), '[]'::jsonb) as steps
      from commerce.automations a join commerce.stores s on s.id = a.store_id
      where a.enabled and a.kind <> 'back_in_stock' and commerce.store_is_active(a.store_id) and not (s.is_template or s.starter)
        -- Email automation is a paid extension (D748): a store whose account does not have it sends none of its flows.
        and commerce.extension_on(a.store_id, 'email_automation')
        and (${only ?? null}::uuid is null or a.store_id = ${only ?? null}::uuid)
      order by a.store_id, a.kind
    `,
  );
  return rows.map((r) => ({
    storeId: r.store_id,
    kind: r.kind,
    delayDays: r.delay_days,
    enabledAt: r.enabled_at,
    content: r.content,
    steps: r.steps.map((st) => ({ position: st.position, delayDays: st.delay_days, content: st.content })),
  }));
}

const SUBSCRIBER_COLUMNS = sql`m.id as subscriber_id, m.email, m.locale, m.market_code, m.token`;
/** A moment that starts an email: after the switch, at least the delay ago, within the catch-up window. */
const inWindow = (moment: ReturnType<typeof sql>, enabledAt: string, delayDays: number, now: Date) => sql`(
  ${moment} >= ${enabledAt}::timestamptz
  and ${moment} <= ${now.toISOString()}::timestamptz - make_interval(days => ${delayDays})
  and ${moment} > ${now.toISOString()}::timestamptz - make_interval(days => ${delayDays + CATCH_UP_DAYS})
)`;

/**
 * A product customers buy again (D653, restock): one address placed at least two paid orders with it in the last two years. Checked per
 * product of an order, the restock email's reason to go.
 */
const rebought = (storeId: string, productId: ReturnType<typeof sql>) => sql`exists (
  select 1 from commerce.order_lines rl
  join commerce.product_variants rv on rv.id = rl.variant_id
  join commerce.orders o on o.store_id = rl.store_id and o.id = rl.order_id
  where rl.store_id = ${storeId}::uuid and rv.product_id = ${productId} and not rl.gift
    and o.placed_at > now() - interval '2 years' and ${SOLD}
  group by lower(o.email) having count(distinct o.id) >= 2
)`;

/** A delivered order that starts an after-a-purchase, cross-sell or restock email: its key is `{kind}:{order}`. */
type DeliveredKind = Extract<LifecycleKind, "after_purchase" | "cross_sell" | "replenish">;

async function deliveredDue(storeId: string, which: DeliveredKind, enabledAt: string, delayDays: number, now: Date): Promise<Due[]> {
  const kind: string = which;
  const needs =
    kind === "replenish"
      ? sql`and exists (
          select 1 from commerce.order_lines l join commerce.product_variants v on v.id = l.variant_id
          where l.store_id = o.store_id and l.order_id = o.id and not l.gift and ${rebought(storeId, sql`v.product_id`)}
        )`
      : sql``;
  const rows = await typedRows(
    DUE_ROW,
    sql`
    select ${SUBSCRIBER_COLUMNS}, o.id as order_id, ${kind} || ':' || o.id as key
    from commerce.orders o
    join commerce.marketing_subscribers m on m.store_id = o.store_id and lower(m.email) = lower(o.email) and m.status = 'subscribed'
    where o.store_id = ${storeId}::uuid and ${SOLD} and o.delivered_at is not null and ${inWindow(sql`o.delivered_at`, enabledAt, delayDays, now)}
      ${needs}
      and not exists (select 1 from commerce.automation_sends x where x.store_id = o.store_id and x.key = ${kind} || ':' || o.id)
    order by o.delivered_at limit ${AUTOMATION_BATCH}
  `,
  );
  return rows.map(fromDueRow);
}

async function dueFor(storeId: string, kind: LifecycleKind, enabledAt: string, delayDays: number, now: Date): Promise<Due[]> {
  let rows: z.infer<typeof DUE_ROW>[];
  if (kind === "welcome") {
    const moment = sql`coalesce(m.confirmed_at, m.consented_at)`;
    rows = await typedRows(DUE_ROW, sql`
      select ${SUBSCRIBER_COLUMNS}, null::uuid as order_id, 'welcome:' || m.id as key
      from commerce.marketing_subscribers m
      where m.store_id = ${storeId}::uuid and m.status = 'subscribed' and ${inWindow(moment, enabledAt, delayDays, now)}
        and not exists (select 1 from commerce.automation_sends x where x.store_id = m.store_id and x.key = 'welcome:' || m.id)
      order by ${moment} limit ${AUTOMATION_BATCH}
    `);
  } else if (kind === "browse") {
    return browseDue(storeId, enabledAt, delayDays, now);
  } else if (kind === "after_purchase" || isPickKind(kind)) {
    return deliveredDue(storeId, kind, enabledAt, delayDays, now);
  } else {
    // An address's latest paid order whose lapse (its time plus the days) falls in the window; a later paid order by the address means no lapse.
    const lapse = sql`(l.placed_at + make_interval(days => ${delayDays}))`;
    rows = await typedRows(DUE_ROW, sql`
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
  return rows.map(fromDueRow);
}

/**
 * Browse abandonment's due people (D691): a subscriber whose latest product view (`customer_product_views`, kept only for a signed-in
 * subscriber who allowed marketing cookies) falls in the window, with no paid order since that view and no browse email in the last
 * `PRODUCT_VIEW_DAYS` days. Its key is `browse:{subscriber}:{day of the latest view}`; the products are chosen at sending (`picksFor()`).
 */
async function browseDue(storeId: string, enabledAt: string, delayDays: number, now: Date): Promise<Due[]> {
  const rows = await typedRows(
    DUE_ROW,
    sql`
      select ${SUBSCRIBER_COLUMNS}, null::uuid as order_id, 'browse:' || m.id || ':' || to_char(v.last_at at time zone 'UTC', 'YYYY-MM-DD') as key
      from (
        select cv.customer_id, max(cv.viewed_at) as last_at from commerce.customer_product_views cv where cv.store_id = ${storeId}::uuid group by cv.customer_id
      ) v
      join commerce.customers c on c.store_id = ${storeId}::uuid and c.id = v.customer_id
      join commerce.marketing_subscribers m on m.store_id = c.store_id and lower(m.email) = lower(c.email) and m.status = 'subscribed'
      where ${inWindow(sql`v.last_at`, enabledAt, delayDays, now)}
        and not exists (
          select 1 from commerce.orders o where o.store_id = c.store_id and lower(o.email) = lower(c.email) and o.restricted_at is null and o.placed_at > v.last_at and ${SOLD}
        )
        and not exists (
          select 1 from commerce.automation_sends x where x.store_id = m.store_id and x.kind = 'browse' and x.subscriber_id = m.id
            and x.created_at > ${now.toISOString()}::timestamptz - make_interval(days => ${PRODUCT_VIEW_DAYS})
        )
      order by v.last_at limit ${AUTOMATION_BATCH}
    `,
  );
  return rows.map(fromDueRow);
}

const DUE_ROW = z.object({
  key: z.string(),
  subscriber_id: col.uuid,
  email: z.string(),
  locale: z.string(),
  market_code: z.string().nullable(),
  token: z.string(),
  order_id: col.uuid.nullable(),
});

/**
 * A follow-up's due people (D653): the email before it went to them (sent or logged) at least its days ago, within the catch-up window and
 * after the automation was switched on; they are still subscribed, and have placed no paid order since the flow's first email.
 */
async function followUpsDue(flow: Flow, position: FollowUpPosition, delayDays: number, now: Date): Promise<Due[]> {
  const rows = await typedRows(
    DUE_ROW,
    sql`
      select f.key, ${SUBSCRIBER_COLUMNS}, s.order_id
      from commerce.automation_sends s
      join commerce.automation_sends f on f.store_id = s.store_id and f.key = split_part(s.key, '#', 1)
      join commerce.marketing_subscribers m on m.store_id = s.store_id and m.id = s.subscriber_id and m.status = 'subscribed'
      where s.store_id = ${flow.storeId}::uuid and s.kind = ${flow.kind} and s.step = ${position - 1} and s.outcome in ('sent', 'logged')
        and ${inWindow(sql`s.created_at`, flow.enabledAt, delayDays, now)}
        and not exists (
          select 1 from commerce.orders o
          where o.store_id = s.store_id and lower(o.email) = lower(m.email) and o.restricted_at is null and o.placed_at > f.created_at and ${SOLD}
        )
        and not exists (select 1 from commerce.automation_sends x where x.store_id = s.store_id and x.key = f.key || '#' || ${position})
      order by s.created_at limit ${AUTOMATION_BATCH}
    `,
  );
  return rows.map(fromDueRow);
}

function fromDueRow(r: z.infer<typeof DUE_ROW>): Due {
  return { firstKey: r.key, subscriberId: r.subscriber_id, email: r.email, locale: r.locale, marketCode: r.market_code, token: r.token, orderId: r.order_id };
}

const PICK_ROW = z.object({ id: col.uuid, handle: z.string() });

/**
 * The products one reader's cross-sell or restock email shows (D653), chosen by code, never by a model; each on sale and in stock now.
 * Cross-sell: what other paid orders of the last year had with the order's products, most often first, never what the address has bought.
 * Restock: the order's own products that customers buy again (`rebought`).
 */
export async function picksFor(storeId: string, kind: PickKind, orderId: string | null, email: string): Promise<ProductPick[]> {
  const sellable = sql`p.status = 'active' and ${OFFERED} and ${inStockNow()}`;
  // Browse (D691): the products the reader looked at, newest first, that they have not bought since.
  if (kind === "browse") {
    return typedRows(
      PICK_ROW,
      sql`
        select p.id, p.handle from commerce.customer_product_views cv
        join commerce.customers c on c.store_id = cv.store_id and c.id = cv.customer_id and lower(c.email) = lower(${email})
        join commerce.products p on p.store_id = cv.store_id and p.id = cv.product_id
        where cv.store_id = ${storeId}::uuid and ${sellable}
          and not exists (
            select 1 from commerce.orders o join commerce.order_lines l on l.store_id = o.store_id and l.order_id = o.id
            join commerce.product_variants v on v.id = l.variant_id
            where o.store_id = cv.store_id and lower(o.email) = lower(c.email) and o.restricted_at is null and v.product_id = p.id
              and o.placed_at > cv.viewed_at - interval '1 day' and ${SOLD}
          )
        order by cv.viewed_at desc, p.id limit ${PICKS_SHOWN}
      `,
    );
  }
  if (!orderId) return [];
  const ordered = sql`(select v.product_id from commerce.order_lines l join commerce.product_variants v on v.id = l.variant_id
    where l.store_id = ${storeId}::uuid and l.order_id = ${orderId}::uuid and not l.gift)`;
  if (kind === "replenish") {
    return typedRows(
      PICK_ROW,
      sql`
        select p.id, p.handle from commerce.products p
        where p.store_id = ${storeId}::uuid and p.id in ${ordered} and ${sellable} and ${rebought(storeId, sql`p.id`)}
        order by p.id limit ${PICKS_SHOWN}
      `,
    );
  }
  return typedRows(
    PICK_ROW,
    sql`
      select p.id, p.handle from (
        select v2.product_id, count(distinct o.id) as together
        from commerce.order_lines l1
        join commerce.product_variants v1 on v1.id = l1.variant_id and v1.product_id in ${ordered}
        join commerce.orders o on o.store_id = l1.store_id and o.id = l1.order_id and o.id <> ${orderId}::uuid
          and o.placed_at > now() - interval '1 year' and ${SOLD}
        join commerce.order_lines l2 on l2.store_id = o.store_id and l2.order_id = o.id and not l2.gift
        join commerce.product_variants v2 on v2.id = l2.variant_id and v2.product_id not in ${ordered}
        where l1.store_id = ${storeId}::uuid
        group by v2.product_id
      ) t
      join commerce.products p on p.store_id = ${storeId}::uuid and p.id = t.product_id
      where ${sellable}
        and not exists (
          select 1 from commerce.orders o join commerce.order_lines l on l.store_id = o.store_id and l.order_id = o.id
          join commerce.product_variants v on v.id = l.variant_id
          where o.store_id = ${storeId}::uuid and lower(o.email) = lower(${email}) and o.restricted_at is null and v.product_id = p.id and ${SOLD}
        )
      order by t.together desc, p.id limit ${PICKS_SHOWN}
    `,
  );
}

export type AutomationRunResult = { sent: number; failed: number; skipped: number; backInStock: BackInStockResult };

/**
 * One run (the every-minute marketing job and tests): each enabled lifecycle automation's due people for its first email, then for each
 * follow-up in order, then back in stock. Never throws.
 */
export async function runAutomations(options: { only?: string; deadline?: number; now?: Date } = {}): Promise<AutomationRunResult> {
  const result: AutomationRunResult = { sent: 0, failed: 0, skipped: 0, backInStock: { sent: 0, failed: 0 } };
  const now = options.now ?? new Date();
  const late = () => options.deadline !== undefined && Date.now() > options.deadline;
  const stores = new Map<string, EmailStore | null>();
  const rooms = new Map<string, number>();

  const outcomeOf = (storeId: string, key: string, outcome: SendOutcome | "suppressed", reason: PolicyReason | null = null) =>
    db().execute(sql`update commerce.automation_sends set outcome = ${outcome}, suppressed_reason = ${reason} where store_id = ${storeId}::uuid and key = ${key}`);
  const policies = new Map<string, ContactPolicy>();

  /** One email to one person: the row first (a key is never sent twice, even by two runs at once), the plan's room, the reader's products, then the send. */
  async function sendOne(flow: Flow, store: EmailStore, content: BroadcastContent, step: number, due: Due): Promise<void> {
    // Quiet hours (D764): outside the reader's daytime nothing is claimed, so a later run sends it once their day begins.
    if (!policies.has(flow.storeId)) policies.set(flow.storeId, await getContactPolicy(flow.storeId));
    const policy = policies.get(flow.storeId)!;
    if (policy.quietHours && nextSendTime(now, due.marketCode ?? store.markets[0]?.code ?? "NO").getTime() > now.getTime()) {
      result.skipped++;
      return;
    }
    const key = stepKey(due.firstKey, step);
    const [claimed] = await db().execute<Row>(sql`
      insert into commerce.automation_sends (store_id, key, kind, subscriber_id, order_id, step)
      values (${flow.storeId}::uuid, ${key}, ${flow.kind}, ${due.subscriberId}::uuid, ${due.orderId}::uuid, ${step})
      on conflict do nothing returning key
    `);
    if (!claimed) {
      result.skipped++;
      return;
    }
    // The marketing emails the store's plan allows this month (D314): one that would pass it is not sent, and never later either.
    if (!rooms.has(flow.storeId)) {
      const allowed = await limitFor(flow.storeId, "marketing_emails_month");
      rooms.set(flow.storeId, allowed === null ? Infinity : roomLeft(await usageNow(flow.storeId, "marketing_emails_month", now), allowed));
    }
    if ((rooms.get(flow.storeId) ?? 0) < 1) {
      await outcomeOf(flow.storeId, key, "suppressed");
      result.skipped++;
      return;
    }
    // The contact policy (D764): a welcome goes whatever came before; any other kind is held when the week's cap is reached or the last
    // message was too recent, recorded as suppressed with its reason and never sent later.
    if (!FIRST_KINDS.has(flow.kind)) {
      const [sent] = await recentContacts(flow.storeId, [{ email: due.email, customerId: null }], now);
      const reason = policyVerdict(sent, now, policy, "normal");
      if (reason) {
        await outcomeOf(flow.storeId, key, "suppressed", reason);
        result.skipped++;
        return;
      }
    }
    // A cross-sell or restock email goes only with products for this reader (D653); without any, it never goes.
    let words = content;
    if (isPickKind(flow.kind)) {
      const picks = due.orderId || flow.kind === "browse" ? await picksFor(flow.storeId, flow.kind, due.orderId, due.email) : [];
      if (picks.length === 0) {
        await outcomeOf(flow.storeId, key, "suppressed");
        result.skipped++;
        return;
      }
      words = withPicks(content, picks);
    }
    rooms.set(flow.storeId, (rooms.get(flow.storeId) ?? 0) - 1);
    const facts = await factsForEmail(store, words, due.locale, due.marketCode);
    const email = marketingEmail({ store, content: words, locale: due.locale, marketCode: due.marketCode, token: due.token, facts });
    const outcome: SendOutcome = email
      ? await sendEmail({
          storeId: flow.storeId,
          kind: "marketing.automation",
          to: due.email,
          email,
          fromName: store.name,
          replyTo: store.details.contactEmail ?? null,
          idempotencyKey: `automation:${flow.storeId}:${key}`,
          headers: email.headers,
        })
      : "failed";
    const kept = outcome === "duplicate" ? "sent" : outcome;
    await outcomeOf(flow.storeId, key, kept);
    if (kept === "sent" || kept === "logged") result.sent++;
    else result.failed++;
  }

  try {
    for (const flow of await enabledLifecycles(options.only)) {
      if (late()) break;
      if (!stores.has(flow.storeId)) stores.set(flow.storeId, (await isPaused(flow.storeId)) ? null : await storeById(flow.storeId));
      // A store the sending guard holds (D730) sends nothing; moments within the catch-up days still go once it resumes.
      const store = stores.get(flow.storeId);
      if (!store) continue;
      const emails = [
        { step: 1, content: flow.content, due: () => dueFor(flow.storeId, flow.kind, flow.enabledAt, flow.delayDays, now) },
        ...flow.steps.map((st) => ({ step: st.position as number, content: st.content, due: () => followUpsDue(flow, st.position, st.delayDays, now) })),
      ];
      for (const e of emails) {
        if (late()) break;
        const content = broadcastContentSchema.safeParse(e.content);
        if (!content.success) continue;
        for (const due of await e.due()) {
          if (late()) break;
          await sendOne(flow, store, content.data, e.step, due);
        }
      }
    }
    if (!late()) result.backInStock = await runBackInStock({ only: options.only, deadline: options.deadline });
  } catch (error) {
    log("error", "automations.run_failed", {}, error);
  }
  return result;
}

/** Daily: sends older than 90 days go (every key's window is long past), and product views older than their days (D691). */
export async function pruneAutomations(): Promise<number> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.automation_sends where created_at < now() - make_interval(days => ${SENDS_KEEP_DAYS}) returning 1
  `);
  const { pruneProductViews } = await import("./product-views");
  return rows.length + (await pruneProductViews());
}
