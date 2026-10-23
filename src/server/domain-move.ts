import "server-only";

import { Resolver } from "node:dns/promises";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { zoneCsv } from "@/lib/dns-export";
import { isProtected } from "@/lib/dns-plan";
import { fqdn, type DnsRecordInput } from "@/lib/dns-records";
import { cleanNameservers, missingRecords, MOVE_KEEP_DAYS, moveSteps, questionsFor, TRANSFER_WAIT_DAYS, transferBlockers, type Answer, type MoveGoal, type MoveStep, type TransferFacts } from "@/lib/domain-move";
import { writeZone } from "@/lib/zone-file";

import { audit, type Account } from "./auth";
import { leaveZones, markZoneBack, markZoneLeaving, zoneRecords } from "./domain-dns";
import { setDomainRenewal } from "./domain-purchases";
import { storeRegistration } from "./domain-registrations";
import { listStoreDomains, removeStoreDomain } from "./domains";
import { registrarById } from "./registrars";
import type { DomainRegistrar } from "./registrars/types";
import type { DnsHostApi } from "./vercel-dns";

type Row = Record<string, unknown>;
type Result<T = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

/**
 * Moving a domain away from Kaizena Flow, made easy (D315, `docs/domains.md` 8): the zone's records to take along, a check of the new DNS
 * provider before the nameservers move, the switch and the way back, the transfer code for another registrar (read live, never kept), and
 * watching the transfer until it is done. Every step checks itself; nothing here deletes a registration or a zone's history.
 */

export type MoveDeps = { host?: DnsHostApi; registrar?: (id: string) => DomainRegistrar | null; ask?: AskNameservers; now?: Date };

/** The domain as a move reads it: the registration here (if any), the zone here (if any), whether the store uses it, and the checks. */
export async function moveFacts(storeId: string, apex: string, now = new Date()) {
  const name = apex.trim().toLowerCase();
  const [registration, zone, domains, [renewal]] = await Promise.all([
    storeRegistration(storeId, name),
    storeZoneAny(storeId, name),
    listStoreDomains(storeId),
    db().execute<Row>(sql`
      select 1 as under_way from commerce.domain_purchases
       where store_id = ${storeId}::uuid and apex = ${name} and kind = 'renew' and status in ('invoiced', 'paid', 'registering') limit 1
    `),
  ]);
  const connected = domains.filter((d) => d.hostname === name || d.hostname.endsWith(`.${name}`));
  const facts: TransferFacts | null = registration
    ? {
        apex: name,
        status: registration.status,
        registeredAt: registration.registeredAt,
        expiresAt: registration.expiresAt,
        contactVerified: registration.contactVerified,
        renewalUnderWay: Boolean(renewal),
      }
    : null;
  const checks = facts ? transferBlockers(facts, now) : { blockers: [], advice: [] };
  // The registrant's email: the registrar may send its approval of a transfer there (8.1).
  const [registrant] = registration
    ? await db().execute<Row>(sql`
        select g.email from commerce.domain_registrations r join commerce.domain_registrants g on g.id = r.registrant_id where r.id = ${registration.id}::uuid
      `)
    : [];
  return { apex: name, registration, zone, connected, transfer: checks, registrantEmail: registrant ? String(registrant.email) : null };
}

/** The zone's row whatever its state, `left` aside. */
async function storeZoneAny(storeId: string, apex: string) {
  const [row] = await db().execute<Row>(sql`
    select id, apex, status, leaving_at, moved_to from commerce.dns_zones where store_id = ${storeId}::uuid and apex = ${apex} and status <> 'left'
  `);
  if (!row) return null;
  return {
    status: String(row.status) as "active" | "leaving",
    leavingAt: row.leaving_at ? new Date(String(row.leaving_at)).toISOString() : null,
    movedTo: Array.isArray(row.moved_to) ? (row.moved_to as unknown[]).map(String) : [],
  };
}

