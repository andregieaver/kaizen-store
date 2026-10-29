import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { makeAffiliateCode } from "@/lib/affiliates";
import { amountCell, writeCsv, type Cell } from "@/lib/csv";
import {
  balanceOf,
  cleanChannelUrl,
  CREATOR_DEFAULTS,
  type CreatorBalance,
  type CreatorDashboard,
  type CreatorPayoutRow,
  type CreatorProblem,
  type CreatorResult,
  type CreatorRow,
  type CreatorSettings,
  type CreatorStatus,
} from "@/lib/creators";
import { creatorApplicationInput, creatorPayoutInput, creatorSettingsInput } from "@/lib/creators-schema";

import { audit, type Account } from "./auth";
import { roleIn } from "./bonus";
import { log } from "./log";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * Creators (wave 11 unit G, D386): the only writer of `creator_settings`, `creators` and `creator_payouts`. Commissions are written by the
 * database alone, by triggers on paid, cancelled and refunded orders (`creator_order_paid()` and its neighbours); nothing here adds to
 * or takes from the ledger. A creator's code shares the referral program's link and cookie (`kaizen_aff_{storeId}`, marketing, after
 * consent), and an order placed with it in play is attributed by `placeOrder()` through `commerce.creator_attribute_order()`.
 */

const fail = (problem: CreatorProblem): CreatorResult => ({ ok: false, problem });

const SETTINGS_ROW = z.object({
  enabled: col.bool,
  commission_bps: col.int,
  category_bps: z.record(z.string(), z.number()),
  cookie_days: col.int,
});

/** The store's programme settings; the defaults, switched off, when it has none. */
export async function getCreatorSettings(storeId: string, runner: Executor = db()): Promise<CreatorSettings> {
  const row = await typedRow(
    SETTINGS_ROW,
    sql`select enabled, commission_bps, category_bps, cookie_days from commerce.creator_settings where store_id = ${storeId}::uuid`,
    runner,
  );
  if (!row) return { ...CREATOR_DEFAULTS, categoryBps: {} };
  return { enabled: row.enabled, commissionBps: row.commission_bps, categoryBps: row.category_bps, cookieDays: row.cookie_days };
}

/** Whether the programme works: the shop on and the owner's switch (`commerce.creator_program_on()`). */
export async function creatorProgramOn(storeId: string, runner: Executor = db()): Promise<boolean> {
  const row = await typedRow(z.object({ on: col.bool }), sql`select commerce.creator_program_on(${storeId}::uuid) as on`, runner);
  return row?.on ?? false;
}

