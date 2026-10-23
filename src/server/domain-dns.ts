import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { planDns, zoneRev, type DnsChange, type DnsPlan } from "@/lib/dns-plan";
import { describeRecord, recordKey, type DnsRecord, type DnsRecordInput } from "@/lib/dns-records";

import { audit, type Account } from "./auth";
import { heldBy, holderColumns, holderOf, storeOf, type HolderRef } from "./domain-holder";
import { domainsConfigured } from "./vercel";
import { vercelDns, type DnsHostApi } from "./vercel-dns";

type Row = Record<string, unknown>;
type Result<T = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

/**
 * The DNS Kaizena Flow keeps for stores and the accounts that hold domains (D315, D317, `docs/domains.md` 5): the only writer of their records (through `vercel-dns.ts`) and of
 * `dns_changes` (a scan test holds both). Every change is planned by `planDns()` on the live records read under the zone's row lock, refused
 * when the records are not those the change was planned on (`rev`), applied record by record, taken back if a step fails, and kept with the
 * records before and after so it can be undone while the zone is still as it left it.
 */

export type Zone = {
  id: string;
  /** The store that uses it, if one does (D317). */
  storeId: string | null;
  accountId: string | null;
  apex: string;
  status: "active" | "leaving" | "left";
  /** When public DNS first showed Vercel's nameservers for it; null while a zone moving here waits for the owner's change (5.4). */
  arrivedAt: string | null;
};

export type ChangeSource = "editor" | "ai_manager" | "recipe" | "kaizena" | "undo" | "import";

export type DnsHistoryEntry = {
  id: string;
  source: ChangeSource;
  summary: string;
  automatic: boolean;
  actor: string | null;
  createdAt: string;
  undoneAt: string | null;
  undoOf: string | null;
};

const toZone = (r: Row): Zone => ({
  id: String(r.id),
  storeId: r.store_id ? String(r.store_id) : null,
  accountId: r.account_id ? String(r.account_id) : null,
  apex: String(r.apex),
  status: String(r.status) as Zone["status"],
  arrivedAt: r.arrived_at ? new Date(String(r.arrived_at)).toISOString() : null,
});

/** The zones a store keeps here (not left), oldest first. */
export async function storeZones(holder: HolderRef): Promise<Zone[]> {
  const rows = await db().execute<Row>(sql`select * from commerce.dns_zones where ${heldBy(holder)} and status <> 'left' order by created_at`);
  return rows.map(toZone);
}

export async function storeZone(holder: HolderRef, apex: string): Promise<Zone | null> {
  const [row] = await db().execute<Row>(sql`
    select * from commerce.dns_zones where ${heldBy(holder)} and apex = ${apex.trim().toLowerCase()} and status <> 'left'
  `);
  return row ? toZone(row) : null;
}

/**
 * The zone's hosts the store using it is served on, relative to the apex: their pointing records are the store's (`isProtected()`). A
 * domain no store uses has none.
 */
export async function connectedNames(holder: HolderRef, apex: string): Promise<string[]> {
  const storeId = storeOf(holder) ?? (await storeZone(holder, apex))?.storeId ?? null;
  if (!storeId) return [];
  const rows = await db().execute<Row>(sql`
    select hostname from commerce.store_domains where store_id = ${storeId}::uuid and (hostname = ${apex} or hostname like ${`%.${apex}`})
  `);
  return rows.map((r) => {
    const host = String(r.hostname);
    return host === apex ? "" : host.slice(0, -apex.length - 1);
  });
}

const host = (deps: { host?: DnsHostApi }) => deps.host ?? (domainsConfigured() ? vercelDns() : null);

