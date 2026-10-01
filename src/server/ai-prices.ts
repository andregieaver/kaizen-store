import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { parsePriceForm, type PriceInput } from "@/lib/ai-cost";

import { audit, type Account } from "./auth";

type Row = Record<string, unknown>;

/** The day a model's first price counts from: the beginning, so usage before the price was entered is priced too. */
const BEGINNING = "2000-01-01T00:00:00Z";

export type PriceLine = {
  id: string;
  provider: string;
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  effectiveFrom: string;
  note: string;
  /** In force today; the others are history. */
  current: boolean;
};

/** Every price, the model's current one marked, newest first within a model. */
export async function listPrices(): Promise<PriceLine[]> {
  const rows = await db().execute<Row>(sql`
    select p.id, p.provider, p.model, p.input_per_million::float8 as input_per_million, p.output_per_million::float8 as output_per_million,
      p.effective_from, p.note,
      p.effective_from = (
        select max(q.effective_from) from commerce.ai_model_prices q
        where q.provider = p.provider and q.model = p.model and q.effective_from <= now()
      ) as current
    from commerce.ai_model_prices p
    order by p.provider, p.model, p.effective_from desc
  `);
  return rows.map((r) => ({
    id: String(r.id),
    provider: String(r.provider),
    model: String(r.model),
    inputPerMillion: Number(r.input_per_million),
    outputPerMillion: Number(r.output_per_million),
    effectiveFrom: new Date(String(r.effective_from)).toISOString(),
    note: String(r.note ?? ""),
    current: Boolean(r.current),
  }));
}

export type UnpricedModel = { provider: string; model: string; requests: number; tokens: number };

/** Models that used tokens in the last 90 days with no price in force for the calls, most used first: what the usage pages show as unpriced. */
export async function unpricedModels(): Promise<UnpricedModel[]> {
  const rows = await db().execute<Row>(sql`
    select u.provider, u.model, sum(u.requests)::bigint as requests, sum(u.input_tokens + u.output_tokens)::bigint as tokens
    from commerce.ai_usage u
    where u.created_at > now() - interval '90 days' and u.input_tokens + u.output_tokens > 0
      and not exists (
        select 1 from commerce.ai_model_prices pr
        where pr.provider = u.provider and (pr.model = u.model or left(u.model, length(pr.model) + 1) = pr.model || '-') and pr.effective_from <= u.created_at
      )
    group by u.provider, u.model
    order by tokens desc, u.model
  `);
  return rows.map((r) => ({ provider: String(r.provider), model: String(r.model), requests: Number(r.requests), tokens: Number(r.tokens) }));
}

/**
 * Sets a model's price (D145). A price never changes in place: this adds one that counts from now, or from the beginning
 * when the model has none yet, so a model entered for the first time prices its earlier usage too.
 */
export async function setPrice(account: Account, form: { get(name: string): FormDataEntryValue | null }): Promise<{ ok: true; first: boolean } | { ok: false; problems: string[] }> {
  const parsed = parsePriceForm(form);
  if (!parsed.ok) return parsed;
  const p: PriceInput = parsed.price;
  const [known] = await db().execute<Row>(sql`select 1 as one from commerce.ai_model_prices where provider = ${p.provider} and model = ${p.model} limit 1`);
  const first = !known;
  await db().execute(sql`
    insert into commerce.ai_model_prices (provider, model, input_per_million, output_per_million, effective_from, note, created_by)
    values (${p.provider}, ${p.model}, ${p.inputPerMillion}, ${p.outputPerMillion}, ${first ? sql`${BEGINNING}::timestamptz` : sql`now()`}, ${p.note}, ${account.id}::uuid)
  `);
  await audit(account.id, null, "platform.ai_price_set", { provider: p.provider, model: p.model, input: p.inputPerMillion, output: p.outputPerMillion, first });
  return { ok: true, first };
}