/** Saves the programme's settings. Owners only; a category's rate is kept only for one of the store's own product categories. Audited. */
export async function saveCreatorSettings(account: Account, storeId: string, raw: unknown): Promise<CreatorResult> {
  if ((await roleIn(account.id, storeId)) !== "owner") return fail("owner_only");
  const parsed = creatorSettingsInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const s = parsed.data;
  const ids = Object.keys(s.categoryBps);
  if (ids.length > 0) {
    const found = await typedRows(
      z.object({ id: col.uuid }),
      sql`select id from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product' and kind = 'category'
            and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`,
    );
    if (found.length !== ids.length) return fail("category");
  }
  const before = await getCreatorSettings(storeId);
  await db().execute(sql`
    insert into commerce.creator_settings (store_id, enabled, commission_bps, category_bps, cookie_days, updated_by)
    values (${storeId}::uuid, ${s.enabled}, ${s.commissionBps}, ${JSON.stringify(s.categoryBps)}::jsonb, ${s.cookieDays}, ${account.id}::uuid)
    on conflict (store_id) do update set enabled = excluded.enabled, commission_bps = excluded.commission_bps,
      category_bps = excluded.category_bps, cookie_days = excluded.cookie_days, updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(account.id, storeId, "creator.settings", { before, after: s }, { area: "marketing" });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Applying, and the creator's own page
// ---------------------------------------------------------------------------

/**
 * A signed-in customer applies (the address they signed in with is their proof: a typed address never is). `consentText` is the words
 * the form showed, kept with the time. One application per customer; a declined one is decided again by the owner, never re-sent.
 */
export async function applyAsCreator(storeId: string, customerId: string, raw: unknown, consentText: string): Promise<CreatorResult> {
  if (!(await creatorProgramOn(storeId))) return fail("off");
  const parsed = creatorApplicationInput.safeParse(raw);
  if (!parsed.success) return fail("invalid");
  const channel = cleanChannelUrl(parsed.data.channelUrl);
  if (!channel) return fail("channel");
  const inserted = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      insert into commerce.creators (store_id, customer_id, name, channel_url, consent_text, consented_at)
      select c.store_id, c.id, ${parsed.data.name}, ${channel}, ${consentText.slice(0, 2000)}, now()
      from commerce.customers c
      where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid and c.email_verified_at is not null and c.copied_from is null
      on conflict (store_id, customer_id) do nothing
      returning id
    `,
  );
  if (inserted.length > 0) return { ok: true };
  const verified = await typedRow(
    z.object({ verified: col.bool }),
    sql`select email_verified_at is not null as verified from commerce.customers where store_id = ${storeId}::uuid and id = ${customerId}::uuid`,
  );
  return fail(verified?.verified ? "already" : "unverified");
}

const BALANCE_ROW = z.object({
  creator_id: col.uuid,
  currency: col.currency,
  earned: col.minor,
  reversed: col.minor,
  paid: col.minor,
});

