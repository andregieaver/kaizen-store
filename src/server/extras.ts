import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { aiMayTakeOne, billExtras, EXTRA_UNIT_OF, type BilledLine, type ExtraLine, type ExtraUnit } from "@/lib/extras";
import { isExtensionId, readExtensionFacts, standingOf, type ExtensionId } from "@/lib/extensions";
import { can } from "@/lib/permissions";

import { accountSize } from "./extension-sizes";
import { log } from "./log";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Use beyond the allowances, billed as used (D880, D748 E11): AI-handled conversations beyond the support desk's, and people beyond Work's
 * and Deals' three, counted across the account's stores and added as one line each to the account's renewal invoice while Stripe holds it
 * as a draft (`invoice.created`). An account with a cap is never billed past it, and its support desk's AI hands new conversations to
 * people once one more would pass it (`aiRoomFor()`). Only what the account pays for counts (bought, in a bundle or in its plan): a trial,
 * extensions not yet sold, and Kaizena Flow's own never have extras.
 *
 * Kept lean, as the shop's chat asks `aiRoomFor()` when a conversation starts: no billing or Stripe code here (`extras-billing.ts` has it).
 */

/** Stores of an account that count: open ones, never templates, demo stores, sandboxes or Kaizena Flow's own. */
const COUNTED = sql`s.status <> 'closed' and not (s.is_template or s.starter or s.sandbox or s.house)`;

/** The active price of one unit beyond, per extension, in a currency. */
async function extraPrices(currency: string): Promise<Map<ExtensionId, { unit: ExtraUnit; unitMinor: number }>> {
  const rows = await typedRows(
    z.object({ extension_id: col.text, unit: z.enum(["ai_conversation", "person"]), amount_minor: col.minor }),
    sql`select extension_id, unit, amount_minor from commerce.extension_extra_prices where active and currency = ${currency}`,
  );
  return new Map(rows.flatMap((r) => (isExtensionId(r.extension_id) ? [[r.extension_id, { unit: r.unit, unitMinor: r.amount_minor }] as const] : [])));
}

