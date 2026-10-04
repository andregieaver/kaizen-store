import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { ErasurePlan } from "@/lib/erasure-plan";

import { endSession, getCustomer, isSessionFresh } from "./customers";
import { eraseSubject, planErasure, type EraseResult } from "./privacy-erasure";
import { exportCustomerData, type ExportResult } from "./privacy-export";
import { resolveSubject } from "./privacy-subject";

/**
 * A shopper's own data (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.4): the entry points the shopper's pages and routes call. The account is
 * always the one signed in in this browser, never a value from the page, and a download or a deletion needs a **fresh** sign-in
 * (`FRESH_SIGN_IN_MINUTES`, a code or a password within them): a session that is only a day or a week old shows "Confirm it is you" and
 * does nothing. The pages and routes add `sameSite()` and the cache headers; a guest has no account and no self-service (the store's
 * privacy page tells how to ask).
 */

export type ShopperGate = { ok: false; problem: "signed_out" | "stale" | "busy" };

/** How many files one account may make in an hour: each is a full read of the account's data, a logged request and an audit entry. */
export const EXPORTS_PER_HOUR = 5;

/**
 * Counts one download against the account's hour, atomically (the counter table the other limits use, `chat_usage`: a keyed hash of the account, kept two
 * days, so it holds no address). False once the account is past its limit; nothing is read or written for it then.
 */
export async function takeExportSlot(storeId: string, customerId: string): Promise<boolean> {
  const bucket = `pexp:${createHash("sha256").update(`${customerId}|privacy-export`).digest("hex").slice(0, 24)}`;
  const [row] = await db().execute<Record<string, unknown>>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, ${bucket}, date_trunc('hour', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row.count) <= EXPORTS_PER_HOUR;
}

/** Who is signed in, and whether the session is fresh enough to download or delete. */
export async function shopperPrivacyState(storeId: string, now: Date = new Date()): Promise<{ signedIn: false } | { signedIn: true; customerId: string; email: string; fresh: boolean }> {
  const customer = await getCustomer(storeId);
  if (!customer) return { signedIn: false };
  return { signedIn: true, customerId: customer.id, email: customer.email, fresh: await isSessionFresh(storeId, now) };
}

/** The file for the signed-in shopper (their account, and guest orders under the same proven email). Never another account's. */
export async function shopperExport(storeId: string, now: Date = new Date(), deps: { rowLimit?: number } = {}): Promise<ExportResult | ShopperGate> {
  const state = await shopperPrivacyState(storeId, now);
  if (!state.signedIn) return { ok: false, problem: "signed_out" };
  if (!state.fresh) return { ok: false, problem: "stale" };
  if (!(await takeExportSlot(storeId, state.customerId))) return { ok: false, problem: "busy" };
  return exportCustomerData(storeId, { customerId: state.customerId }, { channel: "shopper", accountId: null, now, rowLimit: deps.rowLimit });
}

/**
 * What deleting the account would do, in counts and dates (the delete page: what goes, what stays and until when, subscriptions that end,
 * saved cards, credits lost). Read-only. Needs the shopper signed in, not a fresh session: the page may be read before the step-up.
 */
export async function shopperErasurePlan(storeId: string, now: Date = new Date()): Promise<{ ok: true; plan: ErasurePlan; fresh: boolean } | ShopperGate> {
  const state = await shopperPrivacyState(storeId, now);
  if (!state.signedIn) return { ok: false, problem: "signed_out" };
  const subject = await resolveSubject(storeId, { customerId: state.customerId }, { channel: "shopper" });
  const planned = subject ? await planErasure(subject, now) : null;
  if (!planned) return { ok: false, problem: "signed_out" };
  return { ok: true, plan: planned.plan, fresh: state.fresh };
}

/**
 * Deletes the signed-in shopper's account (the same erasure staff run: `eraseSubject()`), ends the session and says what became of it.
 * Subscriptions end now, saved cards are removed, credits are lost, orders the bookkeeping duty keeps are restricted. When Stripe did not
 * answer nothing was changed and the session stays.
 */
export async function shopperErase(storeId: string, now: Date = new Date(), deps: Parameters<typeof eraseSubject>[3] = {}): Promise<EraseResult | ShopperGate> {
  const state = await shopperPrivacyState(storeId, now);
  if (!state.signedIn) return { ok: false, problem: "signed_out" };
  if (!state.fresh) return { ok: false, problem: "stale" };
  const result = await eraseSubject(storeId, { customerId: state.customerId }, { channel: "shopper", accountId: null, now }, deps);
  // The account is gone, so is its session row; the cookie is let go of too.
  if (result.ok) await endSession(storeId);
  return result;
}
