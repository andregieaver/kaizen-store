import "server-only";

import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { db } from "@/db/client";
import type { Address } from "./orders";

type Row = Record<string, unknown>;

/**
 * Customers' own accounts in a store (decision D28). Signing in needs no
 * password: the customer types their email and gets a six-digit code, which
 * also proves the address is theirs; a password can be added after that.
 * Guest checkout stays; orders and subscriptions with the same email appear
 * in the account. Each store has its own accounts and cookie.
 */

export const CODE_MINUTES = 10;
const CODE_TRIES = 5;
const CODES_PER_HOUR = 5;
const SESSION_DAYS = 60;
const PASSWORD_TRIES = 10;
const LOCK_MINUTES = 15;

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number, options: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password.normalize("NFKC"), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const normalEmail = (email: string) => email.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/**
 * A new sign-in code for an email, or null when too many were asked for in
 * the last hour. Earlier codes stop working.
 */
export async function createSignInCode(storeId: string, email: string): Promise<string | null> {
  const address = normalEmail(email);
  const [recent] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.customer_codes
    where store_id = ${storeId}::uuid and lower(email) = ${address} and created_at > now() - interval '1 hour'
  `);
  if (Number(recent?.n ?? 0) >= CODES_PER_HOUR) return null;
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db().execute(sql`
    update commerce.customer_codes set used_at = now()
    where store_id = ${storeId}::uuid and lower(email) = ${address} and used_at is null
  `);
  await db().execute(sql`
    insert into commerce.customer_codes (store_id, email, code_hash, expires_at)
    values (${storeId}::uuid, ${address}, ${sha256(`${storeId}:${address}:${code}`)},
            now() + make_interval(mins => ${CODE_MINUTES}))
  `);
  return code;
}

/**
 * Checks a code; on success the customer (created on first sign-in) gets a
 * session. Each wrong try counts, and a code takes five at most.
 */
export async function verifySignInCode(storeId: string, email: string, code: string): Promise<string | null> {
  const address = normalEmail(email);
  const [row] = await db().execute<Row>(sql`
    update commerce.customer_codes set attempts = attempts + 1
    where id = (
      select id from commerce.customer_codes
      where store_id = ${storeId}::uuid and lower(email) = ${address} and used_at is null
        and expires_at > now() and attempts < ${CODE_TRIES}
      order by created_at desc limit 1
    )
    returning id, code_hash
  `);
  if (!row) return null;
  const expected = Buffer.from(String(row.code_hash));
  const actual = Buffer.from(sha256(`${storeId}:${address}:${code.replace(/\s/g, "")}`));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  await db().execute(sql`update commerce.customer_codes set used_at = now() where id = ${String(row.id)}::uuid`);
  const customerId = await upsertCustomer(storeId, address);
  // The address is proven: orders placed with it belong to this account.
  await claimOrders(storeId, customerId, address);
  return customerId;
}

/** The customer with this email, created if new. */
async function upsertCustomer(storeId: string, email: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email)
    values (${storeId}::uuid, ${email})
    on conflict (store_id, lower(email)) do update set updated_at = now()
    returning id
  `);
  return String(row.id);
}

/** Links the store's orders and subscriptions with this email to the customer. */
async function claimOrders(storeId: string, customerId: string, email: string) {
  await db().execute(sql`
    update commerce.orders set customer_id = ${customerId}::uuid
    where store_id = ${storeId}::uuid and lower(email) = ${email} and customer_id is null
  `);
  await db().execute(sql`
    update commerce.subscriptions set customer_id = ${customerId}::uuid
    where store_id = ${storeId}::uuid and lower(email) = ${email} and customer_id is null
  `);
}

/**
 * After payment: the order (and its subscription) joins the account for its
 * email, if there is one. Accounts are only made by signing in.
 */
export async function linkOrderToCustomer(storeId: string, orderId: string): Promise<void> {
  const [row] = await db().execute<Row>(sql`
    select c.id from commerce.orders o
    join commerce.customers c on c.store_id = o.store_id and lower(c.email) = lower(o.email)
    where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid and o.email <> ''
  `);
  if (row) await claimOrders(storeId, String(row.id), await emailOf(storeId, String(row.id)));
}

