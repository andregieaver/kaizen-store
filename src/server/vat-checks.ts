import "server-only";

import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { normaliseVatNumber, sameVatNumber, type VatNumberProblem } from "@/lib/vat-number";
import {
  VIES_CACHE_HOURS,
  VIES_LIMIT_OWNER_PER_HOUR,
  VIES_LIMIT_PER_CART_PER_HOUR,
  VIES_LIMIT_PER_CLIENT_PER_HOUR,
  VIES_LIMIT_PER_STORE_PER_HOUR,
  VIES_RESERVE_FOR_REFRESH_PER_HOUR,
  buyerVatState,
  splitStoredNumber,
  type BuyerVatState,
  type ViesAnswer,
  type ViesStatus,
} from "@/lib/vies";

import { addressOf, visitSecret } from "./analytics-visits";
import type { BrregLookup } from "./brreg";
import { checkVatNumber, type ViesDeps } from "./vies";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * The log, the 24 hour cache and the rate limit of VAT number checks (D157, docs/wave-1a-tax.md sections 3.5 and 4.3).
 * Every answer to "is this number valid?" is a row in `commerce.vat_checks` (immutable): a buyer's, typed at the cart, and
 * the seller's own, on the tax screen. The row is also what `placeOrder()` and `cartSummary()` read, so nothing here is ever
 * called while an order is being placed: a check is made before, through `checkCartVatNumber()`, and a check older than
 * 24 hours is only *stale* (VAT is charged) until it is made again.
 *
 * Private: a buyer's number and VIES's answer are read by the cart, the order and the shopper's own pages and email, and
 * by staff with access to the order; `src/lib/vat-readers.test.ts` lists the modules allowed to read them.
 */

export type VatCheck = {
  id: string;
  purpose: "buyer" | "seller";
  cartId: string | null;
  /** Normalised, with the country prefix. */
  number: string;
  status: ViesStatus;
  source: "vies" | "brreg";
  /** VIES's own words, for staff: never shown to shoppers. */
  name: string | null;
  address: string | null;
  /** VIES's consultation number, the seller's proof of the check. */
  requestIdentifier: string | null;
  error: string | null;
  requestedAt: string;
};

export const toCheck = (row: Row): VatCheck => ({
  id: String(row.id),
  purpose: row.purpose === "seller" ? "seller" : "buyer",
  cartId: row.cart_id ? String(row.cart_id) : null,
  number: String(row.number),
  status: row.status === "valid" ? "valid" : row.status === "invalid" ? "invalid" : "unavailable",
  source: row.source === "brreg" ? "brreg" : "vies",
  name: row.name ? String(row.name) : null,
  address: row.address ? String(row.address) : null,
  requestIdentifier: row.request_identifier ? String(row.request_identifier) : null,
  error: row.error ? String(row.error) : null,
  requestedAt: new Date(String(row.requested_at)).toISOString(),
});

/** Writes one answer to the log. */
export async function recordCheck(
  runner: Runner,
  input: { storeId: string; purpose: "buyer" | "seller"; cartId: string | null; number: string; answer: ViesAnswer; source?: "vies" | "brreg" },
): Promise<VatCheck> {
  const { storeId, purpose, cartId, number, answer } = input;
  const [row] = await runner.execute<Row>(sql`
    insert into commerce.vat_checks (store_id, purpose, cart_id, number, country_prefix, status, source, name, address, request_identifier, error)
    values (${storeId}::uuid, ${purpose}, ${cartId}::uuid, ${number}, ${number.slice(0, 2)}, ${answer.status}, ${input.source ?? "vies"},
            ${answer.name}, ${answer.address}, ${answer.requestIdentifier}, ${answer.error})
    returning *
  `);
  return toCheck(row);
}

/** One check by id, of this store. */
export async function getCheck(runner: Runner, storeId: string, id: string): Promise<VatCheck | null> {
  const [row] = await runner.execute<Row>(sql`
    select * from commerce.vat_checks where store_id = ${storeId}::uuid and id = ${id}::uuid
  `);
  return row ? toCheck(row) : null;
}

/** What the cart's check says about its number, now: `none`, `valid`, `stale`, `invalid` or `unavailable`. */
export const stateOfCheck = (check: VatCheck | null, now: Date = new Date()): BuyerVatState =>
  buyerVatState(check ? { status: check.status, requestedAt: check.requestedAt } : null, now);

/** The latest definite answer (valid or invalid) for a store's number made in the last 24 hours, to reuse instead of asking again. */
async function cachedCheck(runner: Runner, storeId: string, number: string, now: Date): Promise<VatCheck | null> {
  const [row] = await runner.execute<Row>(sql`
    select * from commerce.vat_checks
    where store_id = ${storeId}::uuid and number = ${number} and purpose = 'buyer' and status in ('valid', 'invalid')
      and requested_at > ${now.toISOString()}::timestamptz - make_interval(hours => ${VIES_CACHE_HOURS})
    order by requested_at desc limit 1
  `);
  return row ? toCheck(row) : null;
}