/** Conversations the account's support desks' AI answered whose first answer fell in the period: each one costs tokens, resolved or not. */
async function aiConversationsOf(organisationId: string, from: Date, to: Date): Promise<number> {
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from (
          select c.id from commerce.support_conversations c
            join commerce.stores s on s.id = c.store_id and s.organisation_id = ${organisationId}::uuid and ${COUNTED}
            join commerce.support_messages m on m.conversation_id = c.id and m.author = 'ai'
           where c.last_message_at >= ${from.toISOString()}::timestamptz
           group by c.id
          having min(m.created_at) >= ${from.toISOString()}::timestamptz and min(m.created_at) < ${to.toISOString()}::timestamptz
        ) x`,
  );
  return row?.n ?? 0;
}

/** The extensions whose sizes count people. */
type PeopleExtension = "work" | "deals" | "projects";

const MEMBER_ROW = z.object({
  account_id: col.uuid,
  role: z.enum(["owner", "admin"]),
  kind: col.text,
  role_id: col.uuid.nullable(),
  permissions: z.array(z.string()).nullable(),
  template: col.textOrNull,
  work_on: col.bool,
  projects_on: col.bool,
});

/**
 * The account's team members who can use an extension, each person once across its stores (the owner's answer, 23 November 2026): for
 * Work, those who can open it (Work's screens need `settings:read`, in a store using Work), accountants free; for Deals, those who can
 * change customers (`customers:write`); for Projects (D904), those who can change projects (`projects:write`) in a store with Projects on.
 * A read-only member is never a person here.
 */
export async function peopleOf(organisationId: string, extensionId: PeopleExtension): Promise<number> {
  const rows = await typedRows(
    MEMBER_ROW,
    sql`select m.account_id, m.role, m.kind, m.role_id, r.permissions, r.template, ('work' = any(s.modules)) as work_on,
                 ('projects' = any(s.features)) as projects_on
          from commerce.store_members m
          join commerce.stores s on s.id = m.store_id and s.organisation_id = ${organisationId}::uuid and ${COUNTED}
          left join commerce.store_roles r on r.store_id = m.store_id and r.id = m.role_id
         where m.disabled_at is null and (m.expires_at is null or m.expires_at > now())`,
  );
  const people = new Set<string>();
  for (const r of rows) {
    const holder = { role: r.role, kind: r.kind === "collaborator" ? ("collaborator" as const) : ("staff" as const), permissions: r.role_id ? (r.permissions ?? []) : null };
    const counts =
      extensionId === "work"
        ? r.work_on && r.template !== "accountant" && can(holder, "settings:read")
        : extensionId === "projects"
          ? r.projects_on && can(holder, "projects:write")
          : can(holder, "customers:write");
    if (counts) people.add(r.account_id);
  }
  return people.size;
}

/**
 * The account's use beyond its allowances in a period, one line per extension it pays for that has a price beyond in the currency: what was
 * used, what its size includes (null: no limit) and what one unit beyond costs. People are counted as they are now.
 */
export async function extraLines(organisationId: string, from: Date, to: Date, currency: string, now: Date = new Date()): Promise<ExtraLine[]> {
  const [facts, prices] = await Promise.all([
    typedRow(z.object({ facts: z.unknown() }), sql`select commerce.organisation_extension_facts(${organisationId}::uuid) as facts`),
    extraPrices(currency),
  ]);
  const read = readExtensionFacts(facts?.facts);
  const lines: ExtraLine[] = [];
  for (const [id, unit] of Object.entries(EXTRA_UNIT_OF) as [ExtensionId, ExtraUnit][]) {
    const standing = standingOf(read, id, now);
    const price = prices.get(id);
    if (!price || standing.state !== "active" || !["bought", "bundle", "plan"].includes(standing.source ?? "")) continue;
    const size = await accountSize(organisationId, id);
    const included = (unit === "ai_conversation" ? size?.allowances.ai_conversations : size?.allowances.people) ?? null;
    const used = id === "support_desk" ? await aiConversationsOf(organisationId, from, to) : await peopleOf(organisationId, id as PeopleExtension);
    lines.push({ extensionId: id, unit, used, included, unitMinor: price.unitMinor });
  }
  return lines;
}

const PERIOD_ROW = z.object({
  cap: col.minorOrNull,
  period_end: col.timestampOrNull,
  interval: z.enum(["month", "year"]).nullable(),
  currency: col.currency.nullable(),
});

/**
 * The account's billing period now (the subscription's: its end less one interval, else the calendar month), its currency (its plan's,
 * else its first store's main market's) and its cap; null for an account not billed through its account.
 */
async function currentPeriod(organisationId: string, now: Date) {
  const row = await typedRow(
    PERIOD_ROW,
    sql`select ob.extras_cap_minor as cap, ob.current_period_end as period_end, pp.interval,
               coalesce(pp.currency, (select mk.currency from commerce.stores s join commerce.markets mk on mk.store_id = s.id and mk.active
                                       where s.organisation_id = ob.organisation_id and ${COUNTED}
                                       order by s.created_at, (mk.code = s.country) desc nulls last, mk.created_at limit 1)) as currency
          from commerce.organisation_billing ob left join commerce.plan_prices pp on pp.id = ob.price_id
         where ob.organisation_id = ${organisationId}::uuid`,
  );
  if (!row?.currency) return null;
  let to = row.period_end ? new Date(row.period_end) : null;
  let from: Date;
  if (to && to > now) {
    from = new Date(to);
    if (row.interval === "year") from.setUTCFullYear(from.getUTCFullYear() - 1);
    else from.setUTCMonth(from.getUTCMonth() - 1);
  } else {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }
  return { from, to, currency: row.currency, capMinor: row.cap };
}

export type AccountExtras = { from: string; to: string; currency: string; capMinor: number | null; lines: BilledLine[] };

/** What the account has used beyond its allowances so far this period, as it would be billed, for its owner's screens. Null when nothing applies. */
export async function accountExtrasNow(organisationId: string, now: Date = new Date()): Promise<AccountExtras | null> {
  const period = await currentPeriod(organisationId, now);
  if (!period) return null;
  const lines = await extraLines(organisationId, period.from, now < period.to ? now : period.to, period.currency);
  if (lines.length === 0) return null;
  return { from: period.from.toISOString(), to: period.to.toISOString(), currency: period.currency, capMinor: period.capMinor, lines: billExtras(lines, period.capMinor) };
}

/**
 * Whether a store's support desk's AI may take a new conversation (`openConversation()`, an email's): yes unless its account has a cap and
 * one more AI-handled conversation would pass it. Never throws: when it cannot tell, the AI answers.
 */
export async function aiRoomFor(storeId: string, now: Date = new Date()): Promise<boolean> {
  try {
    const capped = await typedRow(
      z.object({ organisation_id: col.uuid }),
      sql`select ob.organisation_id from commerce.stores s join commerce.organisation_billing ob on ob.organisation_id = s.organisation_id
           where s.id = ${storeId}::uuid and ob.extras_cap_minor is not null`,
    );
    if (!capped) return true;
    const period = await currentPeriod(capped.organisation_id, now);
    if (!period) return true;
    return aiMayTakeOne(await extraLines(capped.organisation_id, period.from, now, period.currency), period.capMinor);
  } catch (error) {
    log("warn", "extras.ai_room_unread", { storeId }, error);
    return true;
  }
}