async function emailOf(storeId: string, customerId: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    select lower(email) as email from commerce.customers where store_id = ${storeId}::uuid and id = ${customerId}::uuid
  `);
  return String(row?.email ?? "");
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export type PasswordOutcome = { ok: true; customerId: string } | { ok: false; locked: boolean };

/** Signs in with a password the customer chose; ten wrong tries lock it for 15 minutes. */
export async function signInWithPassword(storeId: string, email: string, password: string): Promise<PasswordOutcome> {
  const [row] = await db().execute<Row>(sql`
    select id, password_hash, locked_until > now() as locked from commerce.customers
    where store_id = ${storeId}::uuid and lower(email) = ${normalEmail(email)}
  `);
  // The same work when there is no such customer, so timing says nothing.
  const stored = row?.password_hash ? String(row.password_hash) : await hashPassword("no such customer");
  if (row?.locked) return { ok: false, locked: true };
  const ok = (await checkPassword(password, stored)) && Boolean(row?.password_hash);
  if (!row) return { ok: false, locked: false };
  if (!ok) {
    await db().execute(sql`
      update commerce.customers set failed_sign_ins = failed_sign_ins + 1,
        locked_until = case when failed_sign_ins + 1 >= ${PASSWORD_TRIES}
                            then now() + make_interval(mins => ${LOCK_MINUTES}) else locked_until end
      where id = ${String(row.id)}::uuid
    `);
    return { ok: false, locked: false };
  }
  await db().execute(sql`
    update commerce.customers set failed_sign_ins = 0, locked_until = null where id = ${String(row.id)}::uuid
  `);
  return { ok: true, customerId: String(row.id) };
}

export async function setPassword(storeId: string, customerId: string, password: string | null): Promise<void> {
  await db().execute(sql`
    update commerce.customers set password_hash = ${password ? await hashPassword(password) : null},
      failed_sign_ins = 0, locked_until = null, updated_at = now()
    where store_id = ${storeId}::uuid and id = ${customerId}::uuid
  `);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const cookieName = (storeId: string) => `account_${storeId}`;

/** Starts a session in this browser. */
export async function startSession(storeId: string, customerId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await db().execute(sql`
    insert into commerce.customer_sessions (store_id, customer_id, token_hash, expires_at)
    values (${storeId}::uuid, ${customerId}::uuid, ${sha256(token)}, now() + make_interval(days => ${SESSION_DAYS}))
  `);
  await db().execute(sql`
    update commerce.customers set last_sign_in_at = now() where id = ${customerId}::uuid
  `);
  (await cookies()).set(cookieName(storeId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function endSession(storeId: string): Promise<void> {
  const jar = await cookies();
  const token = jar.get(cookieName(storeId))?.value;
  if (token) {
    await db().execute(sql`delete from commerce.customer_sessions where token_hash = ${sha256(token)}`);
  }
  jar.delete(cookieName(storeId));
}

export type Customer = {
  id: string;
  email: string;
  name: string;
  phone: string;
  address: Address;
  hasPassword: boolean;
};

/** The signed-in customer in this store, or null. */
export async function getCustomer(storeId: string): Promise<Customer | null> {
  const token = (await cookies()).get(cookieName(storeId))?.value;
  if (!token || token.length > 100) return null;
  const [row] = await db().execute<Row>(sql`
    select c.id, c.email, c.name, c.phone, c.address, c.password_hash is not null as has_password
    from commerce.customer_sessions s
    join commerce.customers c on c.store_id = s.store_id and c.id = s.customer_id
    where s.store_id = ${storeId}::uuid and s.token_hash = ${sha256(token)} and s.expires_at > now()
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    phone: String(row.phone),
    address: (row.address ?? {}) as Address,
    hasPassword: Boolean(row.has_password),
  };
}

export async function updateCustomerDetails(
  storeId: string,
  customerId: string,
  details: { name: string; phone: string; address: Address },
): Promise<void> {
  await db().execute(sql`
    update commerce.customers set name = ${details.name}, phone = ${details.phone},
      address = ${JSON.stringify(details.address)}::jsonb, updated_at = now()
    where store_id = ${storeId}::uuid and id = ${customerId}::uuid
  `);
}

/**
 * Deletes the account: details, password and sessions go. Orders stay, as
 * bookkeeping law requires, but no longer belong to an account.
 */
