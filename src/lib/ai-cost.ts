/**
 * What the AI costs (D145, D146): a model's price per million tokens, and per picture, per minute of audio and per million
 * characters spoken, in US dollars, and what a call comes to. Amounts
 * are kept in millionths of a dollar, so a call costing a hundredth of a cent is not lost; prices are data the platform's
 * admin keeps (never a model in code), each counting from the day it was set. No secrets, no server code: the pages draw
 * from these too.
 */

/** Millionths of a US dollar. */
export type Micros = number;

export type ModelPrice = {
  provider: string;
  model: string;
  /** US dollars per million input tokens. */
  inputPerMillion: number;
  /** US dollars per million output tokens. */
  outputPerMillion: number;
  /** US dollars per picture made; null or left out: no price for pictures. */
  perImage?: number | null;
  /** US dollars per minute of audio listened to (speech to text, live voice calls). */
  perAudioMinute?: number | null;
  /** US dollars per million characters spoken (text to speech). */
  perMillionCharacters?: number | null;
  effectiveFrom: Date;
};

/** What one call (or a sum of them) used. */
export type CallAmounts = { inputTokens?: number; outputTokens?: number; images?: number; audioSeconds?: number; characters?: number };

/**
 * What a call comes to at a price, and whether it could be priced: `micros` is what the price covers, `priced` is false
 * when there is no price, or the call made pictures, listened or spoke where the price has none for that. A unit counts
 * only where the call reported no tokens (a model billed by tokens for its pictures or audio is priced by them). The
 * database works the same sums (`src/server/ai-price-sql.ts`).
 */
export function callCost(a: CallAmounts, price: ModelPrice | null): { micros: Micros; priced: boolean } {
  const tokens = Math.max(0, a.inputTokens ?? 0) + Math.max(0, a.outputTokens ?? 0);
  const images = Math.max(0, a.images ?? 0);
  const seconds = Math.max(0, a.audioSeconds ?? 0);
  const characters = Math.max(0, a.characters ?? 0);
  const did = tokens + images + seconds + characters > 0;
  if (!price) return { micros: 0, priced: !did };
  const micros = Math.round(
    Math.max(0, a.inputTokens ?? 0) * price.inputPerMillion +
      Math.max(0, a.outputTokens ?? 0) * price.outputPerMillion +
      images * (price.perImage ?? 0) * 1_000_000 +
      (seconds * (price.perAudioMinute ?? 0) * 1_000_000) / 60 +
      characters * (price.perMillionCharacters ?? 0),
  );
  const short = tokens === 0 && ((images > 0 && price.perImage == null) || (seconds > 0 && price.perAudioMinute == null) || (characters > 0 && price.perMillionCharacters == null));
  return { micros, priced: !short };
}

/** What a call's tokens cost at a price: dollars per million tokens is the same number as millionths of a dollar per token. */
export const costMicros = (inputTokens: number, outputTokens: number, price: Pick<ModelPrice, "inputPerMillion" | "outputPerMillion">): Micros =>
  Math.round(Math.max(0, inputTokens) * price.inputPerMillion + Math.max(0, outputTokens) * price.outputPerMillion);

/**
 * The price in force for a call: of the provider's prices, the ones for this model (exactly, or as the start of a dated
 * version's name before a dash) that had begun by then, the most specific model first and the latest start. The database
 * reads prices the same way (`priceFor()` in `src/server/ai-usage.ts`).
 */
export function matchPrice(prices: ModelPrice[], provider: string, model: string, at: Date): ModelPrice | null {
  const fits = (p: ModelPrice) => p.provider === provider && (p.model === model || model.startsWith(`${p.model}-`)) && p.effectiveFrom.getTime() <= at.getTime();
  return (
    prices
      .filter(fits)
      .sort((a, b) => b.model.length - a.model.length || b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0] ?? null
  );
}

const small = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const whole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$12.34" from a dollar up, below it up to four decimals without trailing zeros ("$0.50", "$0.0123": a few calls cost hundredths of a cent), "$0.00" for nothing. */
export function formatUsd(micros: Micros): string {
  if (!(micros > 0)) return "$0.00";
  const dollars = micros / 1_000_000;
  if (dollars >= 1) return whole.format(dollars);
  if (dollars < 0.0001) return "<$0.0001";
  return small.format(dollars);
}

/** A price per picture, minute or million as it is written: no trailing zeros, at most six decimals; "–" for none. */
export const formatUnitPrice = (dollars: number | null) => (dollars === null ? "–" : formatPerMillion(dollars));

/** A price per million tokens as it is written: no trailing zeros, at most six decimals. */
export const formatPerMillion = (dollars: number) => `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;

/** The most a price per million tokens may be: far above any model's, so a typo is caught. */
export const PRICE_MAX = 10_000;

export type PriceInput = {
  provider: string;
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  perImage: number | null;
  perAudioMinute: number | null;
  perMillionCharacters: number | null;
  note: string;
};

const amount = (text: string) => {
  const t = text.trim().replace(",", ".");
  if (!/^\d{1,5}(\.\d{1,6})?$/.test(t)) return null;
  const n = Number(t);
  return n <= PRICE_MAX ? n : null;
};

/** The price form's fields, checked: the problems in words, or the price. */
export function parsePriceForm(form: { get(name: string): FormDataEntryValue | null }): { ok: true; price: PriceInput } | { ok: false; problems: string[] } {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const problems: string[] = [];
  const provider = text("provider");
  const model = text("model");
  if (provider === "" || provider.length > 60) problems.push("Give the provider's name, such as openai.");
  if (model === "" || model.length > 200) problems.push("Give the model's name exactly as the usage pages show it.");
  const input = amount(text("input"));
  const output = amount(text("output"));
  if (input === null) problems.push(`Give the price per million input tokens in dollars, between 0 and ${PRICE_MAX.toLocaleString("en-US")}.`);
  if (output === null) problems.push(`Give the price per million output tokens in dollars (0 if the model has none), between 0 and ${PRICE_MAX.toLocaleString("en-US")}.`);
  // The other prices are left empty when the model has none: empty is "no price", and 0 is free.
  const unit = (name: string, words: string) => {
    if (text(name) === "") return null;
    const n = amount(text(name));
    if (n === null) problems.push(`Give the price ${words} in dollars, between 0 and ${PRICE_MAX.toLocaleString("en-US")}, or leave it empty if the model has none.`);
    return n;
  };
  const perImage = unit("per_image", "per picture");
  const perAudioMinute = unit("per_audio_minute", "per minute of audio");
  const perMillionCharacters = unit("per_million_characters", "per million characters spoken");
  const note = text("note").slice(0, 300);
  if (problems.length > 0 || input === null || output === null) return { ok: false, problems };
  return { ok: true, price: { provider, model, inputPerMillion: input, outputPerMillion: output, perImage, perAudioMinute, perMillionCharacters, note } };
}
