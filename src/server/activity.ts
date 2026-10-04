import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { AUDIT_AREA_KEYS, isAuditArea, summaryOf, type AuditArea, type AuditChanges } from "@/lib/audit";
import { toCsv } from "@/lib/dac7";
import { AREAS, can, type Area } from "@/lib/permissions";

import { audit, holderOf, type Membership } from "./auth";

type Row = Record<string, unknown>;

/**
 * The activity log's reads (wave 1, 1f, docs/wave-1-trust.md 2.9): who did what and when, by person, area and period, paged by a
 * cursor, and the owner's CSV. Every query takes the store id, so another store's entries never appear, and an entry with no store
 * (the platform's) is never shown here.
 *
 * What a viewer sees: an owner every entry of the store; anyone else the entries of the areas they can read (`staff` needs
 * `staff:read`) and their own.
 */

export const ACTIVITY_PAGE = 50;
/** The CSV stops here: the page says so and asks for a shorter period. */
export const EXPORT_MAX_ROWS = 50_000;

export type ActivityFilters = {
  /** One person's entries. */
  accountId?: string | null;
  area?: AuditArea | null;
  /** The store's own days, `YYYY-MM-DD`, both ends included. */
  from?: string | null;
  to?: string | null;
  action?: string | null;
};

export type ActivityEntry = {
  id: number;
  at: string;
  accountId: string | null;
  email: string | null;
  name: string | null;
  avatarPath: string | null;
  action: string;
  area: AuditArea;
  target: { type: string; id: string; label: string | null } | null;
  /** The sentence, made by code from the action and its target. */
  summary: string;
  changes: AuditChanges | null;
};

export type ActivityPage = { entries: ActivityEntry[]; /** Pass as `before` for the next page; null on the last. */ next: number | null };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (value: string | null | undefined): string | null => (value && ISO_DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) ? value : null);

/** The areas of the store a member can read: all for an owner; `staff` entries need `staff:read`. */
export function readableAreas(member: Pick<Membership, "role" | "kind" | "permissions">): Area[] {
  const holder = holderOf(member);
  return AREAS.filter((area) => can(holder, `${area}:read`));
}

const areaOf = sql`coalesce(a.area, commerce.audit_area_of(a.action))`;

/** The conditions of one viewer's list: the store, what they may see, and the filters. */
function conditions(member: Membership, filters: ActivityFilters) {
  const parts = [sql`a.store_id = ${member.store.id}::uuid`];
  if (!can(holderOf(member), "owner")) {
    const areas = readableAreas(member);
    parts.push(sql`(a.account_id = ${member.account.id}::uuid or ${areaOf} = any(${sql.raw(`array[${areas.map((a) => `'${a}'`).join(", ") || "''"}]::text[]`)}))`);
  }
  if (filters.accountId) parts.push(sql`a.account_id = ${filters.accountId}::uuid`);
  if (filters.area && isAuditArea(filters.area)) parts.push(sql`${areaOf} = ${filters.area}`);
  if (filters.action) parts.push(sql`a.action = ${filters.action}`);
  const from = day(filters.from);
  const to = day(filters.to);
  const zone = member.store.timeZone || "Europe/Oslo";
  if (from) parts.push(sql`a.created_at >= (${from}::date)::timestamp at time zone ${zone}`);
  if (to) parts.push(sql`a.created_at < (${to}::date + 1)::timestamp at time zone ${zone}`);
  return parts;
}

const where = (parts: ReturnType<typeof sql>[]) => sql.join(parts, sql` and `);