/** The checklist of a move the owner chose, as the page and `plan_domain_move` show it. */
export async function movePlan(storeId: string, apex: string, goal: MoveGoal): Promise<Result<{ steps: MoveStep[]; facts: Awaited<ReturnType<typeof moveFacts>> }>> {
  const facts = await moveFacts(storeId, apex);
  if (!facts.registration && !facts.zone && facts.connected.length === 0) return { ok: false, problems: [`${apex} isn't one of this store's domains.`] };
  const steps = moveSteps(goal, {
    registeredHere: Boolean(facts.registration),
    registrationStatus: facts.registration?.status ?? null,
    zoneStatus: facts.zone?.status ?? null,
    connected: facts.connected.length > 0,
    blockers: facts.transfer.blockers.length,
  });
  return { ok: true, steps, facts };
}

/** The zone's records to take along, as a BIND zone file or a spreadsheet, with the store's own records marked. */
export async function exportZone(storeId: string, apex: string, format: "bind" | "csv", deps: MoveDeps = {}): Promise<Result<{ filename: string; body: string; type: string }>> {
  const read = await zoneRecords(storeId, apex, deps);
  if (!read.ok) return read;
  const kept = (r: DnsRecordInput) => isProtected(r, read.connected);
  if (format === "bind") return { ok: true, filename: `${read.zone.apex}.zone`, body: writeZone(read.zone.apex, read.records, { at: deps.now, kept }), type: "text/plain; charset=utf-8" };
  return { ok: true, filename: `${read.zone.apex}-dns.csv`, body: zoneCsv(read.zone.apex, read.records, kept), type: "text/csv; charset=utf-8" };
}

/** Asks named nameservers each question directly (never a cache); null for a question they didn't answer. */
export type AskNameservers = (nameservers: readonly string[], apex: string, questions: readonly { name: string; type: string }[]) => Promise<Answer[]>;

const ASK_MS = 3_000;

/** Through Node's resolver pointed at the nameservers' own addresses, three seconds a question. */
export const askNameservers: AskNameservers = async (nameservers, apex, questions) => {
  const lookup = new Resolver({ timeout: ASK_MS, tries: 1 });
  const addresses = (await Promise.all(nameservers.map((ns) => lookup.resolve4(ns).catch(() => [] as string[])))).flat();
  if (addresses.length === 0) return questions.map((q) => ({ ...q, records: null }));
  const resolver = new Resolver({ timeout: ASK_MS, tries: 2 });
  resolver.setServers(addresses);
  const none = (error: unknown) => ["ENODATA", "ENOTFOUND"].includes((error as { code?: string })?.code ?? "");
  return Promise.all(
    questions.map(async (q): Promise<Answer> => {
      const host = fqdn(q.name, apex);
      const base = { type: q.type as DnsRecordInput["type"], name: q.name };
      try {
        let records: DnsRecordInput[];
        switch (q.type) {
          case "A":
            records = (await resolver.resolve4(host)).map((value) => ({ ...base, value }));
            break;
          case "AAAA":
            records = (await resolver.resolve6(host)).map((value) => ({ ...base, value }));
            break;
          case "CNAME":
            records = (await resolver.resolveCname(host)).map((value) => ({ ...base, value }));
            break;
          case "MX":
            records = (await resolver.resolveMx(host)).map((r) => ({ ...base, value: r.exchange, mxPriority: r.priority }));
            break;
          case "TXT":
            records = (await resolver.resolveTxt(host)).map((parts) => ({ ...base, value: parts.join("") }));
            break;
          case "SRV":
            records = (await resolver.resolveSrv(host)).map((r) => ({ ...base, value: "", srv: { priority: r.priority, weight: r.weight, port: r.port, target: r.name } }));
            break;
          case "CAA":
            records = (await resolver.resolveCaa(host)).flatMap((r) => {
              const rec = r as unknown as Record<string, unknown>;
              return (["issue", "issuewild", "iodef"] as const).filter((tag) => typeof rec[tag] === "string").map((tag) => ({ ...base, value: `${Number(rec.critical ?? 0)} ${tag} "${String(rec[tag])}"` }));
            });
            break;
          default:
            return { ...q, records: null };
        }
        return { ...q, records };
      } catch (error) {
        return { ...q, records: none(error) ? [] : null };
      }
    }),
  );
};

