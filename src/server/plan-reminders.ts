import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  buildReminderEmail,
  defaultPlanSteps,
  defaultPlanText,
  reminderStepInput,
  type ReminderLine,
  type ReminderStep,
  type ReminderText,
} from "@/lib/cart-reminders";
import { renderEmail } from "@/lib/email-layout";
import { ON_PLAN_STATUSES } from "@/lib/plans";
import { siteUrl } from "@/lib/site";

import { audit, type Account } from "./auth";
import { sendEmail, type SendOutcome } from "./email";
import type { SaveResult } from "./settings";

type Row = Record<string, unknown>;

/**
 * Kaizen's own reminders to store owners who went to pay for a plan and
 * did not finish (decision D33): the platform's side of the stores' cart
 * reminders. The owner is signed in, so the email is known when they go
 * to pay; the Plan page says a reminder may come, with a way to say no,
 * and every reminder has a link to stop them.
 */

const REMIND_DAYS = 30;
const KEEP_DAYS = 60;
const BATCH = 50;
/** The admin is in English, and so are Kaizen's reminders to owners. */
const LOCALE = "en";

const onPlan = sql.raw(ON_PLAN_STATUSES.map((s) => `'${s}'`).join(", "));

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function toStep(row: Row): ReminderStep {
  return {
    id: String(row.id),
    delayMinutes: Number(row.delay_minutes),
    active: Boolean(row.active),
    discountCodeId: row.platform_discount_id ? String(row.platform_discount_id) : null,
    content: (row.content ?? {}) as Record<string, ReminderText>,
  };
}

export async function getPlanReminderSettings(): Promise<{ enabled: boolean; steps: ReminderStep[] }> {
  const [[settings], steps] = await Promise.all([
    db().execute<Row>(sql`select plan_reminders from commerce.platform_settings`),
    db().execute<Row>(sql`
      select id, delay_minutes, active, platform_discount_id, content from commerce.plan_reminder_steps
      order by delay_minutes, created_at
    `),
  ]);
  return { enabled: Boolean(settings?.plan_reminders), steps: steps.map(toStep) };
}

export async function getPlanReminderStep(id: string): Promise<ReminderStep | null> {
  const [row] = await db().execute<Row>(sql`
    select id, delay_minutes, active, platform_discount_id, content from commerce.plan_reminder_steps where id = ${id}::uuid
  `);
  return row ? toStep(row) : null;
}

/** On, with at least one active reminder. */
export async function planRemindersOn(): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select s.plan_reminders and exists (select 1 from commerce.plan_reminder_steps where active) as on
    from commerce.platform_settings s
  `);
  return Boolean(row?.on);
}

export async function setPlanRemindersEnabled(actor: Account, enabled: boolean): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.execute(sql`update commerce.platform_settings set plan_reminders = ${enabled}, updated_by = ${actor.id}::uuid`);
    if (!enabled) return;
    const [existing] = await tx.execute<Row>(sql`select count(*)::int as n from commerce.plan_reminder_steps`);
    if (Number(existing.n) > 0) return;
    for (const step of defaultPlanSteps()) {
      await tx.execute(sql`
        insert into commerce.plan_reminder_steps (delay_minutes, active, content)
        values (${step.delayMinutes}, true, ${JSON.stringify(step.content)}::jsonb)
      `);
    }
  });
  await audit(actor.id, null, enabled ? "plan_reminders.enabled" : "plan_reminders.disabled", {});
}

export async function savePlanReminderStep(actor: Account, id: string | null, input: unknown): Promise<SaveResult & { id?: string }> {
  const parsed = reminderStepInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const step = parsed.data;
  const text = step.content[LOCALE];
  if (!text) return { ok: false, problems: ["Write the reminder."] };
  const content = { [LOCALE]: text };
  if (step.discountCodeId) {
    const [code] = await db().execute<Row>(sql`select 1 from commerce.platform_discount_codes where id = ${step.discountCodeId}::uuid`);
    if (!code) return { ok: false, problems: ["That discount code no longer exists."] };
  }
  const [row] = id
    ? await db().execute<Row>(sql`
        update commerce.plan_reminder_steps
        set delay_minutes = ${step.delayMinutes}, active = ${step.active}, platform_discount_id = ${step.discountCodeId}::uuid,
            content = ${JSON.stringify(content)}::jsonb, updated_at = now()
        where id = ${id}::uuid returning id
      `)
    : await db().execute<Row>(sql`
        insert into commerce.plan_reminder_steps (delay_minutes, active, platform_discount_id, content)
        values (${step.delayMinutes}, ${step.active}, ${step.discountCodeId}::uuid, ${JSON.stringify(content)}::jsonb)
        returning id
      `);
  if (!row) return { ok: false, problems: ["That reminder no longer exists."] };
  await audit(actor.id, null, "plan_reminders.step_saved", { step: String(row.id), delay: step.delayMinutes });
  return { ok: true, id: String(row.id) };
}

export async function deletePlanReminderStep(actor: Account, id: string): Promise<void> {
  await db().execute(sql`delete from commerce.plan_reminder_steps where id = ${id}::uuid`);
  await audit(actor.id, null, "plan_reminders.step_deleted", { step: id });
}

export function newPlanStepContent(n: number): Record<string, ReminderText> {
  return { [LOCALE]: defaultPlanText(n) };
}

// ---------------------------------------------------------------------------
// Going to pay, saying no, and paying
// ---------------------------------------------------------------------------

/** Whether the owner asked for no reminders about plans. */
export async function planRemindersOptedOut(accountId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select plan_reminders_opted_out_at is not null as out from commerce.accounts where id = ${accountId}::uuid
  `);
  return Boolean(row?.out);
}

