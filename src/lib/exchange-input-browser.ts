/**
 * The customer's exchange wish (wave 3, D239, `docs/wave-3-exchanges.md` 2.1): the one field a visitor's client component types into, checked here without zod
 * (a visitor's bundle, D211) and again on the server by the same function. Plain text: cleaned by `cleanShopperText()`, refused when too long, never cut.
 */
import { cleanShopperText } from "./gift";
import { EXCHANGE_WISH_NOTE_MAX } from "./exchange-limits";

/** The lines a wish may have (a few lines of plain text). */
export const EXCHANGE_WISH_LINES = 10;

export type WishResult = { ok: true; note: string } | { ok: false; problem: "empty" | "too_long" | "too_many_lines"; over?: number };

export function cleanExchangeWish(value: unknown): WishResult {
  const r = cleanShopperText(value, { maxChars: EXCHANGE_WISH_NOTE_MAX, maxLines: EXCHANGE_WISH_LINES });
  if (!r.ok) return { ok: false, problem: r.problem, over: r.over };
  if (r.value === null) return { ok: false, problem: "empty" };
  return { ok: true, note: r.value };
}

export { EXCHANGE_WISH_NOTE_MAX };
