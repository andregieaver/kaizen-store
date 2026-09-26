import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  buildReminderEmail,
  defaultSteps,
  defaultText,
  reminderStepInput,
  type ReminderLine,
  type ReminderStep,
  type ReminderText,
} from "@/lib/cart-reminders";
import { renderEmail } from "@/lib/email-layout";
import { emailText } from "@/lib/email-text";
import type { Market } from "@/lib/markets";
import { marketPath, storeSiteUrl } from "@/lib/paths";
import { absoluteUrl } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

import { audit, type Membership } from "./auth";
import { sendEmail, type SendOutcome } from "./email";
import type { SaveResult } from "./settings";
import { emailFooter, storeById } from "./shopper-emails";

type Row = Record<string, unknown>;

/**
 * Reminders about carts left at checkout (decision D33). When a shopper
 * who is not signed in types their email at checkout, the cart is kept
 * with it; if the order is not paid, the store's reminders go out at the
 * delays it chose, each with a link back to the same cart and a link to
 * stop them. Checkout says so under the email field, with a link to opt
 * out; an opt-out erases the email and the cart.
 */

/** Captured checkouts older than this get no more reminders. */
const REMIND_DAYS = 30;
/** Emails and carts are erased this long after capture, bought or not. */
const KEEP_DAYS = 60;
/** At most this many reminders per run, so a run stays well inside a minute. */
const BATCH = 50;

const normal = (email: string) => email.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type CartReminderSettings = { enabled: boolean; steps: ReminderStep[] };

function toStep(row: Row): ReminderStep {
  return {
    id: String(row.id),
    delayMinutes: Number(row.delay_minutes),
    active: Boolean(row.active),
    discountCodeId: row.discount_code_id ? String(row.discount_code_id) : null,
    content: (row.content ?? {}) as Record<string, ReminderText>,
  };
}

export async function getCartReminderSettings(storeId: string): Promise<CartReminderSettings> {
  const [[store], steps] = await Promise.all([
    db().execute<Row>(sql`select cart_reminders from commerce.stores where id = ${storeId}::uuid`),
    db().execute<Row>(sql`
      select id, delay_minutes, active, discount_code_id, content from commerce.cart_reminder_steps
      where store_id = ${storeId}::uuid order by delay_minutes, created_at
    `),
  ]);
  return { enabled: Boolean(store?.cart_reminders), steps: steps.map(toStep) };
}

export async function getCartReminderStep(storeId: string, id: string): Promise<ReminderStep | null> {
  const [row] = await db().execute<Row>(sql`
    select id, delay_minutes, active, discount_code_id, content from commerce.cart_reminder_steps
    where store_id = ${storeId}::uuid and id = ${id}::uuid
  `);
  return row ? toStep(row) : null;
}