/**
 * The owner went to Stripe to pay for a plan: the attempt is kept for the
 * reminders, replacing any earlier one for the store, unless reminders are
 * off or the owner said no.
 */
export async function capturePlanCheckout(owner: Account, storeId: string, priceId: string): Promise<boolean> {
  if (!(await planRemindersOn()) || (await planRemindersOptedOut(owner.id))) return false;
  const [price] = await db().execute<Row>(sql`
    select pp.amount_minor, pp.currency, pp.interval, p.name as plan_name
    from commerce.plan_prices pp join commerce.plans p on p.id = pp.plan_id
    where pp.id = ${priceId}::uuid
  `);
  if (!price) return false;
  await db().execute(sql`
    insert into commerce.abandoned_plan_checkouts (store_id, account_id, email, price_id, plan_name, amount_minor, currency, interval, token)
    values (${storeId}::uuid, ${owner.id}::uuid, ${owner.email.trim().toLowerCase()}, ${priceId}::uuid, ${String(price.plan_name)},
            ${Number(price.amount_minor)}, ${String(price.currency)}, ${String(price.interval)}, ${randomBytes(24).toString("base64url")})
    on conflict (store_id) do update set
      account_id = excluded.account_id, email = excluded.email, price_id = excluded.price_id, plan_name = excluded.plan_name,
      amount_minor = excluded.amount_minor, currency = excluded.currency, interval = excluded.interval,
      captured_at = now(), reminders_sent = 0, last_delay_minutes = 0, last_reminder_at = null, clicked_at = null,
      opted_out_at = null, recovered_at = null, updated_at = now()
  `);
  return true;
}

/** The Plan page's link, or a reminder's: no reminders about plans for this owner, or reminders after all. */
export async function setPlanRemindersOptOut(accountId: string, optOut: boolean): Promise<void> {
  await db().execute(sql`
    update commerce.accounts set plan_reminders_opted_out_at = ${optOut ? sql`now()` : null} where id = ${accountId}::uuid
  `);
  if (optOut) {
    await db().execute(sql`
      update commerce.abandoned_plan_checkouts set opted_out_at = now(), email = null, updated_at = now()
      where account_id = ${accountId}::uuid and recovered_at is null
    `);
  }
}

