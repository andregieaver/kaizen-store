import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { type DnsChange } from "@/lib/dns-plan";
import { firstQuestions, mergeFound, secondQuestions, type FoundRecord } from "@/lib/dns-probe";
import { recordKey, recordProblems, tidyRecord, type DnsRecordInput } from "@/lib/dns-records";
import { isVercelNameserver } from "@/lib/domain-health";
import { missingRecords, questionsFor, type Answer } from "@/lib/domain-move";
import { parseZone } from "@/lib/zone-file";

import { audit, type Account } from "./auth";
import { abandonArrivingZone, applyDnsChange, markArrived, openArrivingZone, storeZone } from "./domain-dns";
import { publicRdap, systemDns, type PublicDns, type Rdap } from "./domain-health";
import { askNameservers, type AskNameservers } from "./domain-move";
import { storeRegistration } from "./domain-registrations";
import { listStoreDomains } from "./domains";
import { registrarById } from "./registrars";
import type { DomainRegistrar } from "./registrars/types";
import type { DnsHostApi } from "./vercel-dns";

type Row = Record<string, unknown>;
type Result<T = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

/**
 * Moving a domain's DNS here (D315, `docs/domains.md` 5.4), so its records can be changed by hand and by the AI manager: the records are
 * brought (a zone file from the current provider, or what asking its nameservers finds), checked against what the internet sees today,
 * copied into an empty zone on Vercel and checked there, and only then does the owner change the nameservers, which nothing here does for
 * them unless the registration is here. Until then nothing about their email or site changes. Only a domain the store has shown is its
 * own (a connection that passed P8's checks, or a registration here) can move in.
 */

export type MoveInDeps = { host?: DnsHostApi; ask?: AskNameservers; dns?: PublicDns; rdap?: Rdap; registrar?: (id: string) => DomainRegistrar | null };

const STORE_A = "76.76.21.21";
const STORE_CNAME = "cname.vercel-dns.com";
/** Vercel's nameservers, as its documentation names them; a zone's own come from Vercel when it is made. */
export const VERCEL_NAMESERVERS = ["ns1.vercel-dns.com", "ns2.vercel-dns.com"];

/** Whether the store has shown the domain is its own: an active connection on it or under it, or a registration here. */
async function ownsDomain(storeId: string, apex: string): Promise<{ owned: boolean; connected: string[] }> {
  const connected = (await listStoreDomains(storeId))
    .filter((d) => (d.hostname === apex || d.hostname.endsWith(`.${apex}`)))
    .map((d) => ({ name: d.hostname === apex ? "" : d.hostname.slice(0, -apex.length - 1), active: d.status === "active" }));
  const registration = await storeRegistration(storeId, apex);
  const owned = connected.some((c) => c.active) || Boolean(registration && registration.status !== "transferred_out");
  return { owned, connected: connected.map((c) => c.name) };
}

/** Asks named nameservers about the usual names, in two rounds (a name with a CNAME holds nothing else). */
async function probe(nameservers: readonly string[], apex: string, ask: AskNameservers): Promise<Answer[]> {
  const first = await ask(nameservers, apex, firstQuestions());
  const second = await ask(nameservers, apex, secondQuestions(first));
  return [...first, ...second];
}

export type MoveInLook = {
  apex: string;
  /** Where its DNS is answered now, as public DNS says, and the registrar RDAP names. */
  nameservers: string[];
  registrar: string | null;
  found: FoundRecord[];
  /** Records left out, each with why: the store's own pointing records (Kaizena Flow writes them), and what the file could not hold. */
  kept: DnsRecordInput[];
  problems: string[];
  skipped: string[];
  registeredHere: boolean;
};

/**
 * What would move (nothing is changed): the current provider asked directly, and the zone file, if the owner brought one, read and checked
 * against it. Refused for a domain the store hasn't shown is its own, and one whose DNS is here already.
 */
export async function lookBeforeMoveIn(storeId: string, domain: string, zoneText: string | null, deps: MoveInDeps = {}): Promise<Result<{ look: MoveInLook }>> {
  const apex = domain.trim().toLowerCase().replace(/\.$/, "");
  const { owned, connected } = await ownsDomain(storeId, apex);
  if (!owned) return { ok: false, problems: [`Connect ${apex} to the store first (its records checked under Domains), or register it here: then its DNS can move here.`] };
  if (await storeZone(storeId, apex)) return { ok: false, problems: [`Kaizena Flow keeps the DNS of ${apex} already.`] };
  const nameservers = (await (deps.dns ?? systemDns()).ns(apex)) ?? [];
  if (nameservers.length === 0) return { ok: false, problems: [`Public DNS doesn't say where ${apex}'s DNS is answered just now. Try again in a moment.`] };
  if (nameservers.every(isVercelNameserver)) return { ok: false, problems: [`${apex}'s DNS is answered by Vercel already, outside Kaizena Flow's team.`] };
  const answers = await probe(nameservers, apex, deps.ask ?? askNameservers);
  const file = zoneText?.trim() ? parseZone(zoneText.slice(0, 200_000), apex) : { records: [], problems: [], skipped: [] };
  const merged = mergeFound(file.records, answers);
  // What points the store's own names here is Kaizena Flow's to write; everything else moves as it is.
  const pointing = (r: DnsRecordInput) => connected.includes(r.name) && ["A", "AAAA", "ALIAS", "CNAME"].includes(r.type);
  const kept = merged.filter((f) => pointing(f.record)).map((f) => f.record);
  const found = merged.filter((f) => !pointing(f.record));
  const invalid = found.flatMap((f) => recordProblems(tidyRecord(f.record, apex)).map((p) => `${f.record.type} ${f.record.name || "@"}: ${p}`));
  const rdap = await (deps.rdap ?? publicRdap)(apex).catch(() => null);
  const registration = await storeRegistration(storeId, apex);
  return {
    ok: true,
    look: {
      apex,
      nameservers,
      registrar: rdap?.registrar ?? null,
      found: found.filter((f) => recordProblems(tidyRecord(f.record, apex)).length === 0),
      kept,
      problems: [...file.problems, ...invalid],
      skipped: file.skipped,
      registeredHere: Boolean(registration && registration.status !== "transferred_out"),
    },
  };
}