export async function deleteCustomer(storeId: string, customerId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.execute(sql`update commerce.orders set customer_id = null where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid`);
    await tx.execute(sql`update commerce.subscriptions set customer_id = null where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid`);
    await tx.execute(sql`update commerce.carts set customer_id = null where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid`);
    await tx.execute(sql`delete from commerce.customers where store_id = ${storeId}::uuid and id = ${customerId}::uuid`);
  });
}

// ---------------------------------------------------------------------------
// What the account shows
// ---------------------------------------------------------------------------

export type CustomerOrder = {
  id: string;
  number: string;
  status: string;
  placedAt: string;
  totalMinor: number;
  currency: string;
  marketCode: string;
  items: number;
};

export async function listCustomerOrders(storeId: string, customerId: string): Promise<CustomerOrder[]> {
  const rows = await db().execute<Row>(sql`
    select o.id, o.number, o.status, o.placed_at, o.total_minor, o.currency, o.market_code,
      (select coalesce(sum(quantity), 0)::int from commerce.order_lines l where l.order_id = o.id) as items
    from commerce.orders o
    where o.store_id = ${storeId}::uuid and o.customer_id = ${customerId}::uuid and o.status <> 'pending_payment'
      and (o.status <> 'cancelled' or exists (select 1 from commerce.payments p where p.order_id = o.id and p.status = 'captured'))
    order by o.placed_at desc
    limit 200
  `);
  return rows.map((row) => ({
    id: String(row.id),
    number: String(row.number),
    status: String(row.status),
    placedAt: new Date(String(row.placed_at)).toISOString(),
    totalMinor: Number(row.total_minor),
    currency: String(row.currency),
    marketCode: String(row.market_code),
    items: Number(row.items),
  }));
}

/** Where the customer's latest order went, to start their saved address from. */
export async function lastShippingAddress(storeId: string, customerId: string): Promise<Address> {
  const [row] = await db().execute<Row>(sql`
    select shipping_address from commerce.orders
    where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid and shipping_address ? 'line1'
    order by placed_at desc limit 1
  `);
  return (row?.shipping_address ?? {}) as Address;
}

/** Whether the order belongs to the customer (for their order page). */
export async function ownsOrder(storeId: string, customerId: string, orderId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select 1 from commerce.orders where store_id = ${storeId}::uuid and id = ${orderId}::uuid and customer_id = ${customerId}::uuid
  `);
  return Boolean(row);
}

export type CustomerSubscription = {
  id: string;
  number: string;
  status: string;
  interval: string;
  intervalCount: number;
  totalMinor: number;
  currency: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  pausedUntil: string | null;
  trialEndsAt: string | null;
  manageToken: string;
  titles: string[];
};

export async function listCustomerSubscriptions(storeId: string, customerId: string): Promise<CustomerSubscription[]> {
  const rows = await db().execute<Row>(sql`
    select s.id, s.number, s.status, s.interval, s.interval_count, s.total_minor, s.currency, s.current_period_end,
      s.cancel_at_period_end, s.cancel_at, s.paused_until, s.trial_ends_at, s.manage_token,
      (select coalesce(json_agg(l.title order by l.title), '[]') from commerce.subscription_lines l where l.subscription_id = s.id) as titles
    from commerce.subscriptions s
    where s.store_id = ${storeId}::uuid and s.customer_id = ${customerId}::uuid and s.status not in ('pending', 'expired')
    order by (s.status = 'cancelled'), s.created_at desc
  `);
  return rows.map((row) => ({
    id: String(row.id),
    number: String(row.number),
    status: String(row.status),
    interval: String(row.interval),
    intervalCount: Number(row.interval_count),
    totalMinor: Number(row.total_minor),
    currency: String(row.currency),
    currentPeriodEnd: row.current_period_end ? new Date(String(row.current_period_end)).toISOString() : null,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    cancelAt: row.cancel_at ? new Date(String(row.cancel_at)).toISOString() : null,
    pausedUntil: row.paused_until ? new Date(String(row.paused_until)).toISOString() : null,
    trialEndsAt: row.trial_ends_at ? new Date(String(row.trial_ends_at)).toISOString() : null,
    manageToken: String(row.manage_token),
    titles: row.titles as string[],
  }));
}
