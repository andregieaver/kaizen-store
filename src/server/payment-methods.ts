import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  BANK_WAIT_DAYS,
  excludedTypes,
  methodInfo,
  SWITCHABLE_METHODS,
  type CapabilityState,
  type MethodChoice,
} from "@/lib/payment-methods";
import type { PaymentModeName } from "@/lib/stripe-account";

import { audit } from "./auth";

type Row = Record<string, unknown>;

/**
 * Payment methods per country (wave 4 unit D, D291): the owner's choices (`commerce.payment_methods`: a row with `enabled = false` switches a method
 * off for a country; no row is on), what each country's checkout leaves out, the capability states Stripe last reported, and the order that waits for
 * a bank payment. Stripe still decides what it shows a shopper among what is left.
 */

/** The store's saved choices, every country. */
export async function methodChoices(storeId: string): Promise<MethodChoice[]> {
  const rows = await db().execute<Row>(sql`
    select market_code, method, enabled from commerce.payment_methods where store_id = ${storeId}::uuid
  `);
  return rows.map((r) => ({ market: String(r.market_code).trim(), method: String(r.method), enabled: Boolean(r.enabled) }));
}

/**
 * The methods a country's checkout sessions pass in `excluded_payment_method_types` (never `payment_method_types`): the owner's choices for the
 * country, and for an order those a checkout rule left out when it was placed (D357, `orders.rule_hidden_methods`). Never cards.
 */
export async function excludedPaymentMethods(storeId: string, marketCode: string, orderId: string | null = null): Promise<string[]> {
  const own = excludedTypes(await methodChoices(storeId), marketCode);
  if (!orderId) return own;
  const [order] = await db().execute<Row>(sql`
    select rule_hidden_methods from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid
  `);
  const byRule = (Array.isArray(order?.rule_hidden_methods) ? order.rule_hidden_methods : []).map(String).filter((m) => methodInfo(m) && !methodInfo(m)!.always);
  return [...new Set([...own, ...byRule])].sort();
}

/**
 * Saves which methods are on for which of the store's countries. Only switchable methods and the store's own countries are written; a country left out
 * keeps what it had (a hidden country's choice stays, D178 step 4). Audited with what changed, never anything else.
 */
export async function saveMethodChoices(
  storeId: string,
  accountId: string,
  input: { markets: readonly string[]; on: ReadonlySet<string> },
): Promise<{ changed: number }> {
  const [own] = await db().execute<Row>(sql`
    select array_agg(code::text) as codes from commerce.markets where store_id = ${storeId}::uuid
  `);
  const codes = new Set(((own?.codes as string[] | null) ?? []).map((c) => c.trim()));
  const markets = input.markets.filter((m) => codes.has(m));
  const before = await methodChoices(storeId);
  const changes: { market: string; method: string; enabled: boolean }[] = [];
  for (const market of markets)
    for (const method of SWITCHABLE_METHODS) {
      const enabled = input.on.has(`${market}:${method.type}`);
      const was = !before.some((c) => c.market === market && c.method === method.type && !c.enabled);
      if (was !== enabled) changes.push({ market, method: method.type, enabled });
    }
  if (changes.length === 0) return { changed: 0 };
  await db().transaction(async (tx) => {
    for (const c of changes)
      await tx.execute(sql`
        insert into commerce.payment_methods (store_id, market_code, method, enabled, updated_by)
        values (${storeId}::uuid, ${c.market}, ${c.method}, ${c.enabled}, ${accountId}::uuid)
        on conflict (store_id, market_code, method) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()
      `);
  });
  await audit(accountId, storeId, "payments.methods_changed", {
    on: changes.filter((c) => c.enabled).map((c) => `${c.market}:${c.method}`),
    off: changes.filter((c) => !c.enabled).map((c) => `${c.market}:${c.method}`),
  });
  return { changed: changes.length };
}

/** What Stripe last said of each capability on the store's account in a mode, as kept by `saveStatus()`; null when there is no account. */
export async function methodStates(storeId: string, mode: PaymentModeName): Promise<Record<string, CapabilityState> | null> {
  const [row] = await db().execute<Row>(sql`
    select method_states from commerce.stripe_accounts where store_id = ${storeId}::uuid and mode = ${mode}
  `);
  if (!row) return null;
  const states = row.method_states as Record<string, CapabilityState> | null;
  return states && Object.keys(states).length > 0 ? states : null;
}

/**
 * The shopper finished paying with a bank method whose money arrives days later (the session is complete and unpaid, and no card is held): the
 * order waits for the bank, its stock and booked times held for `BANK_WAIT_DAYS` (`commerce.await_bank_payment()`). True the first time.
 */
export async function awaitBankPayment(storeId: string, sessionId: string, now: Date = new Date()): Promise<boolean> {
  const [payment] = await db().execute<Row>(sql`
    select order_id from commerce.payments where store_id = ${storeId}::uuid and provider = 'stripe' and provider_reference = ${sessionId}
  `);
  if (!payment) return false;
  const until = new Date(now.getTime() + BANK_WAIT_DAYS * 86_400_000);
  const [done] = await db().execute<Row>(sql`
    select commerce.await_bank_payment(${String(payment.order_id)}::uuid, ${sessionId}, ${until.toISOString()}::timestamptz) as ok
  `);
  return Boolean(done?.ok);
}

/** A method's name for the owner, or the type itself for one Kaizena Flow does not list. */
export function methodLabel(type: string): string {
  return methodInfo(type)?.label ?? type;
}