/** Whether checkout should keep the email and say so: on, with at least one active reminder. */
export async function cartRemindersOn(storeId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select s.cart_reminders and exists (
      select 1 from commerce.cart_reminder_steps r where r.store_id = s.id and r.active
    ) as on
    from commerce.stores s where s.id = ${storeId}::uuid
  `);
  return Boolean(row?.on);
}

/** Turns the reminders on or off; the first time on, the store gets three to start from. */
export async function setCartRemindersEnabled({ account, store }: Membership, enabled: boolean): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.execute(sql`update commerce.stores set cart_reminders = ${enabled} where id = ${store.id}::uuid`);
    if (!enabled) return;
    const [existing] = await tx.execute<Row>(sql`
      select count(*)::int as n from commerce.cart_reminder_steps where store_id = ${store.id}::uuid
    `);
    if (Number(existing.n) > 0) return;
    const locales = [...new Set(store.markets.map((m) => m.locale))];
    for (const step of defaultSteps(locales)) {
      await tx.execute(sql`
        insert into commerce.cart_reminder_steps (store_id, delay_minutes, active, content)
        values (${store.id}::uuid, ${step.delayMinutes}, true, ${JSON.stringify(step.content)}::jsonb)
      `);
    }
  });
  await audit(account.id, store.id, enabled ? "cart_reminders.enabled" : "cart_reminders.disabled", {});
}

/** Creates a reminder (id null) or changes one; every language the store sells in needs its text. */
export async function saveCartReminderStep(
  { account, store }: Membership,
  id: string | null,
  input: unknown,
): Promise<SaveResult & { id?: string }> {
  const parsed = reminderStepInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const step = parsed.data;
  const locales = [...new Set(store.markets.map((m) => m.locale))];
  const missing = locales.filter((locale) => !step.content[locale]);
  if (missing.length > 0) return { ok: false, problems: ["Write the reminder in every language the store sells in."] };
  const content = Object.fromEntries(locales.map((locale) => [locale, step.content[locale]]));
  if (step.discountCodeId) {
    const [code] = await db().execute<Row>(sql`
      select 1 from commerce.discount_codes where store_id = ${store.id}::uuid and id = ${step.discountCodeId}::uuid
    `);
    if (!code) return { ok: false, problems: ["That discount code no longer exists."] };
  }
  const [row] = id
    ? await db().execute<Row>(sql`
        update commerce.cart_reminder_steps
        set delay_minutes = ${step.delayMinutes}, active = ${step.active}, discount_code_id = ${step.discountCodeId}::uuid,
            content = ${JSON.stringify(content)}::jsonb, updated_at = now()
        where store_id = ${store.id}::uuid and id = ${id}::uuid
        returning id
      `)
    : await db().execute<Row>(sql`
        insert into commerce.cart_reminder_steps (store_id, delay_minutes, active, discount_code_id, content)
        values (${store.id}::uuid, ${step.delayMinutes}, ${step.active}, ${step.discountCodeId}::uuid, ${JSON.stringify(content)}::jsonb)
        returning id
      `);
  if (!row) return { ok: false, problems: ["That reminder no longer exists."] };
  await audit(account.id, store.id, "cart_reminders.step_saved", { step: String(row.id), delay: step.delayMinutes });
  return { ok: true, id: String(row.id) };
}

export async function deleteCartReminderStep({ account, store }: Membership, id: string): Promise<void> {
  await db().execute(sql`delete from commerce.cart_reminder_steps where store_id = ${store.id}::uuid and id = ${id}::uuid`);
  await audit(account.id, store.id, "cart_reminders.step_deleted", { step: id });
}

/** A new reminder's texts: the store's languages, in the next default's words. */
export function newStepContent(locales: string[], n: number): Record<string, ReminderText> {
  return Object.fromEntries(locales.map((locale) => [locale, defaultText(locale, n)]));
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

/**
 * The shopper typed an email at checkout: the cart as ordered is kept with
 * it for the reminders. Nothing is kept once they have opted out, or when
 * the store sends no reminders.
 */
export async function captureCheckout(
  storeId: string,
  market: Market,
  cartId: string,
  orderId: string,
  email: string,
): Promise<boolean> {
  if (!(await cartRemindersOn(storeId))) return false;
  const address = normal(email);
  const [optedOut] = await db().execute<Row>(sql`
    select 1 from commerce.email_opt_outs where store_id = ${storeId}::uuid and lower(email) = ${address}
  `);
  const lines = await db().execute<Row>(sql`
    select variant_id, selling_plan_id, title, quantity, unit_price_minor from commerce.order_lines
    where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and variant_id is not null
    order by title, id
  `);
  const snapshot: ReminderLine[] = lines.map((line) => ({
    variantId: String(line.variant_id),
    sellingPlanId: line.selling_plan_id ? String(line.selling_plan_id) : null,
    title: String(line.title),
    quantity: Number(line.quantity),
    unitPriceMinor: Number(line.unit_price_minor),
  }));
  const subtotal = snapshot.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
  const rows = await db().execute<Row>(sql`
    insert into commerce.abandoned_checkouts (
      store_id, cart_id, order_id, email, market_code, locale, currency, lines, subtotal_minor, token, captured_at, opted_out_at
    ) values (
      ${storeId}::uuid, ${cartId}::uuid, ${orderId}::uuid, ${optedOut ? null : address}, ${market.code}, ${market.locale},
      ${market.currency}, ${JSON.stringify(optedOut ? [] : snapshot)}::jsonb, ${optedOut ? 0 : subtotal},
      ${randomBytes(24).toString("base64url")}, ${optedOut ? null : sql`now()`}, ${optedOut ? sql`now()` : null}
    )
    on conflict (store_id, cart_id) do update set
      order_id = excluded.order_id,
      email = excluded.email,
      lines = excluded.lines,
      subtotal_minor = excluded.subtotal_minor,
      captured_at = coalesce(commerce.abandoned_checkouts.captured_at, excluded.captured_at),
      updated_at = now()
    where commerce.abandoned_checkouts.opted_out_at is null and commerce.abandoned_checkouts.recovered_at is null
    returning id
  `);
  return rows.length > 0 && !optedOut;
}

/**
 * The shopper's choice under the email field: no reminders for this cart
 * (the email and cart are erased, and the email is remembered as opted
 * out), or, on second thought, reminders after all.
 */
export async function setCheckoutOptOut(
  storeId: string,
  market: Market,
  cartId: string,
  optOut: boolean,
  email: string | null,
): Promise<void> {
  const address = email ? normal(email) : null;
  if (optOut) {
    const [before] = await db().execute<Row>(sql`
      select email from commerce.abandoned_checkouts where store_id = ${storeId}::uuid and cart_id = ${cartId}::uuid
    `);
    await db().execute(sql`
      insert into commerce.abandoned_checkouts (store_id, cart_id, market_code, locale, currency, token, opted_out_at)
      values (${storeId}::uuid, ${cartId}::uuid, ${market.code}, ${market.locale}, ${market.currency},
              ${randomBytes(24).toString("base64url")}, now())
      on conflict (store_id, cart_id) do update set
        opted_out_at = now(), email = null, lines = '[]', subtotal_minor = 0, updated_at = now()
    `);
    const known = address ?? (before?.email ? String(before.email) : null);
    if (known) await addOptOut(storeId, known, "checkout");
    return;
  }
  await db().execute(sql`
    update commerce.abandoned_checkouts set opted_out_at = null, updated_at = now()
    where store_id = ${storeId}::uuid and cart_id = ${cartId}::uuid
  `);
  // Only an opt-out made at checkout is undone here; one from an email's link stays.
  if (address) {
    await db().execute(sql`
      delete from commerce.email_opt_outs
      where store_id = ${storeId}::uuid and lower(email) = ${address} and source = 'checkout'
    `);
  }
}

async function addOptOut(storeId: string, email: string, source: "checkout" | "unsubscribe") {
  const address = normal(email);
  await db().execute(sql`
    insert into commerce.email_opt_outs (store_id, email, source) values (${storeId}::uuid, ${address}, ${source})
    on conflict (store_id, lower(email)) do nothing
  `);
  // Every waiting cart with the email stops, and its email and contents go.
  await db().execute(sql`
    update commerce.abandoned_checkouts set opted_out_at = coalesce(opted_out_at, now()), email = null, lines = '[]',
      subtotal_minor = 0, updated_at = now()
    where store_id = ${storeId}::uuid and lower(email) = ${address} and recovered_at is null
  `);
}

/** Whether the shopper chose no reminders for this cart. */
export async function checkoutOptedOut(storeId: string, cartId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select opted_out_at is not null as out from commerce.abandoned_checkouts
    where store_id = ${storeId}::uuid and cart_id = ${cartId}::uuid
  `);
  return Boolean(row?.out);
}