/** The store's own records for a connected name: what points it at the store, written by Kaizena Flow. */
function storeRecords(connected: readonly string[]): DnsRecordInput[] {
  return connected.map((name) => (name === "" ? { type: "A" as const, name, value: STORE_A } : { type: "CNAME" as const, name, value: STORE_CNAME }));
}

export type ArrivalCheck = { nameservers: string[]; missing: DnsRecordInput[]; unanswered: string[] };

/**
 * Moves the DNS here (5.4 steps 3 and 4): the zone is made on Vercel, filled with the records the owner kept (`keys`: the records of the
 * look, by `recordKey()`, all of them when not given) and the store's own, and asked back at Vercel's nameservers. The owner then sets those
 * nameservers at their registrar; with the registration here, `pointHere` sets them now.
 */
export async function startMoveIn(
  account: Account,
  storeId: string,
  domain: string,
  input: { zoneText: string | null; keys?: readonly string[]; pointHere?: boolean },
  deps: MoveInDeps = {},
): Promise<Result<{ nameservers: string[]; check: ArrivalCheck; pointed: boolean; copied: number }>> {
  const looked = await lookBeforeMoveIn(storeId, domain, input.zoneText, deps);
  if (!looked.ok) return looked;
  const { look } = looked;
  const chosen = input.keys ? new Set(input.keys) : null;
  const records = look.found.map((f) => f.record).filter((r) => !chosen || chosen.has(recordKey(r)));
  const { connected } = await ownsDomain(storeId, look.apex);
  const opened = await openArrivingZone(account, storeId, look.apex, { host: deps.host });
  if (!opened.ok) return opened;
  const changes: DnsChange[] = [...storeRecords(connected), ...records].map((record) => ({ op: "add", record }));
  if (changes.length > 0) {
    const applied = await applyDnsChange(account, storeId, look.apex, changes, { source: "import", kaizena: true, host: deps.host });
    if (!applied.ok) {
      await abandonArrivingZone(account, storeId, look.apex, { host: deps.host });
      return { ok: false, problems: applied.problems };
    }
  }
  const answers = await (deps.ask ?? askNameservers)(opened.nameservers, look.apex, questionsFor(records));
  const check = { nameservers: opened.nameservers, ...missingRecords(records, answers) };
  let pointed = false;
  if (input.pointHere && look.registeredHere) pointed = (await pointNameserversHere(account, storeId, look.apex, deps)).ok;
  await audit(account.id, storeId, "store.domain_dns_copied", { domain: look.apex, records: records.length, missing: check.missing.length });
  return { ok: true, nameservers: opened.nameservers, check, pointed, copied: records.length };
}

/** With the registration here, the nameservers are set to Vercel's at the registrar (an empty list means the registrar's own). */
export async function pointNameserversHere(account: Account, storeId: string, apex: string, deps: MoveInDeps = {}): Promise<Result> {
  const registration = await storeRegistration(storeId, apex);
  if (!registration || registration.status === "transferred_out") return { ok: false, problems: [`${apex} isn't registered here: set the nameservers where it is registered.`] };
  const registrar = (deps.registrar ?? registrarById)(registration.registrar);
  try {
    await registrar?.setNameservers(apex, []);
  } catch {
    return { ok: false, problems: ["The registrar refused the nameservers just now. Try again in a moment."] };
  }
  await audit(account.id, storeId, "store.domain_nameservers_here", { domain: apex });
  return { ok: true };
}

/** Stops a move here that hasn't arrived: the zone made for it is let go, the domain's DNS untouched. */
export const stopMoveIn = (account: Account, storeId: string, apex: string, deps: MoveInDeps = {}) => abandonArrivingZone(account, storeId, apex.toLowerCase(), { host: deps.host });

/**
 * Whether zones moving here have arrived (public DNS shows only Vercel's nameservers for them): one store's as its page is looked at, every
 * store's in the daily job. Returns the domains that arrived now.
 */
export async function checkArrivals(scope: { storeId?: string } = {}, deps: MoveInDeps = {}): Promise<string[]> {
  const rows = await db().execute<Row>(sql`
    select store_id, apex from commerce.dns_zones
     where status = 'active' and arrived_at is null ${scope.storeId ? sql`and store_id = ${scope.storeId}::uuid` : sql``}
     order by created_at limit 100
  `);
  const dns = deps.dns ?? systemDns();
  const arrived: string[] = [];
  for (const row of rows) {
    const ns = await dns.ns(String(row.apex)).catch(() => null);
    if (ns && ns.length > 0 && ns.every(isVercelNameserver) && (await markArrived(String(row.store_id), String(row.apex)))) arrived.push(String(row.apex));
  }
  return arrived;
}

/** The store's zones moving here, for the page: each with the nameservers to set. */
export async function arrivingZones(storeId: string): Promise<{ apex: string; since: string }[]> {
  const rows = await db().execute<Row>(sql`
    select apex, created_at from commerce.dns_zones where store_id = ${storeId}::uuid and status = 'active' and arrived_at is null order by created_at
  `);
  return rows.map((r) => ({ apex: String(r.apex), since: new Date(String(r.created_at)).toISOString() }));
}
