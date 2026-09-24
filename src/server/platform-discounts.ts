import "server-only";

import { sql } from "drizzle-orm";
import Stripe from "stripe";

import { db } from "@/db/client";
import { normalizeCode, platformDiscountInput, type PlatformDiscount } from "@/lib/discounts";
import { parsePrice } from "@/lib/product-input";
import type { PaymentModeName } from "@/lib/stripe-account";

import { audit, type Account } from "./auth";
import type { SaveResult } from "./settings";
import { platformModes, platformStripe } from "./stripe";

type Row = Record<string, unknown>;

/**
 * Kaizen's discount codes for stores' plans (D31). Each lives in Kaizen's
 * Stripe account, in each mode Kaizen has keys for, as a coupon (what it
 * gives, and for how long) and a promotion code (the text owners type).
 * Stripe counts the uses and applies the discount to the plan's invoices.
 */

const iso = (value: unknown) => (value ? new Date(String(value)).toISOString() : null);

function toDiscount(row: Row): PlatformDiscount {
  return {
    id: String(row.id),
    code: String(row.code),
    kind: row.kind as PlatformDiscount["kind"],
    percent: Number(row.percent),
    amounts: (row.amounts ?? {}) as Record<string, number>,
    duration: row.duration as PlatformDiscount["duration"],
    durationMonths: row.duration_months === null ? null : Number(row.duration_months),
    expiresAt: iso(row.expires_at),
    maxRedemptions: row.max_redemptions === null ? null : Number(row.max_redemptions),
    active: Boolean(row.active),
    createdAt: iso(row.created_at)!,
  };
}

async function recordSync(
  mode: PaymentModeName,
  kind: "coupon" | "promotion_code",
  localId: string,
  outcome: { stripeId: string } | { error: string },
) {
  const stripeId = "stripeId" in outcome ? outcome.stripeId : null;
  const error = "error" in outcome ? outcome.error : null;
  await db().execute(sql`
    insert into commerce.stripe_sync (mode, kind, local_id, stripe_id, synced_at, error)
    values (${mode}, ${kind}, ${localId}, ${stripeId}, ${stripeId ? sql`now()` : null}, ${error})
    on conflict (mode, kind, local_id) do update set
      stripe_id = coalesce(excluded.stripe_id, commerce.stripe_sync.stripe_id),
      synced_at = coalesce(excluded.synced_at, commerce.stripe_sync.synced_at),
      error = excluded.error, updated_at = now()
  `);
}

