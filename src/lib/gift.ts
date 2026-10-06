/**
 * A gift message and the cleaning of text a shopper types (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.1 and 4.8).
 *
 * The cart page is a pay route (`/cart`, D158): its client bundle must stay free of zod and of every server module, so this file imports neither `zod` nor
 * `server-only` (`pay-routes.graph.test.ts` holds the cart's gift component to that). It is pure and the same function runs in the browser (the live
 * counter, the refusal) and on the server (`setCartGift()`, `placeOrder()`), so what the shopper sees counted is what is checked.
 *
 * The text is the shopper's own words, never HTML: React escapes it on screens, `renderEmail()` escapes it in the confirmation, the packing slip uses
 * `white-space: pre-line`. It is not run through the claims filter (that is for AI-written copy) nor through a translation catalogue, and it is never put in
 * a URL, a Stripe field, structured data, a feed or a log line. A text over the limit is REFUSED with its excess, never cut: the shopper decides what to leave out.
 */
import { GIFT_MESSAGE_LINES, GIFT_MESSAGE_MAX, GIFT_NAME_MAX } from "./order-limits";

export { GIFT_MESSAGE_LINES, GIFT_MESSAGE_MAX, GIFT_NAME_MAX };

export type ShopperTextLimits = { maxChars: number; maxLines: number };

export type ShopperTextResult =
  /** `value` is null when nothing is left after cleaning. */
  | { ok: true; value: string | null }
  /** `over` is how many characters (or lines) too many the cleaned text has. */
  | { ok: false; problem: "too_long" | "too_many_lines"; over: number };

/**
 * The characters that can disguise text and are removed: the bidirectional embeddings, overrides and isolates (U+202A to U+202E, U+2066 to U+2069) and the
 * zero-width characters (U+200B to U+200D, U+FEFF). Written as escapes so this source holds none of them.
 */
const DISGUISING = /[\u202a-\u202e\u2066-\u2069\u200b-\u200d\ufeff]/g;
/** Every control character (C0, DEL and C1) but the newline, which is kept. */
const CONTROLS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;

/** The length in Unicode code points (an emoji, or a letter typed with a combining mark already composed, is one). */
export const codePoints = (value: string): number => [...value].length;

/** The text as it would be kept, whatever its length: NFC, new lines unified, controls and disguising characters removed, lines and ends trimmed. */
function normalise(value: string): string {
  const text = value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROLS, "")
    .replace(DISGUISING, "")
    .split("\n")
    .map((line) => line.replace(/[ \u00a0]+$/g, ""))
    .join("\n")
    // Three or more new lines are two: a blank line is a paragraph, no more.
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

/**
 * Cleans a text a shopper typed: Unicode NFC; `\r\n` and `\r` to `\n`; every control character but `\n` removed; the bidirectional and zero-width characters
 * removed; each line's trailing spaces and the whole text trimmed; three or more `\n` made two; length counted in code points. A text over `maxChars` or
 * `maxLines` is refused, not cut. Nothing left is `null`. Markup stays what was typed (`<b>` is the five characters `<b>`): it is escaped where it is drawn.
 */
export function cleanShopperText(value: unknown, limits: ShopperTextLimits): ShopperTextResult {
  if (typeof value !== "string") return { ok: true, value: null };
  const text = normalise(value);
  if (text === "") return { ok: true, value: null };
  const length = codePoints(text);
  if (length > limits.maxChars) return { ok: false, problem: "too_long", over: length - limits.maxChars };
  const lines = text.split("\n").length;
  if (lines > limits.maxLines) return { ok: false, problem: "too_many_lines", over: lines - limits.maxLines };
  return { ok: true, value: text };
}

/** How many characters a text counts once cleaned (what the live counter shows against the limit). */
export const shopperTextLength = (value: string): number => codePoints(normalise(value));

/** How many lines a text has once cleaned. */
export const shopperTextLines = (value: string): number => {
  const text = normalise(value);
  return text === "" ? 0 : text.split("\n").length;
};

// ---------------------------------------------------------------------------------------------------------------------
// The gift
// ---------------------------------------------------------------------------------------------------------------------

/** What the cart and the order keep (`carts` and `orders`: `is_gift`, `gift_to`, `gift_from`, `gift_message`). Nothing is set unless `isGift`. */
export type GiftFields = { isGift: boolean; to: string | null; from: string | null; message: string | null };

export const NO_GIFT: GiftFields = { isGift: false, to: null, from: null, message: null };

export type GiftField = "to" | "from" | "message";
export type GiftProblem = { field: GiftField; problem: "too_long" | "too_many_lines"; over: number };

export type GiftResult = { ok: true; gift: GiftFields } | { ok: false; problems: GiftProblem[] };

/**
 * The gift fields as typed, cleaned. `enabled` is the store's switch (`order_settings.gift_messages`): off, everything is ignored and the result is no gift.
 * Not a gift (`isGift` false): the three texts are cleared (unticking clears them). A gift may have no text at all. A name is one line of at most 60
 * characters (a new line typed into it is a space); the message at most 300 characters and 6 lines. Any text over its limit refuses the whole gift, and says by how much.
 */
export function cleanGift(input: { isGift?: unknown; to?: unknown; from?: unknown; message?: unknown }, enabled: boolean): GiftResult {
  if (!enabled || input.isGift !== true) return { ok: true, gift: NO_GIFT };
  const problems: GiftProblem[] = [];
  const name = (value: unknown, field: "to" | "from"): string | null => {
    const result = cleanShopperText(typeof value === "string" ? value.replace(/[\r\n]+/g, " ") : value, { maxChars: GIFT_NAME_MAX, maxLines: 1 });
    if (!result.ok) {
      problems.push({ field, problem: result.problem, over: result.over });
      return null;
    }
    return result.value;
  };
  const to = name(input.to, "to");
  const from = name(input.from, "from");
  const message = cleanShopperText(input.message, { maxChars: GIFT_MESSAGE_MAX, maxLines: GIFT_MESSAGE_LINES });
  if (!message.ok) problems.push({ field: "message", problem: message.problem, over: message.over });
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, gift: { isGift: true, to, from, message: message.ok ? message.value : null } };
}

/** The same gift: a changed gift after an order was placed makes the checkout start again, as a changed discount code does. */
export function sameGift(a: GiftFields | null | undefined, b: GiftFields | null | undefined): boolean {
  const x = a ?? NO_GIFT;
  const y = b ?? NO_GIFT;
  return x.isGift === y.isGift && (x.to ?? null) === (y.to ?? null) && (x.from ?? null) === (y.from ?? null) && (x.message ?? null) === (y.message ?? null);
}

/** The gift as the cart and order columns hold it, from a row (`is_gift`, `gift_to`, `gift_from`, `gift_message`); a row with no gift gives `NO_GIFT`. */
export function giftOfRow(row: { is_gift?: unknown; gift_to?: unknown; gift_from?: unknown; gift_message?: unknown }): GiftFields {
  if (row.is_gift !== true) return NO_GIFT;
  const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return { isGift: true, to: text(row.gift_to), from: text(row.gift_from), message: text(row.gift_message) };
}

/** Whether a gift has anything to show beyond the tick (the slip prints its block for a gift with no text too, but a card with no words has no message). */
export const hasGiftText = (gift: GiftFields): boolean => gift.to !== null || gift.from !== null || gift.message !== null;