/** Each creator's balances per currency, in one read. */
async function balancesFor(storeId: string, creatorIds: string[]): Promise<Map<string, CreatorBalance[]>> {
  const out = new Map<string, CreatorBalance[]>();
  if (creatorIds.length === 0) return out;
  const ids = sql.join(creatorIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await typedRows(
    BALANCE_ROW,
    sql`
      with moves as (
        select creator_id, currency, case when kind = 'earned' then amount_minor else 0 end as earned,
               case when kind = 'reversed' then amount_minor else 0 end as reversed, 0::bigint as paid
        from commerce.creator_commissions where store_id = ${storeId}::uuid and creator_id in (${ids})
        union all
        select creator_id, currency, 0, 0, amount_minor
        from commerce.creator_payouts where store_id = ${storeId}::uuid and creator_id in (${ids})
      )
      select creator_id, currency, coalesce(sum(earned), 0) as earned, coalesce(sum(reversed), 0) as reversed, coalesce(sum(paid), 0) as paid
      from moves group by creator_id, currency order by currency
    `,
  );
  for (const row of rows) {
    const list = out.get(row.creator_id) ?? [];
    list.push(balanceOf(row.currency, row.earned, row.reversed, row.paid));
    out.set(row.creator_id, list);
  }
  return out;
}

const DASHBOARD_ROW = z.object({
  id: col.uuid,
  status: z.enum(["applied", "approved", "declined", "stopped"]),
  name: col.text,
  channel_url: col.text,
  code: col.textOrNull,
  bps: col.int,
  visits: col.int,
  pending: col.int,
  earned: col.int,
  reversed: col.int,
  rejected: col.int,
});

/**
 * The signed-in customer's own creator page: their status, code, the visits to their link in 30 days, their orders by state and their
 * money per currency. Never a buyer, an order number or an amount of anyone's order. Null when they never applied.
 */
export async function creatorDashboard(storeId: string, customerId: string): Promise<CreatorDashboard | null> {
  const row = await typedRow(
    DASHBOARD_ROW,
    sql`
      select cr.id, cr.status, cr.name, cr.channel_url, cr.code,
        coalesce(cr.commission_bps, (select s.commission_bps from commerce.creator_settings s where s.store_id = cr.store_id), 0) as bps,
        coalesce((select sum(v.visits) from commerce.referral_visits v
                   where v.store_id = cr.store_id and v.code = cr.code and v.day > (now() at time zone 'UTC')::date - 30), 0)::int as visits,
        (select count(*) from commerce.creator_attributions a where a.store_id = cr.store_id and a.creator_id = cr.id and a.status = 'pending')::int as pending,
        (select count(*) from commerce.creator_attributions a where a.store_id = cr.store_id and a.creator_id = cr.id and a.status = 'earned')::int as earned,
        (select count(*) from commerce.creator_attributions a where a.store_id = cr.store_id and a.creator_id = cr.id and a.status = 'reversed')::int as reversed,
        (select count(*) from commerce.creator_attributions a where a.store_id = cr.store_id and a.creator_id = cr.id and a.status = 'rejected')::int as rejected
      from commerce.creators cr
      where cr.store_id = ${storeId}::uuid and cr.customer_id = ${customerId}::uuid
    `,
  );
  if (!row) return null;
  const [balances, payouts] = await Promise.all([
    balancesFor(storeId, [row.id]),
    typedRows(
      z.object({ currency: col.currency, amount: col.minor, paid_on: col.text }),
      sql`select currency, amount_minor as amount, paid_on::text as paid_on from commerce.creator_payouts
          where store_id = ${storeId}::uuid and creator_id = ${row.id}::uuid order by paid_on desc, created_at desc limit 50`,
    ),
  ]);
  return {
    status: row.status,
    name: row.name,
    channelUrl: row.channel_url,
    code: row.status === "approved" ? row.code : null,
    visits: row.visits,
    orders: { pending: row.pending, earned: row.earned, reversed: row.reversed, rejected: row.rejected },
    balances: balances.get(row.id) ?? [],
    payouts: payouts.map((p) => ({ currency: p.currency, amountMinor: p.amount, paidOn: p.paid_on })),
    commissionBps: row.bps,
  };
}

// ---------------------------------------------------------------------------
// The owner's and staff's side
// ---------------------------------------------------------------------------

const CREATOR_ROW = z.object({
  id: col.uuid,
  status: z.enum(["applied", "approved", "declined", "stopped"]),
  name: col.text,
  channel_url: col.text,
  email: col.textOrNull,
  code: col.textOrNull,
  commission_bps: z.number().int().nullable(),
  created_at: col.timestamp,
  decided_at: col.timestampOrNull,
  orders: col.int,
  visits: col.int,
});

/** The store's creators, newest application first, each with their counts and money per currency. Staff with `marketing:read`. */
export async function listCreators(storeId: string): Promise<CreatorRow[]> {
  const rows = await typedRows(
    CREATOR_ROW,
    sql`
      select cr.id, cr.status, cr.name, cr.channel_url, c.email, cr.code, cr.commission_bps, cr.created_at, cr.decided_at,
        (select count(*) from commerce.creator_attributions a where a.store_id = cr.store_id and a.creator_id = cr.id and a.status in ('pending', 'earned'))::int as orders,
        coalesce((select sum(v.visits) from commerce.referral_visits v where v.store_id = cr.store_id and v.code = cr.code), 0)::int as visits
      from commerce.creators cr
      left join commerce.customers c on c.store_id = cr.store_id and c.id = cr.customer_id
      where cr.store_id = ${storeId}::uuid
      order by (cr.status = 'applied') desc, cr.created_at desc
      limit 500
    `,
  );
  const balances = await balancesFor(storeId, rows.map((row) => row.id));
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    name: row.name,
    channelUrl: row.channel_url,
    email: row.email,
    code: row.code,
    commissionBps: row.commission_bps,
    appliedAt: row.created_at,
    decidedAt: row.decided_at,
    orders: row.orders,
    visits: row.visits,
    balances: balances.get(row.id) ?? [],
  }));
}

export type CreatorDecision = "approve" | "decline" | "stop";

