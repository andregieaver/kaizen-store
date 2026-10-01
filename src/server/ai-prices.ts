import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { parsePriceForm, type PriceInput } from "@/lib/ai-cost";

import { priceFor, unpricedSql } from "./ai-price-sql";
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
  /** Null: no price for this unit. */
  perImage: number | null;
  perAudioMinute: number | null;
  perMillionCharacters: number | null;
  effectiveFrom: string;
  note: string;
  /** In force today; the others are history. */
  current: boolean;
};

/** Every price, the model's current one marked, newest first within a model. */
export async function listPrices(): Promise<PriceLine[]> {
  const rows = await db().execute<Row>(sql`
    select p.id, p.provider, p.model, p.input_per_million::float8 as input_per_million, p.output_per_million::float8 as output_per_million,
      p.per_image::float8 as per_image, p.per_audio_minute::float8 as per_audio_minute, p.per_million_characters::float8 as per_million_characters,
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
    perImage: r.per_image === null ? null : Number(r.per_image),
    perAudioMinute: r.per_audio_minute === null ? null : Number(r.per_audio_minute),
    perMillionCharacters: r.per_million_characters === null ? null : Number(r.per_million_characters),
    effectiveFrom: new Date(String(r.effective_from)).toISOString(),
    note: String(r.note ?? ""),
    current: Boolean(r.current),
  }));
}

export type UnpricedModel = { provider: string; model: string; requests: number; tokens: number; images: number; audioSeconds: number; characters: number };

/**
 * Models used in the last 90 days that the usage pages cannot price, most used first: no price in force for the calls, or a
 * price with nothing for what they made (pictures, audio, speech). Shown as "No price" there.
 */
export async function unpricedModels(): Promise<UnpricedModel[]> {
  const rows = await db().execute<Row>(sql`
    select u.provider, u.model, sum(u.requests)::bigint as requests, sum(u.input_tokens + u.output_tokens)::bigint as tokens,
      sum(u.images)::bigint as images, sum(u.audio_seconds)::bigint as audio_seconds, sum(u.characters)::bigint as characters
    from commerce.ai_usage u
    ${priceFor}
    where u.created_at > now() - interval '90 days' and ${unpricedSql}
    group by u.provider, u.model
    order by tokens desc, images desc, audio_seconds desc, characters desc, u.model
  `);
  return rows.map((r) => ({
    provider: String(r.provider),
    model: String(r.model),
    requests: Number(r.requests),
    tokens: Number(r.tokens),
    images: Number(r.images),
    audioSeconds: Number(r.audio_seconds),
    characters: Number(r.characters),
  }));
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
    insert into commerce.ai_model_prices (provider, model, input_per_million, output_per_million, per_image, per_audio_minute, per_million_characters, effective_from, note, created_by)
    values (${p.provider}, ${p.model}, ${p.inputPerMillion}, ${p.outputPerMillion}, ${p.perImage}, ${p.perAudioMinute}, ${p.perMillionCharacters}, ${first ? sql`${BEGINNING}::timestamptz` : sql`now()`}, ${p.note}, ${account.id}::uuid)
  `);
  await audit(account.id, null, "platform.ai_price_set", { provider: p.provider, model: p.model, input: p.inputPerMillion, output: p.outputPerMillion, image: p.perImage, audio_minute: p.perAudioMinute, million_characters: p.perMillionCharacters, first });
  return { ok: true, first };
}