/**
 * Takes one live VIES request from a bucket's count for this clock hour, atomically: the row is created or counted up in one
 * statement, so requests in parallel each get their own number and only the first `cap` of them are under it. A request
 * over the cap has still been counted (it costs nothing: nothing is asked). Counts live in `commerce.chat_usage` with the
 * other rate-limit counters (two days, pruned by the cron).
 */
async function takeCount(runner: Runner, storeId: string, bucket: string): Promise<number> {
  const [row] = await runner.execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, ${bucket}, date_trunc('hour', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row?.count ?? 0);
}

export type ViesSlotRequest = {
  storeId: string;
  cartId: string | null;
  /** A keyed hash of the shopper's address (`viesClientKey()`), or null when there is none (the client limit is then not applied). */
  clientKey: string | null;
  /** The cart already holds a valid answer and asks again (a stale one): it may use the store's reserve. */
  refresh: boolean;
};

/**
 * Reserves a live VIES request for a shopper before it is made: the client's, the cart's and the store's shoppers' counts, in
 * that order, so a request refused for the client or the cart does not use up the store's. False when any is over its limit.
 * The store owner's own checks have a pool of their own (`takeOwnerSlot()`), so shoppers cannot use it up.
 */
export async function takeShopperSlot(runner: Runner, request: ViesSlotRequest): Promise<boolean> {
  const { storeId, cartId, clientKey, refresh } = request;
  if (clientKey && (await takeCount(runner, storeId, `vies:c:${clientKey}`)) > VIES_LIMIT_PER_CLIENT_PER_HOUR) return false;
  if (cartId && (await takeCount(runner, storeId, `vies:k:${cartId}`)) > VIES_LIMIT_PER_CART_PER_HOUR) return false;
  const cap = VIES_LIMIT_PER_STORE_PER_HOUR + (refresh ? VIES_RESERVE_FOR_REFRESH_PER_HOUR : 0);
  return (await takeCount(runner, storeId, "vies:s")) <= cap;
}

/** Reserves a live VIES request for the store owner's own number. */
export async function takeOwnerSlot(runner: Runner, storeId: string): Promise<boolean> {
  return (await takeCount(runner, storeId, "vies:o")) <= VIES_LIMIT_OWNER_PER_HOUR;
}

/**
 * The shopper as the VIES limit knows them: a keyed hash of the address, for the day, so the counter holds no address and
 * none that could be looked up without the server's secret (the way visit counting keeps its own limits). Null when the
 * request carries no address or there is no secret: the client limit is then not applied (the cart's and the store's are).
 */
export function viesClientKey(storeId: string, headers: Headers, now: Date = new Date()): string | null {
  const secret = visitSecret();
  const address = addressOf(headers);
  if (!secret || address === "") return null;
  return createHmac("sha256", secret).update(`vies-client|${storeId}|${now.toISOString().slice(0, 10)}|${address}`).digest("hex").slice(0, 24);
}

export type CartVatOutcome =
  /** Nothing typed: the number and its check are taken off the cart. */
  | { ok: true; outcome: "cleared" }
  /** The answer, kept on the cart; what it means for the order is `vatTreatment()`'s. */
  | { ok: true; outcome: "valid" | "invalid" | "unavailable" | "not_eu" | "own_number"; number: string; check: VatCheck | null; cached: boolean }
  /** What was typed is not a VAT number's shape: nothing is kept. */
  | { ok: false; problem: VatNumberProblem | "no_cart" };

export type CartVatDeps = ViesDeps & {
  now?: Date;
  /** The shopper's `viesClientKey()`, for the per-client limit. */
  clientKey?: string | null;
  /** The cart holds a valid answer and asks again: it may use the store's reserve (`refreshStaleCartCheck()`). */
  refresh?: boolean;
};

/**
 * The shopper's VAT number for their cart (B2B): normalised (the prefix may be left out: it is taken from the delivery
 * country), checked against VIES unless a definite answer is less than 24 hours old, the answer logged and the number
 * and the check kept on the cart. A VIES failure is *unavailable*, which charges VAT and stops nothing. The number's own
 * country must be the delivery country for reverse charge, but that is the treatment's rule, not this function's: a
 * number for another country is checked and kept like any other, and the cart says why VAT is charged.
 */