export type SwitchCheck = { nameservers: string[]; missing: DnsRecordInput[]; unanswered: string[]; ready: boolean; rev: string };

/**
 * Before the nameservers move (8.2): the new nameservers are asked for every record the zone has, so the owner sees what would stop working.
 * The store's own records are asked too: a store that should stay on the domain needs them at the new provider.
 */
export async function nameserverSwitchCheck(storeId: string, apex: string, text: string, deps: MoveDeps = {}): Promise<Result<SwitchCheck>> {
  const { nameservers, problem } = cleanNameservers(text);
  if (problem) return { ok: false, problems: [problem] };
  const read = await zoneRecords(storeId, apex, deps);
  if (!read.ok) return read;
  const answers = await (deps.ask ?? askNameservers)(nameservers, read.zone.apex, questionsFor(read.records));
  const { missing, unanswered } = missingRecords(read.records, answers);
  return { ok: true, nameservers, missing, unanswered, ready: missing.length === 0 && unanswered.length === 0, rev: read.rev };
}

/**
 * Moves the DNS away (8.2), only after the check: with the registration here the nameservers are set at the registrar; with it elsewhere the
 * owner sets them there, and this only marks the zone as leaving once public DNS shows the new ones. `accepted` is the owner's word that the
 * records the check found missing may go (the page and the approval name them). The zone is kept 30 days with *Switch back*.
 */
export async function switchNameservers(
  account: Account | null,
  storeId: string,
  apex: string,
  text: string,
  options: { acceptMissing?: boolean } = {},
  deps: MoveDeps = {},
): Promise<Result<{ how: "registrar" | "watched"; check: SwitchCheck }>> {
  const check = await nameserverSwitchCheck(storeId, apex, text, deps);
  if (!check.ok) return check;
  if (check.unanswered.length > 0) return { ok: false, problems: [`The new nameservers didn't answer for ${check.unanswered.join(", ")}. Check they are set up for ${apex}, then try again.`] };
  if (check.missing.length > 0 && !options.acceptMissing) return { ok: false, problems: [`The new DNS provider doesn't have ${check.missing.length} of the records yet. Add them there, or say they may go.`] };
  const facts = await moveFacts(storeId, apex);
  if (facts.zone?.status !== "active") return { ok: false, problems: [`Kaizena Flow doesn't keep the DNS of ${apex} now.`] };
  const registration = facts.registration && facts.registration.status !== "transferred_out" ? facts.registration : null;
  if (registration) {
    const registrar = (deps.registrar ?? registrarById)(registration.registrar);
    if (!registrar) return { ok: false, problems: ["The registrar can't be reached just now."] };
    try {
      await registrar.setNameservers(facts.apex, check.nameservers);
    } catch {
      return { ok: false, problems: ["The registrar refused the new nameservers. Check them, then try again."] };
    }
    await markZoneLeaving(account, storeId, facts.apex, check.nameservers);
    return { ok: true, how: "registrar", check };
  }
  // Registered elsewhere: the owner sets the nameservers there; we take the zone as leaving once public DNS says so.
  const { systemDns } = await import("./domain-health");
  const live = await systemDns().ns(facts.apex);
  const moved = live !== null && live.length > 0 && live.every((ns) => check.nameservers.includes(ns.replace(/\.$/, "")));
  if (!moved) return { ok: false, problems: [`Set these nameservers for ${facts.apex} where it is registered: ${check.nameservers.join(", ")}. Public DNS doesn't show them yet; it can take a few hours.`] };
  await markZoneLeaving(account, storeId, facts.apex, check.nameservers);
  return { ok: true, how: "watched", check };
}