/** The zone's records as Vercel answers them now, with the fingerprint a change is planned on. */
export async function zoneRecords(holder: HolderRef, apex: string, deps: { host?: DnsHostApi } = {}): Promise<Result<{ zone: Zone; records: DnsRecord[]; rev: string; connected: string[] }>> {
  const zone = await storeZone(holder, apex);
  if (!zone) return { ok: false, problems: [`Kaizena Flow doesn't keep the DNS of ${apex} for this store.`] };
  const api = host(deps);
  if (!api) return { ok: false, problems: ["Kaizena Flow's DNS isn't set up yet."] };
  try {
    const records = await api.records(zone.apex);
    return { ok: true, zone, records, rev: zoneRev(records), connected: await connectedNames(holder, zone.apex) };
  } catch {
    return { ok: false, problems: ["The DNS records can't be read just now. Try again in a moment."] };
  }
}

/** What a change would do, planned on the live records (nothing is changed). */
export async function previewDnsChange(holder: HolderRef, apex: string, changes: readonly DnsChange[], deps: { host?: DnsHostApi } = {}): Promise<Result<{ plan: DnsPlan }>> {
  const read = await zoneRecords(holder, apex, deps);
  if (!read.ok) return read;
  return { ok: true, plan: planDns({ apex: read.zone.apex, current: read.records, changes, connectedNames: read.connected }) };
}

const summaryOf = (plan: DnsPlan, apex: string) =>
  [...plan.removes.map((r) => `− ${describeRecord(r, apex)}`), ...plan.adds.map((r) => `+ ${describeRecord(r, apex)}`)].join("\n").slice(0, 2000) || "No change";

export type ApplyOptions = {
  source: ChangeSource;
  /** The fingerprint the change was planned on (the editor's look, an approval): refused when the records moved since. */
  rev?: string;
  automatic?: boolean;
  undoOf?: string;
  /** Kaizena Flow connecting or disconnecting the store may change its own records. */
  kaizena?: boolean;
  host?: DnsHostApi;
};

/**
 * Applies a change to a store's zone. The zone's row is locked for the whole change, so two changes never interleave; the live records are
 * read, the change planned, refused when `rev` no longer matches; then removed and added one by one, and anything done is taken back if a
 * step fails. Kept in `dns_changes` with the records before and after.
 */
export async function applyDnsChange(actor: Account | null, holder: HolderRef, apex: string, changes: readonly DnsChange[], options: ApplyOptions): Promise<Result<{ plan: DnsPlan; changeId: string }>> {
  const api = host(options);
  if (!api) return { ok: false, problems: ["Kaizena Flow's DNS isn't set up yet."] };
  return db().transaction(async (tx) => {
    const [zoneRow] = await tx.execute<Row>(sql`
      select * from commerce.dns_zones where ${heldBy(holder)} and apex = ${apex.trim().toLowerCase()} and status = 'active' for update
    `);
    if (!zoneRow) return { ok: false as const, problems: [`Kaizena Flow doesn't keep the DNS of ${apex} for this store.`] };
    const zone = toZone(zoneRow);
    let before: DnsRecord[];
    try {
      before = await api.records(zone.apex);
    } catch {
      return { ok: false as const, problems: ["The DNS records can't be read just now. Try again in a moment."] };
    }
    const plan = planDns({ apex: zone.apex, current: before, changes, connectedNames: await connectedNames(holder, zone.apex), kaizena: options.kaizena });
    if (options.rev && options.rev !== plan.rev) return { ok: false as const, problems: ["The records changed since you looked. Look at them again."] };
    if (!plan.ok) return { ok: false as const, problems: plan.problems.length > 0 ? plan.problems : ["Nothing to change."] };

    const removed: DnsRecord[] = [];
    const made: string[] = [];
    try {
      for (const r of plan.removes) {
        await api.remove(zone.apex, r.id);
        removed.push(r);
      }
      for (const r of plan.adds) made.push(await api.create(zone.apex, r));
    } catch {
      // Take back what was done, as far as Vercel lets us: the zone is left as it was found.
      for (const id of made) await api.remove(zone.apex, id).catch(() => {});
      for (const r of removed) await api.create(zone.apex, r).catch(() => {});
      return { ok: false as const, problems: ["Vercel refused a step, so nothing was changed. Try again in a moment."] };
    }
    const after = await api.records(zone.apex).catch(() => null);
    const [change] = await tx.execute<Row>(sql`
      insert into commerce.dns_changes (zone_id, store_id, source, summary, before, after, undo_of, actor_id, automatic)
      values (${zone.id}::uuid, ${zone.storeId}::uuid, ${options.source}, ${summaryOf(plan, zone.apex)}, ${JSON.stringify(before)}::jsonb,
        ${JSON.stringify(after ?? plan.after)}::jsonb, ${options.undoOf ?? null}::uuid, ${actor?.id ?? null}::uuid, ${options.automatic === true})
      returning id
    `);
    await audit(actor?.id ?? null, zone.storeId, "store.domain_dns_changed", {
      domain: zone.apex,
      source: options.source,
      automatic: options.automatic === true,
      added: plan.adds.map((r) => `${r.type} ${r.name || "@"}`),
      removed: plan.removes.map((r) => `${r.type} ${r.name || "@"}`),
    });
    return { ok: true as const, plan, changeId: String(change.id) };
  });
}

