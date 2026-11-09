import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { CHANNELS } from "@/lib/analytics-channels";
import { decodeTouch } from "@/lib/first-touch";
import { channelRows, ownerCohorts, touchChannel, type Channel, type ChannelRow, type CohortRow, type FirstTouch } from "@/lib/platform-channels";
import { siteUrl } from "@/lib/site";

import { audit, platformCan, type Account } from "./auth";
import { col, typedRows } from "./typed-rows";

/**
 * Where Kaizena Flow's owners come from and what they are worth (C2, D521, `src/lib/platform-channels.ts`). A sign-up keeps its first touch
 * (`signupFirstTouch()`, from the house store's first-touch cookie: only for a visitor who allowed statistics); the owners' stores are grouped
 * by the month they were made with what Kaizena Flow was paid for them (`platform_sales`, live, net of VAT, D508); each channel's requests and
 * owners are set against what was spent on it (`platform_marketing_spend`, written only here, by a platform owner or its finance role). Never
 * a demo store, a template, a sandbox or Kaizena Flow's own.
 */

const OWNERS_STORES = sql`not (s.is_template or s.starter) and not s.sandbox and not s.house`;
const CHANNEL_KEYS = new Set<string>(CHANNELS.map((c) => c.key));
const isChannel = (value: string): value is Channel => CHANNEL_KEYS.has(value);

/** A sign-up's first touch from the house store's cookie value, or null (no cookie, no consent, a visit that said nothing). */
export function signupFirstTouch(cookieValue: string | undefined): FirstTouch | null {
  return touchChannel(decodeTouch(cookieValue), [new URL(siteUrl()).hostname]);
}

/** The currency Kaizena Flow was paid most in (live plans), for the figures that need one; the platform's own when nothing was paid. */
async function mainCurrency(): Promise<string> {
  const [row] = await typedRows(
    z.object({ currency: col.currency }),
    sql`select currency from commerce.platform_sales where mode = 'live' group by currency order by sum(net_minor) desc limit 1`,
  );
  return row?.currency ?? "NOK";
}

/** Owners by the month their store was made (the last `months`), with what they paid for plans in the main currency. */
export async function platformOwnerCohorts(months = 12): Promise<{ currency: string; rows: CohortRow[] }> {
  const currency = await mainCurrency();
  const stores = await typedRows(
    z.object({ month: col.text, opened: col.bool, paying: col.bool, paid: col.minor }),
    sql`
      select to_char(s.created_at at time zone 'Europe/Oslo', 'YYYY-MM') as month, s.setup_completed_at is not null as opened,
        coalesce(b.status::text in ('active', 'past_due') and b.mode::text = 'live', false) as paying,
        coalesce((select sum(p.net_minor - least(p.credited_minor, p.total_minor) * p.net_minor / nullif(p.total_minor, 0))
          from commerce.platform_sales p where p.buyer_store_id = s.id and p.mode = 'live' and p.kind = 'plan' and p.currency = ${currency}), 0)::bigint as paid
      from commerce.stores s left join commerce.store_billing b on b.store_id = s.id
      where ${OWNERS_STORES} and s.created_at >= date_trunc('month', now() at time zone 'Europe/Oslo') - make_interval(months => ${months - 1})
    `,
  );
  return { currency, rows: ownerCohorts(stores.map((s) => ({ joinedMonth: s.month, opened: s.opened, payingNow: s.paying, paidMinor: s.paid }))) };
}