/** The store is on a plan: no more reminders about paying for one. */
export async function markPlanCheckoutRecovered(storeId: string): Promise<void> {
  await db().execute(sql`
    update commerce.abandoned_plan_checkouts set recovered_at = now(), updated_at = now()
    where store_id = ${storeId}::uuid and recovered_at is null
  `);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export function planReminderLinks(storeSlug: string, token: string, code: string | null) {
  return {
    resumeUrl: `${siteUrl()}/admin/${storeSlug}/billing/resume/${token}${code ? `?code=${encodeURIComponent(code)}` : ""}`,
    unsubscribeUrl: `${siteUrl()}/unsubscribe/${token}`,
    oneClickUrl: `${siteUrl()}/api/unsubscribe/${token}`,
  };
}

/** The latest due reminder for each unpaid plan, claimed before it is sent, like the stores' (D33). */
export async function sendDuePlanReminders(): Promise<{ sent: number; failed: number; erased: number }> {
  const erased = await db().execute<Row>(sql`
    update commerce.abandoned_plan_checkouts set email = null, updated_at = now()
    where email is not null and captured_at < now() - make_interval(days => ${KEEP_DAYS})
    returning id
  `);
  // A store already on a plan (chosen another way, or assigned by an admin) counts as paid.
  await db().execute(sql`
    update commerce.abandoned_plan_checkouts a set recovered_at = now(), updated_at = now()
    from commerce.store_billing b
    where b.store_id = a.store_id and b.status in (${onPlan}) and a.recovered_at is null
  `);
  const due = await db().execute<Row>(sql`
    with due as (
      select a.id, step.id as step_id, step.delay_minutes
      from commerce.abandoned_plan_checkouts a
      join commerce.platform_settings s on s.plan_reminders
      join commerce.accounts acc on acc.id = a.account_id and acc.plan_reminders_opted_out_at is null and acc.disabled_at is null
      join lateral (
        select r.id, r.delay_minutes from commerce.plan_reminder_steps r
        where r.active and r.delay_minutes > a.last_delay_minutes
          and a.captured_at + make_interval(mins => r.delay_minutes) <= now()
        order by r.delay_minutes desc limit 1
      ) step on true
      where a.email is not null and a.recovered_at is null and a.opted_out_at is null
        and a.captured_at > now() - make_interval(days => ${REMIND_DAYS})
      order by a.captured_at
      limit ${BATCH}
      for update of a skip locked
    )
    update commerce.abandoned_plan_checkouts a
    set last_delay_minutes = due.delay_minutes, reminders_sent = a.reminders_sent + 1, last_reminder_at = now(), updated_at = now()
    from due where a.id = due.id
    returning a.id, a.store_id, a.email, a.plan_name, a.amount_minor, a.currency, a.interval, a.token, due.step_id
  `);
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    const outcome = await sendPlanReminder({
      checkoutId: String(row.id),
      storeId: String(row.store_id),
      stepId: String(row.step_id),
      to: String(row.email),
      plan: { name: String(row.plan_name), amountMinor: Number(row.amount_minor), currency: String(row.currency), interval: String(row.interval) },
      token: String(row.token),
    });
    if (outcome === "sent" || outcome === "logged") sent++;
    else if (outcome === "failed") failed++;
  }
  return { sent, failed, erased: erased.length };
}

type PlanShown = { name: string; amountMinor: number; currency: string; interval: string };

function planLine(plan: PlanShown): ReminderLine {
  return {
    variantId: "plan",
    sellingPlanId: null,
    title: `Kaizen ${plan.name}, paid ${plan.interval === "year" ? "yearly" : "monthly"}`,
    quantity: 1,
    unitPriceMinor: plan.amountMinor,
  };
}