/** A store's DNS changes of one zone, newest first. */
export async function dnsHistory(holder: HolderRef, apex: string, limit = 30): Promise<DnsHistoryEntry[]> {
  const rows = await db().execute<Row>(sql`
    select c.*, a.name as actor_name, a.email as actor_email from commerce.dns_changes c
      join commerce.dns_zones z on z.id = c.zone_id
      left join commerce.accounts a on a.id = c.actor_id
     where ${heldBy(holder, "z")} and z.apex = ${apex.toLowerCase()}
     order by c.created_at desc limit ${limit}
  `);
  return rows.map((r) => ({
    id: String(r.id),
    source: String(r.source) as ChangeSource,
    summary: String(r.summary),
    automatic: r.automatic === true,
    actor: r.actor_name ? String(r.actor_name) : r.actor_email ? String(r.actor_email) : null,
    createdAt: new Date(String(r.created_at)).toISOString(),
    undoneAt: r.undone_at ? new Date(String(r.undone_at)).toISOString() : null,
    undoOf: r.undo_of ? String(r.undo_of) : null,
  }));
}

/**
 * Puts a change back (D315 5.1): only while the zone is still as the change left it (D305's rule for versions), by removing what it added and
 * adding what it removed, as a change of its own (`source = 'undo'`); the change is marked undone, once.
 */
export async function undoDnsChange(actor: Account | null, holder: HolderRef, changeId: string, deps: { host?: DnsHostApi } = {}): Promise<Result<{ plan: DnsPlan }>> {
  const [row] = await db().execute<Row>(sql`
    select c.*, z.apex from commerce.dns_changes c join commerce.dns_zones z on z.id = c.zone_id
     where c.id = ${changeId}::uuid and ${heldBy(holder, "z")}
  `);
  if (!row) return { ok: false, problems: ["That change is gone."] };
  if (row.undone_at) return { ok: false, problems: ["That change was undone already."] };
  const apex = String(row.apex);
  const before = row.before as DnsRecord[];
  const after = row.after as DnsRecord[];
  const read = await zoneRecords(holder, apex, deps);
  if (!read.ok) return read;
  if (zoneRev(read.records) !== zoneRev(after)) return { ok: false, problems: ["The records changed after this change, so it can't be undone on its own. Change them in the editor instead."] };
  const keysBefore = new Set(before.map(recordKey));
  const keysAfter = new Set(after.map(recordKey));
  const changes: DnsChange[] = [
    ...read.records.filter((r) => !keysBefore.has(recordKey(r))).map((r) => ({ op: "remove" as const, record: r })),
    ...before.filter((r) => !keysAfter.has(recordKey(r))).map((r): DnsChange => ({ op: "add", record: stripId(r) })),
  ];
  const applied = await applyDnsChange(actor, holder, apex, changes, { source: "undo", rev: read.rev, undoOf: changeId, kaizena: row.source === "kaizena", host: deps.host });
  if (!applied.ok) return applied;
  await db().execute(sql`update commerce.dns_changes set undone_at = now() where id = ${changeId}::uuid and undone_at is null`);
  return { ok: true, plan: applied.plan };
}