async function synced(mode: PaymentModeName, kind: "coupon" | "promotion_code", localId: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select stripe_id from commerce.stripe_sync where mode = ${mode} and kind = ${kind} and local_id = ${localId}
  `);
  return row?.stripe_id ? String(row.stripe_id) : null;
}

const problemText = (error: unknown) =>
  error instanceof Stripe.errors.StripeError ? error.message : "Stripe could not be reached.";

/** Makes the code exist in Stripe in this mode, as it is in Kaizen. Safe to repeat. */
async function syncOne(mode: PaymentModeName, discount: PlatformDiscount): Promise<string | null> {
  const stripe = platformStripe(mode);
  if (!stripe) return null;
  try {
    let coupon = await synced(mode, "coupon", discount.id);
    if (!coupon) {
      const [first, ...others] = Object.entries(discount.amounts);
      const created = await stripe.coupons.create(
        {
          name: discount.code,
          duration: discount.duration,
          ...(discount.duration === "repeating" && { duration_in_months: discount.durationMonths ?? 1 }),
          ...(discount.kind === "percent"
            ? { percent_off: discount.percent }
            : {
                amount_off: first[1],
                currency: first[0],
                ...(others.length > 0 && {
                  currency_options: Object.fromEntries(others.map(([currency, minor]) => [currency, { amount_off: minor }])),
                }),
              }),
          metadata: { kaizen_discount_id: discount.id },
        },
        { idempotencyKey: `kaizen-coupon-${discount.id}` },
      );
      coupon = created.id;
      await recordSync(mode, "coupon", discount.id, { stripeId: coupon });
    }
    let promotion = await synced(mode, "promotion_code", discount.id);
    if (!promotion) {
      const created = await stripe.promotionCodes.create(
        {
          promotion: { type: "coupon", coupon },
          code: discount.code,
          active: discount.active,
          ...(discount.expiresAt && { expires_at: Math.floor(new Date(discount.expiresAt).getTime() / 1000) }),
          ...(discount.maxRedemptions !== null && { max_redemptions: discount.maxRedemptions }),
          metadata: { kaizen_discount_id: discount.id },
        },
        { idempotencyKey: `kaizen-promotion-${discount.id}` },
      );
      promotion = created.id;
      await recordSync(mode, "promotion_code", discount.id, { stripeId: promotion });
    } else {
      await stripe.promotionCodes.update(promotion, { active: discount.active });
    }
    return null;
  } catch (error) {
    const text = problemText(error);
    await recordSync(mode, "promotion_code", discount.id, { error: text });
    return text;
  }
}

async function syncEverywhere(discount: PlatformDiscount): Promise<string[]> {
  const problems: string[] = [];
  for (const mode of platformModes()) {
    const problem = await syncOne(mode, discount);
    if (problem) problems.push(`${mode === "live" ? "Live" : "Test"} mode: ${problem}`);
  }
  return problems;
}

export type PlatformDiscountRow = PlatformDiscount & {
  /** Stores whose plan has it now. */
  stores: number;
  /** Modes it is in Stripe for, and the last problem syncing it. */
  syncedModes: PaymentModeName[];
  syncError: string | null;
};

export async function listPlatformDiscounts(): Promise<PlatformDiscountRow[]> {
  const rows = await db().execute<Row>(sql`
    select d.*,
      (select count(*)::int from commerce.store_billing b where b.platform_discount_id = d.id) as stores,
      (select coalesce(jsonb_agg(s.mode), '[]'::jsonb) from commerce.stripe_sync s
        where s.kind = 'promotion_code' and s.local_id = d.id::text and s.stripe_id is not null) as synced_modes,
      (select s.error from commerce.stripe_sync s
        where s.kind = 'promotion_code' and s.local_id = d.id::text and s.error is not null limit 1) as sync_error
    from commerce.platform_discount_codes d
    order by d.active desc, d.created_at desc
  `);
  return rows.map((row) => ({
    ...toDiscount(row),
    stores: Number(row.stores),
    syncedModes: row.synced_modes as PaymentModeName[],
    syncError: row.sync_error ? String(row.sync_error) : null,
  }));
}

export async function getPlatformDiscount(id: string): Promise<PlatformDiscount | null> {
  const [row] = await db().execute<Row>(sql`select * from commerce.platform_discount_codes where id = ${id}::uuid`);
  return row ? toDiscount(row) : null;
}

/**
 * Makes a code and puts it in Stripe. What it gives cannot change later
 * (Stripe's coupons cannot); amounts are per plan currency.
 */
export async function createPlatformDiscount(
  actor: Account,
  input: unknown,
  currencies: string[],
): Promise<SaveResult & { id?: string }> {
  const parsed = platformDiscountInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const d = parsed.data;
  const problems: string[] = [];
  const amounts: Record<string, number> = {};
  if (d.kind === "fixed") {
    for (const currency of currencies) {
      const text = d.amounts[currency] ?? "";
      if (!text) continue;
      const minor = parsePrice(text, currency);
      if (minor === null || minor <= 0) problems.push(`The amount in ${currency} is not valid.`);
      else amounts[currency.toLowerCase()] = minor;
    }
    if (Object.keys(amounts).length === 0 && problems.length === 0) problems.push("Give the amount off in at least one currency.");
  }
  // A date alone means the end of that day, Norwegian time.
  const expiresAt = d.expiresAt
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(d.expiresAt) ? `${d.expiresAt}T23:59:59+01:00` : d.expiresAt)
    : null;
  if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) {
    problems.push("The code must expire in the future.");
  }
  if (problems.length > 0) return { ok: false, problems };

  let row: Row;
  try {
    [row] = await db().execute<Row>(sql`
      insert into commerce.platform_discount_codes (
        code, kind, percent, amounts, duration, duration_months, expires_at, max_redemptions, created_by
      ) values (
        ${d.code}, ${d.kind}, ${d.kind === "percent" ? d.percent : 0}, ${JSON.stringify(amounts)}::jsonb,
        ${d.duration}, ${d.duration === "repeating" ? d.durationMonths : null},
        ${expiresAt?.toISOString() ?? null}::timestamptz, ${d.maxRedemptions}, ${actor.id}::uuid
      )
      returning *
    `);
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
    if (code === "23505") return { ok: false, problems: [`There is already a code ${d.code}.`] };
    throw error;
  }
  const discount = toDiscount(row);
  await audit(actor.id, null, "platform.discount_created", { code: discount.code });
  const syncProblems = await syncEverywhere(discount);
  return {
    ok: true,
    id: discount.id,
    note: syncProblems.length > 0 ? `Saved, but not yet in Stripe. ${syncProblems.join(" ")}` : undefined,
  };
}

/** Switches a code on or off, in Kaizen and in Stripe; plans that have it keep it. */
export async function setPlatformDiscountActive(actor: Account, id: string, active: boolean): Promise<SaveResult> {
  const [row] = await db().execute<Row>(sql`
    update commerce.platform_discount_codes set active = ${active} where id = ${id}::uuid returning *
  `);
  if (!row) return { ok: false, problems: ["Unknown code."] };
  const discount = toDiscount(row);
  await audit(actor.id, null, active ? "platform.discount_on" : "platform.discount_off", { code: discount.code });
  const problems = await syncEverywhere(discount);
  return { ok: true, note: problems.length > 0 ? `Saved, but Stripe was not updated. ${problems.join(" ")}` : undefined };
}

export type UsablePlatformDiscount =
  | { ok: true; discount: PlatformDiscount; promotionCode: string }
  | { ok: false; problem: string };

/**
 * A code an owner can put on their plan now, in the mode Kaizen bills in:
 * known, switched on, not expired, in Stripe, and for the plan's currency.
 * Stripe checks its remaining uses when it is applied.
 */
export async function findPlatformDiscount(
  text: string,
  mode: PaymentModeName,
  currency: string | null,
): Promise<UsablePlatformDiscount> {
  const code = normalizeCode(text);
  const [row] = code
    ? await db().execute<Row>(sql`select * from commerce.platform_discount_codes where code = ${code}`)
    : [];
  if (!row) return { ok: false, problem: "There is no such discount code." };
  const discount = toDiscount(row);
  if (!discount.active || (discount.expiresAt && new Date(discount.expiresAt) <= new Date())) {
    return { ok: false, problem: "That discount code is no longer valid." };
  }
  if (discount.kind === "fixed" && currency && !discount.amounts[currency.toLowerCase()]) {
    return { ok: false, problem: `That discount code is not for plans paid in ${currency.toUpperCase()}.` };
  }
  let promotionCode = await synced(mode, "promotion_code", discount.id);
  if (!promotionCode) {
    await syncOne(mode, discount);
    promotionCode = await synced(mode, "promotion_code", discount.id);
  }
  if (!promotionCode) return { ok: false, problem: "That discount code cannot be used right now. Try again shortly." };
  return { ok: true, discount, promotionCode };
}