function entryOf(row: Row): ActivityEntry {
  const changes = (row.changes ?? null) as AuditChanges | null;
  const details = (row.details ?? {}) as Record<string, unknown>;
  const target = row.target_type && row.target_id ? { type: String(row.target_type), id: String(row.target_id), label: typeof details.label === "string" ? details.label : null } : null;
  const action = String(row.action);
  const area = isAuditArea(row.area) ? row.area : "settings";
  return {
    id: Number(row.id),
    at: new Date(String(row.created_at)).toISOString(),
    accountId: row.account_id ? String(row.account_id) : null,
    email: row.email ? String(row.email) : null,
    name: row.name ? String(row.name) : null,
    avatarPath: row.avatar_path ? String(row.avatar_path) : null,
    action,
    area,
    target,
    summary: summaryOf(action, target ? { type: target.type, id: target.id, label: target.label ?? undefined } : null, changes),
    changes,
  };
}

const SELECT = sql`
  a.id, a.account_id, a.action, a.details, a.created_at, a.target_type, a.target_id, a.changes,
  ${areaOf} as area, acc.email, acc.name, acc.avatar_path
`;

/** One page of the store's activity, newest first, for the viewer: `before` is the last id of the previous page. */
export async function listActivity(member: Membership, filters: ActivityFilters = {}, before: number | null = null, limit = ACTIVITY_PAGE): Promise<ActivityPage> {
  const size = Math.min(Math.max(1, Math.trunc(limit)), 200);
  const parts = conditions(member, filters);
  if (before !== null && Number.isFinite(before)) parts.push(sql`a.id < ${Math.trunc(before)}`);
  const rows = await db().execute<Row>(sql`
    select ${SELECT}
    from commerce.audit_log a
    left join commerce.accounts acc on acc.id = a.account_id
    where ${where(parts)}
    order by a.id desc
    limit ${size + 1}
  `);
  const entries = rows.slice(0, size).map(entryOf);
  return { entries, next: rows.length > size ? entries[entries.length - 1].id : null };
}

/** The people the person filter offers: everyone who ever worked in the store or appears in its log, past members included. */
export async function activityPeople(member: Membership): Promise<{ accountId: string; label: string; current: boolean }[]> {
  const rows = await db().execute<Row>(sql`
    select a.id, coalesce(nullif(a.name, ''), a.email) as label,
      exists (select 1 from commerce.store_members m where m.store_id = ${member.store.id}::uuid and m.account_id = a.id and m.disabled_at is null) as current
    from commerce.accounts a
    where exists (select 1 from commerce.store_members m where m.store_id = ${member.store.id}::uuid and m.account_id = a.id)
       or exists (select 1 from commerce.audit_log l where l.store_id = ${member.store.id}::uuid and l.account_id = a.id)
    order by lower(coalesce(nullif(a.name, ''), a.email))
  `);
  return rows.map((row) => ({ accountId: String(row.id), label: String(row.label), current: Boolean(row.current) }));
}

/** The actions the filter offers: those that appear in what this viewer may see. */
export async function activityActions(member: Membership): Promise<string[]> {
  const rows = await db().execute<Row>(sql`
    select distinct a.action from commerce.audit_log a where ${where(conditions(member, {}))} order by 1
  `);
  return rows.map((row) => String(row.action));
}

export type ExportResult = { ok: true; csv: string; rows: number } | { ok: false; problem: string };

/**
 * The owner's CSV of a period: time (UTC and the store's zone), person, area, action, target, the sentence and the changes. Owners
 * only; the period is required and at most 50,000 entries are written (a longer one is refused, never cut short). The export is
 * itself an entry. Cells go through `toCsv()`, which makes one that starts `=`, `+`, `-` or `@` harmless.
 */