const stripId = (r: DnsRecord): DnsRecordInput => {
  const { id: _id, ...rest } = r;
  void _id;
  return rest;
};

/** Whether the store lets the AI manager change DNS records without asking (D315 decision 5). */
export async function dnsAuto(holder: HolderRef): Promise<boolean> {
  const h = holderOf(holder);
  const [row] =
    h.kind === "store"
      ? await db().execute<Row>(sql`select domain_dns_auto from commerce.stores where id = ${h.storeId}::uuid`)
      : await db().execute<Row>(sql`select domain_dns_auto from commerce.accounts where id = ${h.accountId}::uuid`);
  return row?.domain_dns_auto === true;
}

/** The owner's switch (owners only, checked by the caller), or a holder's own for the domains they hold, audited. */
export async function setDnsAuto(account: Account, holder: HolderRef, on: boolean): Promise<void> {
  const h = holderOf(holder);
  if (h.kind === "store") await db().execute(sql`update commerce.stores set domain_dns_auto = ${on} where id = ${h.storeId}::uuid`);
  else await db().execute(sql`update commerce.accounts set domain_dns_auto = ${on} where id = ${h.accountId}::uuid`);
  await audit(account.id, storeOf(h), "store.domain_dns_auto_set", { on });
}

/**
 * The zone's nameservers moved away (D315 8.2): it is kept, read-only (`applyDnsChange()` changes only an active zone), with *Switch back*,
 * until `leaveZones()` takes it out of Kaizena Flow's team after `MOVE_KEEP_DAYS`.
 */
export async function markZoneLeaving(actor: Account | null, holder: HolderRef, apex: string, nameservers: readonly string[]): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    update commerce.dns_zones set status = 'leaving', leaving_at = now(), moved_to = ${JSON.stringify(nameservers)}::jsonb, updated_at = now()
     where ${heldBy(holder)} and apex = ${apex.toLowerCase()} and status = 'active'
    returning id, store_id
  `);
  if (row) await audit(actor?.id ?? null, (row.store_id as string | null) ?? null, "store.domain_dns_moved", { domain: apex, nameservers: [...nameservers] });
  return Boolean(row);
}

/** *Switch back* while the zone is kept: it is the store's live zone again. */
export async function markZoneBack(actor: Account | null, holder: HolderRef, apex: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    update commerce.dns_zones set status = 'active', leaving_at = null, moved_to = null, updated_at = now()
     where ${heldBy(holder)} and apex = ${apex.toLowerCase()} and status = 'leaving'
    returning id, store_id
  `);
  if (row) await audit(actor?.id ?? null, (row.store_id as string | null) ?? null, "store.domain_dns_back", { domain: apex });
  return Boolean(row);
}

/**
 * Zones whose nameservers moved away more than `days` ago leave Kaizena Flow's team (the daily job); a failure is tried again next day. A
 * domain still registered here stays in the team (the registration lives there; removing it could give the name up), and its zone is only
 * marked left: its records answer nobody once the nameservers are elsewhere.
 */