/** Requests for a store made in `[from, to)` (Oslo's days) by their first channel, against the spend on each channel in those days. */
export async function platformChannels(from: string, to: string): Promise<{ currency: string; rows: ChannelRow[] }> {
  const currency = await mainCurrency();
  const [requests, spend] = await Promise.all([
    typedRows(
      z.object({ channel: col.textOrNull, store_made: col.bool, opened: col.bool, paying: col.bool }),
      sql`
        select r.first_channel as channel, r.store_id is not null as store_made, coalesce(s.setup_completed_at is not null, false) as opened,
          coalesce(b.status::text in ('active', 'past_due') and b.mode::text = 'live', false) as paying
        from commerce.access_requests r
        left join commerce.stores s on s.id = r.store_id
        left join commerce.store_billing b on b.store_id = r.store_id
        where (r.created_at at time zone 'Europe/Oslo')::date >= ${from}::date and (r.created_at at time zone 'Europe/Oslo')::date < ${to}::date
      `,
    ),
    typedRows(
      z.object({ channel: col.text, amount: col.minor }),
      sql`
        select channel, sum(amount_minor)::bigint as amount from commerce.platform_marketing_spend
        where day >= ${from}::date and day < ${to}::date and currency = ${currency} group by channel
      `,
    ),
  ]);
  return {
    currency,
    rows: channelRows(
      requests.map((r) => ({ channel: r.channel && isChannel(r.channel) ? r.channel : null, storeMade: r.store_made, opened: r.opened, payingNow: r.paying })),
      spend.filter((s) => isChannel(s.channel)).map((s) => ({ channel: s.channel as Channel, amountMinor: s.amount })),
    ),
  };
}

export type SpendRow = { id: string; day: string; channel: Channel; campaign: string; amountMinor: number; currency: string; note: string };

/** The spend entered for `[from, to)`, newest first. */
export async function listPlatformSpend(from: string, to: string): Promise<SpendRow[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, day: col.text, channel: col.text, campaign: col.text, amount_minor: col.minor, currency: col.currency, note: col.text }),
    sql`
      select id, day::text, channel, campaign, amount_minor, currency, note from commerce.platform_marketing_spend
      where day >= ${from}::date and day < ${to}::date order by day desc, channel, campaign
    `,
  );
  return rows.filter((r) => isChannel(r.channel)).map((r) => ({ id: r.id, day: r.day, channel: r.channel as Channel, campaign: r.campaign, amountMinor: r.amount_minor, currency: r.currency, note: r.note }));
}

export type SpendProblem = "plans" | "day" | "channel" | "amount" | "currency" | "campaign";

/**
 * Records what was spent on a channel on a day (a campaign's, or the channel's own); the same day, channel, campaign and currency again
 * replaces it. A platform owner or its finance role (the plans area, D510). Audited.
 */
export async function savePlatformSpend(
  admin: Account,
  input: { day: string; channel: string; campaign: string; amountMinor: number | null; currency: string; note: string },
): Promise<{ ok: true } | { ok: false; problem: SpendProblem }> {
  if (!platformCan(admin, "plans")) return { ok: false, problem: "plans" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) || Number.isNaN(Date.parse(`${input.day}T00:00:00Z`))) return { ok: false, problem: "day" };
  if (!isChannel(input.channel)) return { ok: false, problem: "channel" };
  if (input.amountMinor === null || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) return { ok: false, problem: "amount" };
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, problem: "currency" };
  const campaign = input.campaign.replace(/\s+/g, " ").trim();
  if (campaign.length > 100) return { ok: false, problem: "campaign" };
  const note = input.note.replace(/\s+/g, " ").trim().slice(0, 500);
  await db().execute(sql`
    insert into commerce.platform_marketing_spend (day, channel, campaign, amount_minor, currency, note, created_by)
    values (${input.day}::date, ${input.channel}, ${campaign}, ${input.amountMinor}, ${currency}, ${note}, ${admin.id}::uuid)
    on conflict on constraint platform_marketing_spend_key do update set amount_minor = excluded.amount_minor, note = excluded.note, created_by = excluded.created_by
  `);
  await audit(admin.id, null, "platform.marketing_spend_saved", { day: input.day, channel: input.channel, amountMinor: input.amountMinor, currency });
  return { ok: true };
}

/** Takes a spend row away. A platform owner or its finance role. */
export async function removePlatformSpend(admin: Account, id: string): Promise<boolean> {
  if (!platformCan(admin, "plans") || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await db().execute(sql`delete from commerce.platform_marketing_spend where id = ${id}::uuid returning id`);
  if (rows.length === 0) return false;
  await audit(admin.id, null, "platform.marketing_spend_removed", { id });
  return true;
}
