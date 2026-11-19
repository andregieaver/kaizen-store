/**
 * The channels a visit and marketing spend are sorted into (D152, `docs/analytics.md`). One list, read by the
 * database's check constraints (`src/db/schema.ts`), the classifier, the spend form and the Marketing page, so a
 * channel is added in exactly one place. Keys are stored; labels are what the admin shows (the admin is English only).
 */
export const CHANNELS = [
  { key: "direct", label: "Direct" },
  { key: "organic_search", label: "Organic search" },
  { key: "paid_search", label: "Paid search" },
  { key: "organic_social", label: "Organic social" },
  { key: "paid_social", label: "Paid social" },
  { key: "email", label: "Email" },
  { key: "affiliate", label: "Affiliate" },
  { key: "referral", label: "Referral" },
  // A shopping agent (D353): a visit from ChatGPT, Perplexity, Copilot or Gemini, a feed link tagged with one, or a cart its agent handed over.
  { key: "ai_agent", label: "AI agents" },
  { key: "other", label: "Other" },
] as const;

export type Channel = (typeof CHANNELS)[number]["key"];

export const CHANNEL_KEYS: readonly Channel[] = CHANNELS.map((c) => c.key);

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && (CHANNEL_KEYS as readonly string[]).includes(value);
}

/** The channel names (and `unknown`, for orders with no visit) as the admin shows them. */
export const UNKNOWN_CHANNEL = "unknown";
/**
 * Orders staff made from a draft order (D173, `orders.source = 'draft'`): not a visit, so no channel earns them and they have no sessions, no
 * conversion and no spend. They are a row of their own in the channel table so its revenue adds up to the period's, and the blended conversion leaves them out.
 */
export const STAFF_CHANNEL = "staff";
/**
 * Exchange orders (D239, `orders.source = 'exchange'`): the replacement goods of a return, paid by its credit. Not a visit either, so like the staff-made
 * row they have no sessions, no conversion and no spend, and the blended conversion leaves them out.
 */
export const EXCHANGE_CHANNEL = "exchange";
/** Rows that are not a place visitors come from: their sessions are not known and they are never a channel to compare or spend on. */
export const isNotAChannel = (key: string): boolean => key === UNKNOWN_CHANNEL || key === STAFF_CHANNEL || key === EXCHANGE_CHANNEL;
/** Rows of orders that were never a visit (made by staff, or an exchange): the blended conversion counts the others only. */
export const isNoVisit = (key: string): boolean => key === STAFF_CHANNEL || key === EXCHANGE_CHANNEL;
export const channelLabel = (key: string): string =>
  key === UNKNOWN_CHANNEL
    ? "Unknown"
    : key === STAFF_CHANNEL
      ? "Staff-made"
      : key === EXCHANGE_CHANNEL
        ? "Exchanges"
        : key === "blended"
          ? "Blended"
          : (CHANNELS.find((c) => c.key === key)?.label ?? key);