export async function checkCartVatNumber(
  shop: { storeId: string; market: { code: string } },
  cartId: string,
  typed: string,
  deps: CartVatDeps = {},
): Promise<CartVatOutcome> {
  const { storeId } = shop;
  const now = deps.now ?? new Date();
  const [cart] = await db().execute<Row>(sql`
    select c.id, p.vat_number as seller_number
    from commerce.carts c
    left join commerce.store_tax_profile p on p.store_id = c.store_id
    where c.store_id = ${storeId}::uuid and c.id = ${cartId}::uuid and c.market_code = ${shop.market.code}
      and c.status = 'open' and c.expires_at > now()
  `);
  if (!cart) return { ok: false, problem: "no_cart" };

  if (typed.trim() === "") {
    await setCartVat(storeId, cartId, null, null);
    return { ok: true, outcome: "cleared" };
  }
  const normalised = normaliseVatNumber(shop.market.code, typed);
  if (!normalised.ok) return { ok: false, problem: normalised.problem };
  const number = normalised.number;

  // Not asked: a number that cannot be used, and the store's own (VAT is charged either way, the cart says why).
  if (!normalised.inEu) {
    await setCartVat(storeId, cartId, number, null);
    return { ok: true, outcome: "not_eu", number, check: null, cached: false };
  }
  if (cart.seller_number && sameVatNumber(String(cart.seller_number), number)) {
    await setCartVat(storeId, cartId, number, null);
    return { ok: true, outcome: "own_number", number, check: null, cached: false };
  }

  const cached = await cachedCheck(db(), storeId, number, now);
  if (cached) {
    await setCartVat(storeId, cartId, number, cached.id);
    return { ok: true, outcome: cached.status === "valid" ? "valid" : "invalid", number, check: cached, cached: true };
  }

  // A slot is taken before VIES is asked (atomically, so parallel requests cannot all pass); over a limit nothing is asked
  // and nothing is logged (so a flood adds no rows): the cart keeps the number, with its latest earlier answer for it if
  // there is one, and the shopper is told it could not be checked now.
  if (!(await takeShopperSlot(db(), { storeId, cartId, clientKey: deps.clientKey ?? null, refresh: deps.refresh === true }))) {
    const [latest] = await db().execute<Row>(sql`
      select id from commerce.vat_checks where store_id = ${storeId}::uuid and cart_id = ${cartId}::uuid and number = ${number}
      order by requested_at desc limit 1
    `);
    await setCartVat(storeId, cartId, number, latest ? String(latest.id) : null);
    return { ok: true, outcome: "unavailable", number, check: null, cached: false };
  }

  // The store's own number, when it was checked valid, makes VIES answer with a consultation number.
  const [seller] = await db().execute<Row>(sql`
    select vat_number from commerce.store_tax_profile where store_id = ${storeId}::uuid and vat_number_valid is true
  `);
  // (A number that is not a member state's is left out of the request by `viesRequestBody()`.)
  const requester = seller?.vat_number ? String(seller.vat_number) : null;
  const answer = await checkVatNumber(number, requester, deps);
  const check = await recordCheck(db(), { storeId, purpose: "buyer", cartId, number, answer });
  await setCartVat(storeId, cartId, number, check.id);
  return { ok: true, outcome: check.status, number, check, cached: false };
}

/** Keeps the typed number and its check on the cart (null clears them). */
export async function setCartVat(storeId: string, cartId: string, number: string | null, checkId: string | null): Promise<void> {
  await db().execute(sql`
    update commerce.carts set vat_number = ${number}, vat_check_id = ${checkId}::uuid, updated_at = now()
    where store_id = ${storeId}::uuid and id = ${cartId}::uuid and status = 'open'
  `);
}

/**
 * A stale check (a valid answer older than 24 hours) asked again before checkout starts, so the order is placed with a
 * current answer. Called by `startCheckout()` outside the order's transaction; never throws, never blocks.
 */
export async function refreshStaleCartCheck(
  shop: { storeId: string; market: { code: string } },
  cartId: string,
  deps: CartVatDeps = {},
): Promise<void> {
  try {
    const now = deps.now ?? new Date();
    const [row] = await db().execute<Row>(sql`
      select c.vat_number, k.status, k.requested_at
      from commerce.carts c
      left join commerce.vat_checks k on k.store_id = c.store_id and k.id = c.vat_check_id
      where c.store_id = ${shop.storeId}::uuid and c.id = ${cartId}::uuid and c.status = 'open'
    `);
    if (!row?.vat_number) return;
    const state = buyerVatState(row.status ? { status: row.status as ViesStatus, requestedAt: new Date(String(row.requested_at)) } : null, now);
    // Only a stale valid answer, or an answer that could not be had, is asked again; a definite "invalid" stays.
    if (state === "stale" || state === "unavailable") {
      await checkCartVatNumber(shop, cartId, String(row.vat_number), { ...deps, refresh: row.status === "valid" });
    }
  } catch {
    // A VAT check never stops a checkout: VAT is charged until there is a current answer.
  }
}

// ---------------------------------------------------------------------------
// The seller's own number
// ---------------------------------------------------------------------------