const NEXT_STATUS: Record<CreatorDecision, CreatorStatus> = { approve: "approved", decline: "declined", stop: "stopped" };

/**
 * Approves, declines or stops a creator (staff with `marketing:write`, checked by the action; a member of the store here). Approving gives
 * a code the first time, unique among the store's creators and referrers; a stopped creator's code earns nothing new, and what was earned
 * stays owed. Audited with the creator's id, never their name.
 */
export async function decideCreator(account: Account, storeId: string, creatorId: string, decision: CreatorDecision): Promise<CreatorResult> {
  if (!(await roleIn(account.id, storeId))) return fail("no_access");
  if (!z.uuid().safeParse(creatorId).success || !(decision in NEXT_STATUS)) return fail("invalid");
  const next = NEXT_STATUS[decision];
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const done = await typedRows(
        z.object({ id: col.uuid }),
        sql`
          update commerce.creators set status = ${next}, decided_at = now(), decided_by = ${account.id}::uuid,
            code = case when ${next} = 'approved' then coalesce(code, ${makeAffiliateCode()}) else code end
          where store_id = ${storeId}::uuid and id = ${creatorId}::uuid and customer_id is not null
          returning id
        `,
      );
      if (done.length === 0) return fail("not_found");
      await audit(account.id, storeId, "creator.decided", { creator: creatorId, decision }, {
        area: "marketing",
        target: { type: "creator", id: creatorId },
      });
      return { ok: true };
    } catch (error) {
      const message = String((error as { cause?: { message?: string } })?.cause?.message ?? "");
      if (message.includes("creator.bad_status")) return fail("status");
      // A code another creator or referrer took meanwhile is tried again.
      if (message.includes("creator.code_taken") || message.includes("creators_code_key")) continue;
      throw error;
    }
  }
  return fail("code");
}

/** A creator's own rate (null: the programme's). Owners only, as the programme's settings are. Audited. */
export async function setCreatorRate(account: Account, storeId: string, creatorId: string, bps: number | null): Promise<CreatorResult> {
  if ((await roleIn(account.id, storeId)) !== "owner") return fail("owner_only");
  if (!z.uuid().safeParse(creatorId).success) return fail("invalid");
  if (bps !== null && !(Number.isInteger(bps) && bps >= 0 && bps <= 5000)) return fail("invalid");
  const done = await db().execute(sql`
    update commerce.creators set commission_bps = ${bps} where store_id = ${storeId}::uuid and id = ${creatorId}::uuid returning id
  `);
  if (done.length === 0) return fail("not_found");
  await audit(account.id, storeId, "creator.rate", { creator: creatorId, bps }, { area: "marketing", target: { type: "creator", id: creatorId } });
  return { ok: true };
}

/**
 * Records a payout the owner made outside Kaizena Flow (it moves no money), in a currency the creator is owed in and never more than is
 * owed there: the database checks it under the creator's lock. Owners only. Audited with the amount, never the creator's name.
 */
export async function recordCreatorPayout(account: Account, storeId: string, creatorId: string, raw: unknown): Promise<CreatorResult> {
  if ((await roleIn(account.id, storeId)) !== "owner") return fail("owner_only");
  const parsed = creatorPayoutInput.safeParse(raw);
  if (!parsed.success || !z.uuid().safeParse(creatorId).success) return fail("invalid");
  const p = parsed.data;
  try {
    const done = await db().execute(sql`
      insert into commerce.creator_payouts (store_id, creator_id, currency, amount_minor, paid_on, reference, recorded_by)
      select cr.store_id, cr.id, ${p.currency}, ${p.amountMinor}, ${p.paidOn}::date, ${p.reference}, ${account.id}::uuid
      from commerce.creators cr where cr.store_id = ${storeId}::uuid and cr.id = ${creatorId}::uuid
      returning id
    `);
    if (done.length === 0) return fail("not_found");
  } catch (error) {
    const message = String((error as { cause?: { message?: string } })?.cause?.message ?? "");
    if (message.includes("creator.payout_over")) return fail("payout_over");
    log("error", "creator.payout_failed", { storeId }, error);
    throw error;
  }
  await audit(account.id, storeId, "creator.payout", { creator: creatorId, currency: p.currency, amountMinor: p.amountMinor }, {
    area: "marketing",
    target: { type: "creator", id: creatorId },
  });
  return { ok: true };
}