/**
 * The order is paid: its captured checkout, and any other waiting one with
 * the same email, is bought and gets no more reminders.
 */
export async function markCheckoutRecovered(storeId: string, orderId: string): Promise<void> {
  await db().execute(sql`
    update commerce.abandoned_checkouts a set recovered_at = now(), recovered_order_id = o.id, updated_at = now()
    from commerce.orders o
    where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
      and a.store_id = o.store_id and a.recovered_at is null
      and (a.cart_id = o.cart_id
           or (a.email is not null and o.email <> '' and lower(a.email) = lower(o.email)
               and a.captured_at > now() - make_interval(days => ${REMIND_DAYS})))
  `);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export type ReminderRun = { sent: number; failed: number; erased: number };

/**
 * Sends the reminders that are due, at most one per cart per run: the
 * latest step whose delay has passed, so a late run never sends several at
 * once. Each is claimed before sending, so two runs never send the same.
 */
export async function sendDueCartReminders(): Promise<ReminderRun> {
  const erased = await db().execute<Row>(sql`
    update commerce.abandoned_checkouts set email = null, lines = '[]', subtotal_minor = 0, updated_at = now()
    where email is not null and captured_at < now() - make_interval(days => ${KEEP_DAYS})
    returning id
  `);
  const due = await db().execute<Row>(sql`
    with due as (
      select a.id, step.id as step_id, step.delay_minutes
      from commerce.abandoned_checkouts a
      join commerce.stores s on s.id = a.store_id and s.cart_reminders
      join lateral (
        select r.id, r.delay_minutes from commerce.cart_reminder_steps r
        where r.store_id = a.store_id and r.active and r.delay_minutes > a.last_delay_minutes
          and a.captured_at + make_interval(mins => r.delay_minutes) <= now()
        order by r.delay_minutes desc limit 1
      ) step on true
      where a.email is not null and a.recovered_at is null and a.opted_out_at is null
        and a.captured_at > now() - make_interval(days => ${REMIND_DAYS})
        and jsonb_array_length(a.lines) > 0
        and not exists (
          select 1 from commerce.email_opt_outs o where o.store_id = a.store_id and lower(o.email) = lower(a.email)
        )
      order by a.captured_at
      limit ${BATCH}
      for update of a skip locked
    )
    update commerce.abandoned_checkouts a
    set last_delay_minutes = due.delay_minutes, reminders_sent = a.reminders_sent + 1, last_reminder_at = now(), updated_at = now()
    from due where a.id = due.id
    returning a.id, a.store_id, a.email, a.market_code, a.locale, a.currency, a.lines, a.token, a.captured_at,
      a.reminders_sent, due.step_id
  `);

  let sent = 0;
  let failed = 0;
  for (const row of due) {
    const storeId = String(row.store_id);
    // Bought since, with the same email: no reminder, and it counts as bought.
    const [bought] = await db().execute<Row>(sql`
      select o.id from commerce.orders o
      join commerce.payments p on p.order_id = o.id and p.status = 'captured'
      where o.store_id = ${storeId}::uuid and lower(o.email) = lower(${String(row.email)})
        and o.placed_at > ${String(row.captured_at)}::timestamptz
      limit 1
    `);
    if (bought) {
      await db().execute(sql`
        update commerce.abandoned_checkouts
        set recovered_at = now(), recovered_order_id = ${String(bought.id)}::uuid,
            reminders_sent = reminders_sent - 1, updated_at = now()
        where id = ${String(row.id)}::uuid
      `);
      continue;
    }
    const outcome = await sendReminder({
      storeId,
      checkoutId: String(row.id),
      stepId: String(row.step_id),
      to: String(row.email),
      marketCode: String(row.market_code),
      locale: String(row.locale),
      currency: String(row.currency),
      lines: row.lines as ReminderLine[],
      token: String(row.token),
    });
    if (outcome === "sent" || outcome === "logged") sent++;
    else if (outcome === "failed") failed++;
  }
  return { sent, failed, erased: erased.length };
}

/**
 * The lines with their products' pictures (full addresses on the store's
 * site), looked up now: what was left in the cart keeps only the variant.
 */
async function withPictures(storeId: string, storeSlug: string, lines: ReminderLine[]): Promise<ReminderLine[]> {
  const ids = lines.map((line) => line.variantId).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) return lines;
  const rows = await db().execute<Row>(sql`
    select v.id,
      (select coalesce(m.thumbnail_url, m.url) from commerce.product_media m
        where m.product_id = v.product_id order by m.position limit 1) as image
    from commerce.product_variants v
    where v.store_id = ${storeId}::uuid and v.id = any(${`{${ids.join(",")}}`}::uuid[])
  `);
  const pictures = new Map(rows.map((row) => [String(row.id), row.image ? String(row.image) : null]));
  const origin = storeSiteUrl(storeSlug);
  return lines.map((line) => {
    const image = pictures.get(line.variantId);
    return { ...line, image: image ? absoluteUrl(image, origin) : null };
  });
}