export type SellerCheckDeps = CartVatDeps & {
  /** Brønnøysundregistrene's lookup, injected in tests (`lookupCompany` by default). */
  brreg?: (input: string) => Promise<BrregLookup>;
};

/**
 * Checks the store's own VAT number: an EU number against VIES (without the requester: the answer cannot carry the
 * store's own consultation number), a Norwegian one against the open register. The answer is logged as a `seller` check;
 * the caller copies it to the profile (`saveSellerCheck()` in `tax-profile.ts`).
 */
export async function checkSellerNumber(storeId: string, number: string, deps: SellerCheckDeps = {}): Promise<VatCheck> {
  if (number.startsWith("NO")) {
    const lookup = deps.brreg ?? (async (input: string) => (await import("./brreg")).lookupCompany(input));
    const found = await lookup(number);
    const answer: ViesAnswer = found.ok
      ? {
          status: found.company.vatRegistered ? "valid" : "invalid",
          name: found.company.legalName,
          address: found.company.address ? [found.company.address.line1, found.company.address.postalCode, found.company.address.city].filter(Boolean).join(", ") || null : null,
          requestIdentifier: null,
          error: null,
        }
      : found.reason === "unavailable"
        ? { status: "unavailable", name: null, address: null, requestIdentifier: null, error: "brreg_unavailable" }
        : { status: "invalid", name: null, address: null, requestIdentifier: null, error: `brreg_${found.reason}` };
    return recordCheck(db(), { storeId, purpose: "seller", cartId: null, number, answer, source: "brreg" });
  }
  // The caller normalised it (`normaliseSellerVatNumber()`); a number that is not in stored form is a bug, not an answer.
  if (!splitStoredNumber(number)) throw new Error("checkSellerNumber needs a normalised VAT number");
  const answer: ViesAnswer = !(await takeOwnerSlot(db(), storeId))
    ? { status: "unavailable", name: null, address: null, requestIdentifier: null, error: "limit" }
    : await checkVatNumber(number, null, deps);
  return recordCheck(db(), { storeId, purpose: "seller", cartId: null, number, answer });
}

// ---------------------------------------------------------------------------
// Upkeep
// ---------------------------------------------------------------------------

const RETENTION_DAYS = 30;
const BATCH = 500;

/**
 * The daily job: forgets what a shopper typed once the cart that held it is over, then checks older than 30 days that
 * nothing rests on.
 *
 * 1. A cart that expired more than 30 days ago, or that is no longer open (converted) and was last touched more than 30 days
 *    ago, lets go of its VAT number and its check (nothing deletes carts, so without this a number typed once would stay for
 *    ever, with the name and address VIES gave for it). A converted cart's number lives on its order
 *    (the order's kept treatment), which is the record.
 * 2. A check older than 30 days that no order, no cart (the foreign key would refuse) and no store profile points at is deleted.
 *    A check an order rests on lives as long as the order. A cart still pointing at an old check keeps it until step 1 has
 *    let go of it, so a buyer's number and VIES's name for it live at most 30 days past the end of their cart.
 *
 * Never throws: what it managed is returned.
 */
export async function pruneVatChecks(): Promise<{ deleted: number; cartsCleared: number }> {
  let deleted = 0;
  let cartsCleared = 0;
  try {
    for (let batch = 0; batch < 20; batch++) {
      const cleared = await db().execute<Row>(sql`
        update commerce.carts set vat_number = null, vat_check_id = null
        where id in (
          select t.id from commerce.carts t
          where (t.vat_number is not null or t.vat_check_id is not null)
            and (
              (t.status = 'open' and t.expires_at < now() - make_interval(days => ${RETENTION_DAYS}))
              or (t.status <> 'open' and t.updated_at < now() - make_interval(days => ${RETENTION_DAYS}))
            )
          limit ${BATCH}
        ) returning 1
      `);
      cartsCleared += cleared.length;
      if (cleared.length < BATCH) break;
    }
    for (let batch = 0; batch < 20; batch++) {
      const gone = await db().execute<Row>(sql`
        delete from commerce.vat_checks k where k.id in (
          select c.id from commerce.vat_checks c
          where c.requested_at < now() - make_interval(days => ${RETENTION_DAYS})
            and not exists (select 1 from commerce.orders o where o.store_id = c.store_id and o.vat_check_id = c.id)
            and not exists (select 1 from commerce.carts t where t.store_id = c.store_id and t.vat_check_id = c.id)
            and not exists (select 1 from commerce.store_tax_profile p where p.store_id = c.store_id and p.vat_number_check_id = c.id)
          limit ${BATCH}
        ) returning 1
      `);
      deleted += gone.length;
      if (gone.length < BATCH) break;
    }
  } catch {
    // Upkeep never stops the cron.
  }
  return { deleted, cartsCleared };
}