/** *Switch back* within 30 days: Vercel's nameservers again (set at the registrar when it is here), and the zone is live again. */
export async function switchBack(account: Account, storeId: string, apex: string, deps: MoveDeps = {}): Promise<Result> {
  const facts = await moveFacts(storeId, apex);
  if (facts.zone?.status !== "leaving") return { ok: false, problems: [`${apex}'s DNS isn't on its way out.`] };
  const registration = facts.registration && facts.registration.status !== "transferred_out" ? facts.registration : null;
  if (registration) {
    const registrar = (deps.registrar ?? registrarById)(registration.registrar);
    try {
      await registrar?.setNameservers(facts.apex, []);
    } catch {
      return { ok: false, problems: ["The registrar refused Kaizena Flow's nameservers just now. Try again in a moment."] };
    }
  }
  await markZoneBack(account, storeId, facts.apex);
  return { ok: true };
}

/**
 * The transfer code (8.1): only to an owner who signed in in the last ten minutes (the caller asks `signedInRecently()`), only while nothing
 * blocks the move, read live from the registrar each time. It is returned to the page and nowhere else: never stored, logged, emailed or
 * given to the AI manager (a canary test holds that). The registration is watched as moving from now on; the audit says who and when.
 */
export async function revealTransferCode(account: Account, storeId: string, apex: string, deps: MoveDeps = {}): Promise<Result<{ code: string }>> {
  const facts = await moveFacts(storeId, apex, deps.now);
  if (!facts.registration) return { ok: false, problems: [`${apex} isn't registered through Kaizena Flow, so its code is at its own registrar.`] };
  if (facts.transfer.blockers.length > 0) return { ok: false, problems: ["The domain can't move to another registrar yet. See what stops it on the page."] };
  const registrar = (deps.registrar ?? registrarById)(facts.registration.registrar);
  if (!registrar) return { ok: false, problems: ["The registrar can't be reached just now."] };
  let code: string;
  try {
    code = await registrar.authCode(facts.apex);
  } catch {
    return { ok: false, problems: ["The registrar didn't give the code just now. Try again in a moment."] };
  }
  await db().execute(sql`
    update commerce.domain_registrations set status = 'transferring_out', transfer_started_at = now(), updated_at = now()
     where store_id = ${storeId}::uuid and apex = ${facts.apex} and status in ('active', 'transferring_out')
  `);
  await audit(account.id, storeId, "store.domain_transfer_code_shown", { domain: facts.apex });
  return { ok: true, code };
}

/** The owner decides not to move after all: the registration is active here again and renews as before. */
export async function stayHere(account: Account, storeId: string, apex: string): Promise<Result> {
  const [row] = await db().execute<Row>(sql`
    update commerce.domain_registrations set status = 'active', transfer_started_at = null, updated_at = now()
     where store_id = ${storeId}::uuid and apex = ${apex.toLowerCase()} and status = 'transferring_out'
    returning id
  `);
  if (!row) return { ok: false, problems: [`${apex} isn't moving.`] };
  await audit(account.id, storeId, "store.domain_transfer_stopped", { domain: apex.toLowerCase() });
  return { ok: true };
}

/**
 * Follows registrations on their way to another registrar (the daily job): one the registrar no longer holds has moved: renewal and charges stop, open renewals are voided, and it stays moved. One that hasn't moved after
 * `TRANSFER_WAIT_DAYS` is taken back as active.
 */