async function sendPlanReminder(input: {
  checkoutId: string | null;
  storeId: string;
  stepId: string;
  to: string;
  plan: PlanShown;
  token: string;
  test?: boolean;
}): Promise<SendOutcome | null> {
  const [store] = await db().execute<Row>(sql`select slug, name from commerce.stores where id = ${input.storeId}::uuid`);
  const step = await getPlanReminderStep(input.stepId);
  const text = step?.content[LOCALE] ?? (step ? Object.values(step.content)[0] : undefined);
  if (!store || !step || !text) return null;
  const [code] = step.discountCodeId
    ? await db().execute<Row>(sql`select code from commerce.platform_discount_codes where id = ${step.discountCodeId}::uuid and active`)
    : [];
  const discount = code ? String(code.code) : null;
  const links = planReminderLinks(String(store.slug), input.token, discount);
  const content = buildReminderEmail({
    text,
    locale: "en-GB",
    currency: input.plan.currency,
    storeName: String(store.name),
    footer: ["Kaizen · kaizenstore.cloud"],
    lines: [planLine(input.plan)],
    code: discount,
    restoreUrl: links.resumeUrl,
    unsubscribeUrl: links.unsubscribeUrl,
    purpose: "plan",
  });
  if (input.test) content.subject = `[Test] ${content.subject}`;
  return sendEmail({
    storeId: null,
    kind: input.test ? "plan_reminder.test" : "plan_reminder",
    to: input.to,
    email: renderEmail(content),
    fromName: "Kaizen",
    idempotencyKey: input.checkoutId ? `plan-reminder:${input.checkoutId}:${input.stepId}` : undefined,
    headers: input.test
      ? undefined
      : { "List-Unsubscribe": `<${links.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
}

/** The saved reminder with a sample plan, to the platform admin's own address. */
export async function sendTestPlanReminder(actor: Account, stepId: string): Promise<SendOutcome | null> {
  const [sample] = await db().execute<Row>(sql`
    select p.name, pp.amount_minor, pp.currency, pp.interval,
      (select id from commerce.stores where status <> 'closed' order by created_at limit 1) as store_id
    from commerce.plan_prices pp join commerce.plans p on p.id = pp.plan_id
    where pp.active order by pp.amount_minor limit 1
  `);
  if (!sample?.store_id) return null;
  return sendPlanReminder({
    checkoutId: null,
    storeId: String(sample.store_id),
    stepId,
    to: actor.email,
    plan: { name: String(sample.name), amountMinor: Number(sample.amount_minor), currency: String(sample.currency), interval: String(sample.interval) },
    token: "test",
    test: true,
  });
}

/** What the editor's preview shows: a sample plan. */
export async function planReminderPreview(): Promise<{ currency: string; sample: ReminderLine[]; storeName: string }> {
  const [sample] = await db().execute<Row>(sql`
    select p.name, pp.amount_minor, pp.currency, pp.interval
    from commerce.plan_prices pp join commerce.plans p on p.id = pp.plan_id
    where pp.active order by pp.amount_minor limit 1
  `);
  const plan: PlanShown = sample
    ? { name: String(sample.name), amountMinor: Number(sample.amount_minor), currency: String(sample.currency), interval: String(sample.interval) }
    : { name: "Standard", amountMinor: 49900, currency: "NOK", interval: "month" };
  return { currency: plan.currency, sample: [planLine(plan)], storeName: "Your store" };
}

// ---------------------------------------------------------------------------
// The reminder's links
// ---------------------------------------------------------------------------

/** The unpaid plan behind a reminder's button, noting the click. */
export async function openPlanReminderLink(token: string): Promise<{ storeId: string; priceId: string | null } | null> {
  const [row] = await db().execute<Row>(sql`
    update commerce.abandoned_plan_checkouts set clicked_at = coalesce(clicked_at, now()), updated_at = now()
    where token = ${token} returning store_id, price_id
  `);
  return row ? { storeId: String(row.store_id), priceId: row.price_id ? String(row.price_id) : null } : null;
}

/** A reminder's unsubscribe link: no more plan reminders to its owner. Null if unknown. */
export async function unsubscribeFromPlanReminders(token: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`select account_id from commerce.abandoned_plan_checkouts where token = ${token}`);
  if (!row) return false;
  await setPlanRemindersOptOut(String(row.account_id), true);
  return true;
}

// ---------------------------------------------------------------------------
// The platform admin's view
// ---------------------------------------------------------------------------

export type AbandonedPlanRow = {
  id: string;
  storeSlug: string;
  storeName: string;
  email: string | null;
  planName: string;
  amountMinor: number;
  currency: string;
  interval: string;
  capturedAt: string;
  remindersSent: number;
  clickedAt: string | null;
  status: "waiting" | "reminded" | "recovered" | "bought" | "opted_out" | "expired";
};

export async function listAbandonedPlanCheckouts(limit = 50): Promise<AbandonedPlanRow[]> {
  const rows = await db().execute<Row>(sql`
    select a.*, s.slug, s.name as store_name, a.captured_at < now() - make_interval(days => ${REMIND_DAYS}) as old
    from commerce.abandoned_plan_checkouts a join commerce.stores s on s.id = a.store_id
    order by a.captured_at desc limit ${limit}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    storeSlug: String(row.slug),
    storeName: String(row.store_name),
    email: row.email ? String(row.email) : null,
    planName: String(row.plan_name),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    interval: String(row.interval),
    capturedAt: new Date(String(row.captured_at)).toISOString(),
    remindersSent: Number(row.reminders_sent),
    clickedAt: row.clicked_at ? new Date(String(row.clicked_at)).toISOString() : null,
    status: row.recovered_at
      ? Number(row.reminders_sent) > 0
        ? "recovered"
        : "bought"
      : row.opted_out_at
        ? "opted_out"
        : row.old
          ? "expired"
          : Number(row.reminders_sent) > 0
            ? "reminded"
            : "waiting",
  }));
}

export async function planReminderStats(): Promise<{ captured: number; reminded: number; recovered: number }> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as captured,
      count(*) filter (where reminders_sent > 0)::int as reminded,
      count(*) filter (where reminders_sent > 0 and recovered_at is not null)::int as recovered
    from commerce.abandoned_plan_checkouts where captured_at > now() - interval '30 days'
  `);
  return { captured: Number(row?.captured ?? 0), reminded: Number(row?.reminded ?? 0), recovered: Number(row?.recovered ?? 0) };
}
