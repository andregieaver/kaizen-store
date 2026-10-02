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
  { key: "other", label: "Other" },
] as const;

export type Channel = (typeof CHANNELS)[number]["key"];

export const CHANNEL_KEYS: readonly Channel[] = CHANNELS.map((c) => c.key);

export const CHANNEL_LABELS: Record<Channel, string> = Object.fromEntries(
  CHANNELS.map((c) => [c.key, c.label]),
) as Record<Channel, string>;

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && (CHANNEL_KEYS as readonly string[]).includes(value);
}