export async function leaveZones(days: number, deps: { host?: DnsHostApi } = {}): Promise<{ left: number; failed: number }> {
  const api = host(deps);
  if (!api) return { left: 0, failed: 0 };
  const rows = await db().execute<Row>(sql`
    select z.id, z.store_id, z.apex,
           exists (select 1 from commerce.domain_registrations r where r.apex = z.apex and r.status <> 'transferred_out') as registered
      from commerce.dns_zones z where z.status = 'leaving' and z.leaving_at < now() - make_interval(days => ${days}) limit 50
  `);
  let left = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (!row.registered) await api.removeZone(String(row.apex));
      await db().execute(sql`update commerce.dns_zones set status = 'left', left_at = now(), updated_at = now() where id = ${String(row.id)}::uuid and status = 'leaving'`);
      await audit(null, (row.store_id as string | null) ?? null, "store.domain_dns_left", { domain: String(row.apex) });
      left++;
    } catch {
      failed++;
    }
  }
  return { left, failed };
}

/**
 * A zone moving here (D315 5.4): the domain is added to Kaizena Flow's Vercel team, so Vercel's nameservers answer for it, and the zone is
 * kept with `arrived_at` empty until public DNS shows those nameservers. Returns the nameservers the owner sets at their registrar.
 */
export async function openArrivingZone(actor: Account, holder: HolderRef, apex: string, deps: { host?: DnsHostApi } = {}): Promise<Result<{ zone: Zone; nameservers: string[] }>> {
  const api = host(deps);
  if (!api) return { ok: false, problems: ["Kaizena Flow's DNS isn't set up yet."] };
  let info;
  try {
    info = (await api.zone(apex)) ?? (await api.addZone(apex));
  } catch {
    return { ok: false, problems: [`${apex} couldn't be added to Kaizena Flow's DNS. If it is used elsewhere on Vercel, remove it there first.`] };
  }
  const who = await holderColumns(holder, actor.id);
  try {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.dns_zones (store_id, account_id, apex, created_by) values (${who.storeId}::uuid, ${who.accountId}::uuid, ${apex}, ${actor.id}::uuid) returning *
    `);
    await audit(actor.id, who.storeId, "store.domain_dns_moving_in", { domain: apex });
    const nameservers = info.intendedNameservers.length > 0 ? info.intendedNameservers : ["ns1.vercel-dns.com", "ns2.vercel-dns.com"]; // Vercel's documented pair
    return { ok: true, zone: toZone(row), nameservers };
  } catch {
    return { ok: false, problems: [`Kaizena Flow already keeps the DNS of ${apex}.`] };
  }
}

/** Public DNS shows Vercel's nameservers for a zone moving here: it has arrived. Once. */
export async function markArrived(holder: HolderRef, apex: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    update commerce.dns_zones set arrived_at = now(), updated_at = now()
     where ${heldBy(holder)} and apex = ${apex.toLowerCase()} and status = 'active' and arrived_at is null
    returning id, store_id
  `);
  if (row) await audit(null, (row.store_id as string | null) ?? null, "store.domain_dns_arrived", { domain: apex.toLowerCase() });
  return Boolean(row);
}

/**
 * The owner stops a move here before it arrived: the zone is left and taken out of the team (never one still registered here). Its records
 * answered nobody, since the nameservers never pointed here.
 */
export async function abandonArrivingZone(actor: Account, holder: HolderRef, apex: string, deps: { host?: DnsHostApi } = {}): Promise<Result> {
  const [row] = await db().execute<Row>(sql`
    update commerce.dns_zones z set status = 'left', left_at = now(), updated_at = now()
     where ${heldBy(holder, "z")} and z.apex = ${apex.toLowerCase()} and z.status = 'active' and z.arrived_at is null
    returning z.apex, z.store_id, exists (select 1 from commerce.domain_registrations r where r.apex = z.apex and r.status <> 'transferred_out') as registered
  `);
  if (!row) return { ok: false, problems: [`${apex}'s DNS isn't on its way here.`] };
  const api = host(deps);
  if (api && !row.registered) await api.removeZone(String(row.apex)).catch(() => {});
  await audit(actor.id, (row.store_id as string | null) ?? null, "store.domain_dns_move_in_stopped", { domain: String(row.apex) });
  return { ok: true };
}