/** The links in a reminder: back to the cart (with the step's code), and to stop reminders. */
export function reminderLinks(storeSlug: string, marketSlug: string, token: string, code: string | null) {
  const base = `${storeSiteUrl(storeSlug)}${marketPath(storeSlug, marketSlug)}`;
  return {
    restoreUrl: `${base}/cart/restore/${token}${code ? `?code=${encodeURIComponent(code)}` : ""}`,
    unsubscribeUrl: `${base}/unsubscribe/${token}`,
    oneClickUrl: `${siteUrl()}/api/unsubscribe/${token}`,
  };
}

async function sendReminder(input: {
  storeId: string;
  checkoutId: string | null;
  stepId: string;
  to: string;
  marketCode: string;
  locale: string;
  currency: string;
  lines: ReminderLine[];
  token: string;
  test?: boolean;
}): Promise<SendOutcome | null> {
  const store = await storeById(input.storeId);
  const step = await getCartReminderStep(input.storeId, input.stepId);
  if (!store || !step) return null;
  const market = store.markets.find((m) => m.code === input.marketCode) ?? store.markets[0];
  if (!market) return null;
  const text = step.content[input.locale] ?? step.content[market.locale] ?? Object.values(step.content)[0];
  if (!text) return null;
  const [code] = step.discountCodeId
    ? await db().execute<Row>(sql`
        select code from commerce.discount_codes where store_id = ${input.storeId}::uuid and id = ${step.discountCodeId}::uuid and active
      `)
    : [];
  const discount = code ? String(code.code) : null;
  const links = reminderLinks(store.slug, market.slug, input.token, discount);
  const content = buildReminderEmail({
    text,
    locale: input.locale,
    currency: input.currency,
    storeName: store.name,
    footer: emailFooter(store, emailText(input.locale.split("-")[0])),
    lines: await withPictures(input.storeId, store.slug, input.lines),
    code: discount,
    restoreUrl: links.restoreUrl,
    unsubscribeUrl: links.unsubscribeUrl,
  });
  if (input.test) content.subject = `[Test] ${content.subject}`;
  return sendEmail({
    storeId: input.storeId,
    kind: input.test ? "cart_reminder.test" : "cart_reminder",
    to: input.to,
    email: renderEmail(content),
    fromName: store.name,
    replyTo: store.details.contactEmail,
    idempotencyKey: input.checkoutId ? `cart-reminder:${input.checkoutId}:${input.stepId}` : undefined,
    headers: input.test
      ? undefined
      : { "List-Unsubscribe": `<${links.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
}

/** A reminder with a sample cart, to the staff member's own address, in one of the store's languages. */
export async function sendTestReminder(
  { account, store }: Membership,
  stepId: string,
  locale: string,
): Promise<SendOutcome | null> {
  const market = store.markets.find((m) => m.locale === locale) ?? store.markets[0];
  if (!market) return null;
  const [product] = await db().execute<Row>(sql`
    select v.id, coalesce(t.title, p.handle) as title, pr.amount_minor
    from commerce.product_variants v
    join commerce.products p on p.id = v.product_id and p.status = 'active'
    left join commerce.product_translations t on t.product_id = p.id and t.locale = ${market.locale}
    join commerce.prices pr on pr.variant_id = v.id and pr.market_code = ${market.code} and pr.valid_to is null
    where v.store_id = ${store.id}::uuid and v.active
    order by p.created_at limit 1
  `);
  const lines: ReminderLine[] = product
    ? [{ variantId: String(product.id), sellingPlanId: null, title: String(product.title), quantity: 1, unitPriceMinor: Number(product.amount_minor) }]
    : [];
  return sendReminder({
    storeId: store.id,
    checkoutId: null,
    stepId,
    to: account.email,
    marketCode: market.code,
    locale: market.locale,
    currency: market.currency,
    lines,
    token: "test",
    test: true,
  });
}

// ---------------------------------------------------------------------------
// The reminder's links
// ---------------------------------------------------------------------------

export type RestorableCheckout = { id: string; storeId: string; marketCode: string; lines: ReminderLine[] };

/** The cart behind a reminder's link, noting the click. */
export async function openReminderLink(storeId: string, token: string): Promise<RestorableCheckout | null> {
  const [row] = await db().execute<Row>(sql`
    update commerce.abandoned_checkouts set clicked_at = coalesce(clicked_at, now()), updated_at = now()
    where store_id = ${storeId}::uuid and token = ${token}
    returning id, store_id, market_code, lines
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    storeId: String(row.store_id),
    marketCode: String(row.market_code),
    lines: (row.lines ?? []) as ReminderLine[],
  };
}

/** Stops every reminder for the email behind a reminder's link. False if the link is unknown. */
export async function unsubscribe(token: string): Promise<{ storeId: string } | null> {
  const [row] = await db().execute<Row>(sql`
    select store_id, email, opted_out_at from commerce.abandoned_checkouts where token = ${token}
  `);
  if (!row) return null;
  const storeId = String(row.store_id);
  if (row.email) await addOptOut(storeId, String(row.email), "unsubscribe");
  else {
    await db().execute(sql`
      update commerce.abandoned_checkouts set opted_out_at = coalesce(opted_out_at, now()) where token = ${token}
    `);
  }
  return { storeId };
}

// ---------------------------------------------------------------------------
// The admin's view
// ---------------------------------------------------------------------------

export type AbandonedCheckoutRow = {
  id: string;
  email: string | null;
  subtotalMinor: number;
  currency: string;
  marketCode: string;
  items: number;
  capturedAt: string | null;
  remindersSent: number;
  lastReminderAt: string | null;
  clickedAt: string | null;
  status: "waiting" | "reminded" | "recovered" | "bought" | "opted_out" | "expired";
  recoveredOrderId: string | null;
};

export async function listAbandonedCheckouts(storeId: string, limit = 50): Promise<AbandonedCheckoutRow[]> {
  const rows = await db().execute<Row>(sql`
    select id, email, subtotal_minor, currency, market_code, lines, captured_at, reminders_sent, last_reminder_at,
      clicked_at, recovered_at, recovered_order_id, opted_out_at,
      captured_at < now() - make_interval(days => ${REMIND_DAYS}) as old
    from commerce.abandoned_checkouts
    where store_id = ${storeId}::uuid and (captured_at is not null or opted_out_at is not null)
    order by coalesce(captured_at, created_at) desc
    limit ${limit}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    email: row.email ? String(row.email) : null,
    subtotalMinor: Number(row.subtotal_minor),
    currency: String(row.currency),
    marketCode: String(row.market_code),
    items: (row.lines as ReminderLine[]).reduce((sum, line) => sum + line.quantity, 0),
    capturedAt: row.captured_at ? new Date(String(row.captured_at)).toISOString() : null,
    remindersSent: Number(row.reminders_sent),
    lastReminderAt: row.last_reminder_at ? new Date(String(row.last_reminder_at)).toISOString() : null,
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
    recoveredOrderId: row.recovered_order_id ? String(row.recovered_order_id) : null,
  }));
}

export type CartReminderStats = {
  captured: number;
  reminded: number;
  recovered: number;
  /** Paid for orders that came back after a reminder, per currency. */
  recoveredMinor: Record<string, number>;
};

/** The last 30 days: carts with an email, carts reminded, and carts bought after a reminder. */
export async function cartReminderStats(storeId: string): Promise<CartReminderStats> {
  const [row] = await db().execute<Row>(sql`
    select
      count(*) filter (where a.captured_at is not null)::int as captured,
      count(*) filter (where a.reminders_sent > 0)::int as reminded,
      count(*) filter (where a.reminders_sent > 0 and a.recovered_at is not null)::int as recovered,
      coalesce(
        (select jsonb_object_agg(currency, total) from (
          select o.currency, sum(o.total_minor)::bigint as total
          from commerce.abandoned_checkouts r join commerce.orders o on o.id = r.recovered_order_id
          where r.store_id = ${storeId}::uuid and r.reminders_sent > 0 and r.captured_at > now() - interval '30 days'
          group by o.currency
        ) t),
        '{}'::jsonb
      ) as recovered_minor
    from commerce.abandoned_checkouts a
    where a.store_id = ${storeId}::uuid and a.captured_at > now() - interval '30 days'
  `);
  return {
    captured: Number(row?.captured ?? 0),
    reminded: Number(row?.reminded ?? 0),
    recovered: Number(row?.recovered ?? 0),
    recoveredMinor: (row?.recovered_minor ?? {}) as Record<string, number>,
  };
}

/** What the editor's preview needs per language: the currency, the email's foot and a sample cart. */
export async function reminderLanguages(storeId: string): Promise<
  { locale: string; label: string; currency: string; footer: string[]; sample: ReminderLine[] }[]
> {
  const store = await storeById(storeId);
  if (!store) return [];
  const seen = new Set<string>();
  const markets = store.markets.filter((m) => !seen.has(m.locale) && seen.add(m.locale));
  return Promise.all(
    markets.map(async (market) => {
      // Two different products, one variant each.
      const products = await db().execute<Row>(sql`
        select * from (
          select distinct on (p.id) v.id, coalesce(t.title, p.handle) as title, pr.amount_minor, p.created_at
          from commerce.product_variants v
          join commerce.products p on p.id = v.product_id and p.status = 'active'
          left join commerce.product_translations t on t.product_id = p.id and t.locale = ${market.locale}
          join commerce.prices pr on pr.variant_id = v.id and pr.market_code = ${market.code} and pr.valid_to is null
          where v.store_id = ${storeId}::uuid and v.active
          order by p.id, v.created_at
        ) one order by created_at limit 2
      `);
      return {
        locale: market.locale,
        label: `${market.name} (${market.locale})`,
        currency: market.currency,
        footer: emailFooter(store, emailText(market.lang)),
        sample: await withPictures(
          storeId,
          store.slug,
          products.map((p, i) => ({
            variantId: String(p.id),
            sellingPlanId: null,
            title: String(p.title),
            quantity: i === 0 ? 1 : 2,
            unitPriceMinor: Number(p.amount_minor),
          })),
        ),
      };
    }),
  );
}