export async function watchTransfers(deps: MoveDeps = {}): Promise<{ moved: number; given_up: number }> {
  const rows = await db().execute<Row>(sql`
    select id, store_id, apex, registrar, transfer_started_at from commerce.domain_registrations where status = 'transferring_out' limit 100
  `);
  const now = deps.now ?? new Date();
  let moved = 0;
  let givenUp = 0;
  for (const row of rows) {
    const apex = String(row.apex);
    const registrar = (deps.registrar ?? registrarById)(String(row.registrar));
    let gone = false;
    try {
      // Only the registrar's own word: RDAP names whichever wholesale registrar sits behind it, which says nothing reliable here.
      gone = (await registrar?.domain(apex)) === null;
    } catch {
      continue;
    }
    if (gone) {
      await db().execute(sql`
        update commerce.domain_registrations set status = 'transferred_out', transferred_out_at = now(), renew = false, updated_at = now()
         where id = ${String(row.id)}::uuid and status = 'transferring_out'
      `);
      await db().execute(sql`update commerce.domain_purchases set status = 'void' where apex = ${apex} and kind = 'renew' and status = 'quoted'`);
      await audit(null, String(row.store_id), "store.domain_transferred_out", { domain: apex });
      moved++;
    } else if (row.transfer_started_at && now.getTime() - new Date(String(row.transfer_started_at)).getTime() > TRANSFER_WAIT_DAYS * 86_400_000) {
      await db().execute(sql`
        update commerce.domain_registrations set status = 'active', transfer_started_at = null, updated_at = now()
         where id = ${String(row.id)}::uuid and status = 'transferring_out'
      `);
      givenUp++;
    }
  }
  return { moved, given_up: givenUp };
}

/** The daily part of moving away: transfers followed, and zones kept past their 30 days let go. */
export async function runDomainMoves(deps: MoveDeps = {}) {
  const transfers = await watchTransfers(deps);
  const zones = await leaveZones(MOVE_KEEP_DAYS, deps);
  return { ...transfers, zonesLeft: zones.left };
}

/** *Use it somewhere else* (8.3): the store stops using the domain; the registration, the zone and every other record stay. */
export async function disconnectDomain(account: Account, storeId: string, apex: string): Promise<Result<{ removed: string[] }>> {
  const name = apex.toLowerCase();
  const removed: string[] = [];
  for (const d of await listStoreDomains(storeId)) {
    if (d.hostname !== name && !d.hostname.endsWith(`.${name}`)) continue;
    const done = await removeStoreDomain(account, storeId, d.id);
    if (!done.ok) return { ok: false, problems: [`${d.hostname} couldn't be disconnected just now. Try again in a moment.`] };
    removed.push(d.hostname);
  }
  if (removed.length === 0) return { ok: false, problems: [`The store doesn't use ${apex}.`] };
  return { ok: true, removed };
}

/**
 * Closing a store (D171 with D315 9.3): the domains the store registered here or whose DNS it keeps stay the owner's, with their email and
 * every other record; renewal is turned off (the owner can turn it back on from the closed store's Domains page). Returns lines for the
 * closing's warnings. The connection itself is released by the closing, as for any domain.
 */
export async function keepDomainsOnClose(actor: Account, storeId: string, deps: MoveDeps = {}): Promise<string[]> {
  const rows = await db().execute<Row>(sql`
    select apex, renew, expires_at from commerce.domain_registrations where store_id = ${storeId}::uuid and status in ('active', 'expired', 'transferring_out')
  `);
  const lines: string[] = [];
  for (const row of rows) {
    const apex = String(row.apex);
    if (row.renew === true) await setDomainRenewal(actor, storeId, apex, false, { registrar: deps.registrar }).catch(() => null);
    const until = row.expires_at ? new Date(String(row.expires_at)).toISOString().slice(0, 10) : null;
    lines.push(
      `${apex} stays yours with its email and records${until ? ` until ${until}` : ""}: renewal is off. Turn it on, or move the domain, under Settings, Domains.`,
    );
  }
  const zones = await db().execute<Row>(sql`
    select apex from commerce.dns_zones z where store_id = ${storeId}::uuid and status = 'active'
       and not exists (select 1 from commerce.domain_registrations r where r.apex = z.apex and r.store_id = z.store_id and r.status <> 'transferred_out')
  `);
  for (const z of zones) lines.push(`Kaizena Flow keeps answering for ${String(z.apex)}'s DNS, email included, until you move it under Settings, Domains.`);
  return lines;
}
