import { CHANNELS } from "./analytics-channels";
import { classifyChannel } from "./analytics-traffic";
import type { Touch } from "./first-touch";

/**
 * Where Kaizena Flow's owners come from and what they are worth (C2 of `docs/platform-parity-plan.md`, D522): the pure parts. A sign-up's
 * first touch is the house store's first-touch cookie on Kaizena Flow's site (D303, kept only for a visitor who allowed statistics), classified
 * as a visit's channel is; owners are grouped by the month their store was made, with what Kaizena Flow was paid for their plans (its own
 * sales, D508); and each channel's new owners are set against what was spent on it. Nothing here reads the database.
 */

export type Channel = (typeof CHANNELS)[number]["key"];
export type FirstTouch = { channel: Channel; source: string; campaign: string };

/** A sign-up's first touch from the cookie's touch, or null when there is none (no consent, or a visit that said nothing). */
export function touchChannel(touch: Touch | null, ownHosts: readonly string[]): FirstTouch | null {
  if (!touch) return null;
  const classified = classifyChannel({ referrerHost: touch.ref ?? null, ownHosts, utmSource: touch.source, utmMedium: touch.medium, utmCampaign: touch.campaign });
  return { channel: classified.channel as Channel, source: classified.source.slice(0, 120), campaign: classified.campaign.slice(0, 120) };
}

export type OwnerStore = { joinedMonth: string; opened: boolean; payingNow: boolean; paidMinor: number };
export type CohortRow = { month: string; stores: number; opened: number; payingNow: number; everPaid: number; paidMinor: number; perStoreMinor: number | null; perPayerMinor: number | null };

/** Owners by the month their store was made, newest first: how many opened, pay now and ever paid, and what they paid, per store and per payer. */
export function ownerCohorts(stores: readonly OwnerStore[]): CohortRow[] {
  const months = new Map<string, OwnerStore[]>();
  for (const s of stores) months.set(s.joinedMonth, [...(months.get(s.joinedMonth) ?? []), s]);
  return [...months.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, list]) => {
      const paidMinor = list.reduce((sum, s) => sum + s.paidMinor, 0);
      const everPaid = list.filter((s) => s.paidMinor > 0).length;
      return {
        month,
        stores: list.length,
        opened: list.filter((s) => s.opened).length,
        payingNow: list.filter((s) => s.payingNow).length,
        everPaid,
        paidMinor,
        perStoreMinor: list.length === 0 ? null : Math.round(paidMinor / list.length),
        perPayerMinor: everPaid === 0 ? null : Math.round(paidMinor / everPaid),
      };
    });
}

export type ChannelRequest = { channel: Channel | null; storeMade: boolean; opened: boolean; payingNow: boolean };
export type ChannelRow = {
  /** A channel, or `unknown` for sign-ups without a first touch. */
  channel: Channel | "unknown";
  requests: number;
  owners: number;
  opened: number;
  payingNow: number;
  spendMinor: number;
  /** Spend per new owner (a store made); null without spend or owners. */
  perOwnerMinor: number | null;
  /** Spend per owner who pays now; null without spend or payers. */
  perPayingMinor: number | null;
};

/**
 * New owners by channel in a period, against what was spent on each: a channel with spend and no sign-ups still shows, so money that brought
 * no one is seen. The channels in their usual order, `unknown` last; channels with nothing at all left out.
 */
export function channelRows(requests: readonly ChannelRequest[], spend: readonly { channel: Channel; amountMinor: number }[]): ChannelRow[] {
  const keys: (Channel | "unknown")[] = [...CHANNELS.map((c) => c.key as Channel), "unknown"];
  return keys
    .map((channel) => {
      const mine = requests.filter((r) => (r.channel ?? "unknown") === channel);
      const spendMinor = spend.filter((s) => s.channel === channel).reduce((sum, s) => sum + s.amountMinor, 0);
      const owners = mine.filter((r) => r.storeMade).length;
      const payingNow = mine.filter((r) => r.payingNow).length;
      return {
        channel,
        requests: mine.length,
        owners,
        opened: mine.filter((r) => r.opened).length,
        payingNow,
        spendMinor,
        perOwnerMinor: spendMinor > 0 && owners > 0 ? Math.round(spendMinor / owners) : null,
        perPayingMinor: spendMinor > 0 && payingNow > 0 ? Math.round(spendMinor / payingNow) : null,
      };
    })
    .filter((row) => row.requests > 0 || row.spendMinor > 0);
}
