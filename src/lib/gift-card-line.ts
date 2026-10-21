/**
 * Who a gift card bought is for (wave 5 unit F2, D300, `docs/wave-5-marketing.md` 8.2): chosen on the product page under *Send it to someone*,
 * kept on the cart line and frozen on the order line, so each card of the line is emailed to them on the day chosen. Pure and free of zod: the
 * cart page is a pay route. The texts follow the gift message's rules (D173, `cleanShopperText()`: refused, never cut).
 */

import { GIFT_MESSAGE_LINES, GIFT_MESSAGE_MAX, GIFT_NAME_MAX, cleanShopperText } from "./gift";

/** The day a card is sent: today at the earliest, at most a year ahead. */
export const GIFT_CARD_SEND_DAYS_MAX = 365;

/** What a cart line and an order line keep (`gift_card_to`, `gift_card_to_name`, `gift_card_from`, `gift_card_message`, `gift_card_send_on`). */
export type GiftCardRecipient = {
  /** The email the card goes to. */
  to: string;
  toName: string | null;
  /** Who it is from, as the email says it; the buyer's own words. */
  from: string | null;
  message: string | null;
  /** The day it is sent, `YYYY-MM-DD` in the store's time zone. */
  sendOn: string;
};

export type GiftCardField = "to" | "toName" | "from" | "message" | "sendOn";
export type GiftCardProblem = { field: GiftCardField; problem: "missing" | "not_an_email" | "too_long" | "too_many_lines" | "not_a_day" | "too_early" | "too_late"; over?: number };
export type GiftCardRecipientResult = { ok: true; recipient: GiftCardRecipient | null } | { ok: false; problems: GiftCardProblem[] };

/** An email address as a person would type one: something, an @, a domain with a dot; nothing else is checked (the email itself is the proof). */
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `day` plus `days`, as `YYYY-MM-DD` (calendar arithmetic in UTC, which has no daylight saving). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whether a `YYYY-MM-DD` is a real day (not 2026-02-30). */
const realDay = (day: string): boolean => DAY.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;

/**
 * What was typed under *Send it to someone*, cleaned: nothing when `send` is not ticked (the card is the buyer's, emailed to them at once);
 * else an email, a day from `today` (the store's) up to a year ahead (empty: today), and optional name, sender and message within the gift
 * message's limits. Any problem refuses the whole of it, and says which field and why.
 */
export function cleanGiftCardRecipient(
  input: { send?: unknown; to?: unknown; toName?: unknown; from?: unknown; message?: unknown; sendOn?: unknown },
  today: string,
): GiftCardRecipientResult {
  if (input.send !== true) return { ok: true, recipient: null };
  const problems: GiftCardProblem[] = [];
  const to = typeof input.to === "string" ? input.to.trim() : "";
  if (to === "") problems.push({ field: "to", problem: "missing" });
  else if (to.length > 254 || !EMAIL.test(to)) problems.push({ field: "to", problem: "not_an_email" });
  const name = (value: unknown, field: "toName" | "from"): string | null => {
    const result = cleanShopperText(typeof value === "string" ? value.replace(/[\r\n]+/g, " ") : value, { maxChars: GIFT_NAME_MAX, maxLines: 1 });
    if (!result.ok) {
      problems.push({ field, problem: result.problem, over: result.over });
      return null;
    }
    return result.value;
  };
  const toName = name(input.toName, "toName");
  const from = name(input.from, "from");
  const message = cleanShopperText(input.message, { maxChars: GIFT_MESSAGE_MAX, maxLines: GIFT_MESSAGE_LINES });
  if (!message.ok) problems.push({ field: "message", problem: message.problem, over: message.over });
  const typedDay = typeof input.sendOn === "string" ? input.sendOn.trim() : "";
  const sendOn = typedDay === "" ? today : typedDay;
  if (!realDay(sendOn)) problems.push({ field: "sendOn", problem: "not_a_day" });
  else if (sendOn < today) problems.push({ field: "sendOn", problem: "too_early" });
  else if (sendOn > addDays(today, GIFT_CARD_SEND_DAYS_MAX)) problems.push({ field: "sendOn", problem: "too_late" });
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, recipient: { to, toName, from, message: message.ok ? message.value : null, sendOn } };
}

/**
 * The key a cart line keeps for who its cards are for (`cart_lines.gift_card_key`), so two cards of one amount for two people are two lines
 * and the same person twice is one line of two: every field, the address in lower case. Null for a card the buyer keeps.
 */
export function giftCardKey(recipient: GiftCardRecipient | null): string | null {
  if (!recipient) return null;
  return JSON.stringify([recipient.to.toLowerCase(), recipient.toName ?? "", recipient.from ?? "", recipient.message ?? "", recipient.sendOn]);
}

/** Who a cart or order line's cards are for, from its row (`gift_card_to` and the rest); null when they are the buyer's. */
export function giftCardRecipientOfRow(row: {
  gift_card_to?: unknown;
  gift_card_to_name?: unknown;
  gift_card_from?: unknown;
  gift_card_message?: unknown;
  gift_card_send_on?: unknown;
}): GiftCardRecipient | null {
  const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const to = text(row.gift_card_to);
  if (!to) return null;
  const day = row.gift_card_send_on instanceof Date ? row.gift_card_send_on.toISOString().slice(0, 10) : String(row.gift_card_send_on ?? "").slice(0, 10);
  return { to, toName: text(row.gift_card_to_name), from: text(row.gift_card_from), message: text(row.gift_card_message), sendOn: day };
}