const PAYOUT_ROW = z.object({
  id: col.uuid,
  creator_id: col.uuid,
  name: col.text,
  currency: col.currency,
  amount: col.minor,
  paid_on: col.text,
  reference: col.text,
  created_at: col.timestamp,
});

/** The store's payouts, newest first. */
export async function listCreatorPayouts(storeId: string, limit = 200): Promise<CreatorPayoutRow[]> {
  const rows = await typedRows(
    PAYOUT_ROW,
    sql`
      select p.id, p.creator_id, cr.name, p.currency, p.amount_minor as amount, p.paid_on::text as paid_on, p.reference, p.created_at
      from commerce.creator_payouts p join commerce.creators cr on cr.store_id = p.store_id and cr.id = p.creator_id
      where p.store_id = ${storeId}::uuid order by p.paid_on desc, p.created_at desc limit ${limit}
    `,
  );
  return rows.map((r) => ({
    id: r.id,
    creatorId: r.creator_id,
    creatorName: r.name,
    currency: r.currency,
    amountMinor: r.amount,
    paidOn: r.paid_on,
    reference: r.reference,
    recordedAt: r.created_at,
  }));
}

/** The payouts as a CSV (`writeCsv()`, amounts from minor units), a currency on every row. Owners only, checked by the route. */
export async function creatorPayoutsCsv(storeId: string): Promise<string> {
  const rows = await listCreatorPayouts(storeId, 100_000);
  const body: Cell[][] = rows.map((r) => [r.paidOn, r.creatorName, r.currency, amountCell(r.amountMinor, r.currency), r.reference]);
  return writeCsv([["paid_on", "creator", "currency", "amount", "reference"], ...body]);
}

// ---------------------------------------------------------------------------
// Personal data (D162)
// ---------------------------------------------------------------------------

/** What the export carries of a customer as a creator: their application and money, never a buyer. */
export async function creatorExport(
  storeId: string,
  customerId: string,
): Promise<(CreatorDashboard & { consentText: string; consentedAt: string | null }) | null> {
  const dashboard = await creatorDashboard(storeId, customerId);
  if (!dashboard) return null;
  const consent = await typedRow(
    z.object({ consent_text: col.text, consented_at: col.timestamp }),
    sql`select consent_text, consented_at from commerce.creators where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid`,
  );
  return { ...dashboard, consentText: consent?.consent_text ?? "", consentedAt: consent?.consented_at ?? null };
}

/**
 * Erasure: the creator's name, channel and tie to the customer are forgotten and they stop (or their application is declined); the
 * ledger's rows stay, naming no one, because the store's books need them. Run in the erasure's transaction, before the customer goes.
 */
export async function forgetCreator(tx: Executor, storeId: string, customerId: string): Promise<number> {
  const rows = await tx.execute(sql`
    update commerce.creators set customer_id = null, name = '', channel_url = '',
      status = case status when 'approved' then 'stopped' when 'applied' then 'declined' else status end
    where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid
    returning id
  `);
  return rows.length;
}

/** Whether a customer is a creator of the store (a merge of two customers refuses to move one, D366). */
export async function isCreator(tx: Executor, storeId: string, customerId: string): Promise<boolean> {
  const row = await typedRow(
    z.object({ yes: col.bool }),
    sql`select exists (select 1 from commerce.creators where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid) as yes`,
    tx,
  );
  return row?.yes ?? false;
}