export async function exportActivity(member: Membership, filters: ActivityFilters): Promise<ExportResult> {
  if (!can(holderOf(member), "owner")) return { ok: false, problem: "Only an owner can download the activity log." };
  const from = day(filters.from);
  const to = day(filters.to);
  if (!from || !to) return { ok: false, problem: "Choose the first and last day to download." };
  if (from > to) return { ok: false, problem: "The first day must not be after the last day." };
  const parts = conditions(member, { ...filters, from, to });
  const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log a where ${where(parts)}`);
  const total = Number(count?.n ?? 0);
  if (total > EXPORT_MAX_ROWS) return { ok: false, problem: `That period has ${total.toLocaleString("en-GB")} entries and a download holds at most ${EXPORT_MAX_ROWS.toLocaleString("en-GB")}. Choose a shorter period.` };
  const zone = member.store.timeZone || "Europe/Oslo";
  const rows = await db().execute<Row>(sql`
    select ${SELECT}, to_char(a.created_at at time zone ${zone}, 'YYYY-MM-DD HH24:MI:SS') as local_time
    from commerce.audit_log a
    left join commerce.accounts acc on acc.id = a.account_id
    where ${where(parts)}
    order by a.id
  `);
  const table: (string | number | null)[][] = [["Time (UTC)", `Time (${zone})`, "Person", "Area", "Action", "Target type", "Target id", "What happened", "Changes"]];
  for (const row of rows) {
    const entry = entryOf(row);
    table.push([entry.at, String(row.local_time), entry.email, entry.area, entry.action, entry.target?.type ?? null, entry.target?.id ?? null, entry.summary, entry.changes ? JSON.stringify(entry.changes) : null]);
  }
  await audit(member.account.id, member.store.id, "activity.exported", { from, to, rows: rows.length });
  return { ok: true, csv: toCsv(table), rows: rows.length };
}

export type PlatformActivityFilters = { accountId?: string | null; area?: AuditArea | null; from?: string | null; to?: string | null; action?: string | null };

/**
 * One page of the platform's own activity (wave 1, 1f): entries with no store, such as two-step events, recovery codes used, resets and
 * approvals, newest first. For platform admins only: the page checks it (`requirePlatformAdmin()`), and no entry of a store is ever here
 * because every condition starts with `store_id is null`. Days are UTC.
 */
export async function listPlatformActivity(filters: PlatformActivityFilters = {}, before: number | null = null, limit = ACTIVITY_PAGE): Promise<ActivityPage> {
  const size = Math.min(Math.max(1, Math.trunc(limit)), 200);
  const parts = [sql`a.store_id is null`];
  if (filters.accountId) parts.push(sql`a.account_id = ${filters.accountId}::uuid`);
  if (filters.area && isAuditArea(filters.area)) parts.push(sql`${areaOf} = ${filters.area}`);
  if (filters.action) parts.push(sql`a.action = ${filters.action}`);
  const from = day(filters.from);
  const to = day(filters.to);
  if (from) parts.push(sql`a.created_at >= (${from}::date)::timestamp at time zone 'UTC'`);
  if (to) parts.push(sql`a.created_at < (${to}::date + 1)::timestamp at time zone 'UTC'`);
  if (before !== null && Number.isFinite(before)) parts.push(sql`a.id < ${Math.trunc(before)}`);
  const rows = await db().execute<Row>(sql`
    select ${SELECT}
    from commerce.audit_log a
    left join commerce.accounts acc on acc.id = a.account_id
    where ${where(parts)}
    order by a.id desc
    limit ${size + 1}
  `);
  const entries = rows.slice(0, size).map(entryOf);
  return { entries, next: rows.length > size ? entries[entries.length - 1].id : null };
}

/** The people and actions the platform log's filters offer: those that appear in it. */
export async function platformActivityFilters(): Promise<{ people: { accountId: string; label: string }[]; actions: string[] }> {
  const [people, actions] = await Promise.all([
    db().execute<Row>(sql`
      select distinct a.id, coalesce(nullif(a.name, ''), a.email) as label from commerce.audit_log l join commerce.accounts a on a.id = l.account_id
      where l.store_id is null order by 2
    `),
    db().execute<Row>(sql`select distinct action from commerce.audit_log where store_id is null order by 1`),
  ]);
  return { people: people.map((r) => ({ accountId: String(r.id), label: String(r.label) })), actions: actions.map((r) => String(r.action)) };
}

export { AUDIT_AREA_KEYS };
