import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { searchNames, SUGGESTED_TLDS, type DomainOffer, type SearchAnswer } from "@/lib/domain-search";

import { priceContext, priceIn, type PriceContext } from "./domain-prices";
import { registrarFor, supportedTlds } from "./registrars";
import { RegistrarError, type DomainRegistrar, type SearchResult } from "./registrars/types";

type Row = Record<string, unknown>;

/**
 * Domain search (D315, `docs/domains.md` 4.2): keyword only, never a model call. The names come from what was typed (`searchNames()`), the
 * answers from the registrar that sells each TLD, the prices from `domainPrice()` in the asker's currency. Limited per store or per hashed
 * visitor and in all, through `commerce.chat_usage` (as VIES is, D157): a search over a limit asks nothing of the registrar.
 */

/** Searches a store's admin may make in an hour, a visitor of Kaizena Flow's own pages, and everyone together. */
export const SEARCHES_PER_STORE_PER_HOUR = 60;
export const SEARCHES_PER_VISITOR_PER_HOUR = 20;
export const SEARCHES_ALL_PER_HOUR = 1_000;

export async function take(store: string | null, bucket: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${store}::uuid, ${bucket}, date_trunc('hour', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row?.count ?? 0);
}

/** A visitor's key for the limit: a hash of their address and today, so no address is kept. */
export const visitorKey = (address: string): string =>
  createHash("sha256").update(`${address}|${new Date().toISOString().slice(0, 10)}|kaizena-domain-search`).digest("hex").slice(0, 24);

export type Asker = { store: string } | { visitor: string };

/** Reserves one search for a store or a visitor; false when over a limit. */
export async function takeSearchSlot(asker: Asker): Promise<boolean> {
  if ("store" in asker) {
    if ((await take(asker.store, "domains:search")) > SEARCHES_PER_STORE_PER_HOUR) return false;
  } else if ((await take(null, `domains:public:${asker.visitor}`)) > SEARCHES_PER_VISITOR_PER_HOUR) return false;
  return (await take(null, "domains:search:all")) <= SEARCHES_ALL_PER_HOUR;
}

export type { SearchAnswer };

const MESSAGES = {
  limit: "That's a lot of searches. Try again in a little while.",
  empty: "Type a name, like your store's, to see which domains are free.",
  unavailable: "Domain search can't be reached just now. Try again in a moment.",
} as const;

/**
 * Searches for `query`: the exact name typed, and the same name under the suggested endings the registrars sell. Each answer says whether it
 * is free, and what it costs a year in `currency` (the first year and each renewal), or why it is not offered (taken, premium, an ending not
 * sold yet). `owned` are names the store already has, which say so.
 */
export async function searchDomains(
  query: string,
  { asker, currency, tlds = SUGGESTED_TLDS, owned = [] }: { asker: Asker; currency: string | null; tlds?: readonly string[]; owned?: readonly string[] },
): Promise<SearchAnswer> {
  const sold = new Set([...(await supportedTlds()).values()].flatMap((s) => [...s]));
  const names = searchNames(query, tlds);
  if (names.length === 0) return { ok: false, reason: "empty", message: MESSAGES.empty };
  if (!(await takeSearchSlot(asker))) return { ok: false, reason: "limit", message: MESSAGES.limit };
  const ctx = await priceContext(currency);
  const offers: DomainOffer[] = [];
  const toAsk = names.filter((n) => sold.has(n.split(".").slice(1).join(".")));
  // One question per registrar; today that is Vercel for every ending it sells.
  const byRegistrar = new Map<string, { registrar: DomainRegistrar; names: string[] }>();
  for (const name of toAsk) {
    const registrar = await registrarFor(name);
    if (!registrar) continue;
    const group = byRegistrar.get(registrar.id) ?? { registrar, names: [] };
    group.names.push(name);
    byRegistrar.set(registrar.id, group);
  }
  const answers = new Map<string, SearchResult>();
  try {
    for (const { registrar, names: list } of byRegistrar.values()) {
      for (const r of await registrar.search(list)) answers.set(r.domain, r);
    }
  } catch (error) {
    if (error instanceof RegistrarError) return { ok: false, reason: "unavailable", message: MESSAGES.unavailable };
    throw error;
  }
  for (const name of names) {
    if (owned.includes(name)) {
      offers.push({ domain: name, state: "yours", firstYear: null, renewal: null });
      continue;
    }
    const a = answers.get(name);
    if (!a) {
      offers.push({ domain: name, state: "not_sold", firstYear: null, renewal: null });
      continue;
    }
    if (!a.available) offers.push({ domain: name, state: "taken", firstYear: null, renewal: null });
    else if (a.premium) offers.push({ domain: name, state: "premium", firstYear: null, renewal: null });
    else offers.push({ domain: name, state: "available", ...pricesOf(ctx, a.price, a.renewalPrice) });
  }
  return { ok: true, offers, currency: ctx ? ctx.pricing.currency : null };
}

function pricesOf(ctx: PriceContext | null, price: number | null, renewal: number | null): Pick<DomainOffer, "firstYear" | "renewal"> {
  if (!ctx || price === null) return { firstYear: null, renewal: null };
  return { firstYear: priceIn(ctx, price, "USD", 1), renewal: renewal === null ? null : priceIn(ctx, renewal, "USD", 1) };
}
