import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { DnsRecord, DnsRecordInput } from "@/lib/dns-records";

import type { Account } from "./auth";
import type { DomainRegistrar } from "./registrars/types";
import type { DnsHostApi } from "./vercel-dns";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const move = await import("./domain-move");
const dns = await import("./domain-dns");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const apex = `move-${run}.com`;
const CODE = `CANARY-${run}-transfer`;

/** Vercel's DNS in memory. */
function fakeHost(initial: DnsRecordInput[]) {
  let n = 0;
  const records: DnsRecord[] = initial.map((r) => ({ id: `rec_${(n += 1)}`, ttl: 3600, ...r }));
  const removedZones: string[] = [];
  const host: DnsHostApi = {
    zone: async () => null,
    addZone: async () => ({ serviceType: "zeit.world", nameservers: [], intendedNameservers: [], verified: true }),
    removeZone: async (a) => void removedZones.push(a),
    records: async () => records.map((r) => ({ ...r })),
    create: async (_a, record) => {
      const id = `rec_${(n += 1)}`;
      records.push({ ttl: 3600, ...record, id } as DnsRecord);
      return id;
    },
    update: async () => {},
    remove: async (_a, id) => {
      const at = records.findIndex((r) => r.id === id);
      if (at >= 0) records.splice(at, 1);
    },
  };
  return { host, records, removedZones };
}

const nameserverCalls: string[] = [];
let held = true;
const fakeRegistrar = {
  id: "vercel",
  currency: "USD",
  setNameservers: async (domain: string, ns: readonly string[]) => void nameserverCalls.push(`${domain} ${ns.join(",") || "vercel"}`),
  authCode: async () => CODE,
  setAutoRenew: async () => {},
  domain: async () => (held ? { expiresAt: null, boughtAt: null, renews: true, nameservers: [] } : null),
} as unknown as DomainRegistrar;

let owner: Account;
let storeId: string;

beforeAll(async () => {
  const [acc] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`move-${run}@example.com`}, 'Kari Nordmann', false) returning id, email`);
  owner = { id: String(acc.id), email: String(acc.email), name: "Kari Nordmann", platformAdmin: false } as Account;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${owner.email}, 'Owner', ${`move-${run}`}) returning id`);
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`move-${run}`}, ${`move-${run}`}, null) as id`);
  storeId = String(id);
  // Registered here a year ago, renewing, its DNS here, and the store on it.
  await db().execute(sql`
    insert into commerce.domain_registrations (store_id, apex, registrar, registered_at, expires_at, contact_verified)
    values (${storeId}::uuid, ${apex}, 'vercel', now() - interval '1 year', now() + interval '200 days', true)
  `);
  await db().execute(sql`insert into commerce.dns_zones (store_id, apex) values (${storeId}::uuid, ${apex})`);
});

afterAll(async () => {
  await closeDb();
});

const zone = (): DnsRecordInput[] => [
  { type: "A", name: "", value: "76.76.21.21" },
  { type: "MX", name: "", value: "smtp.google.com", mxPriority: 1 },
  { type: "TXT", name: "", value: "v=spf1 include:_spf.google.com ~all" },
];

/** New nameservers that answer everything but the TXT record. */
const askWithoutTxt: import("./domain-move").AskNameservers = async (_ns, _apex, questions) =>
  questions.map((q) => ({
    ...q,
    records: q.type === "TXT" ? [] : zone().filter((r) => r.name === q.name && r.type === q.type),
  }));

describe("moving a domain away (D315 8)", () => {
  it("gives the records as a zone file to take along", async () => {
    const fake = fakeHost(zone());
    const file = await move.exportZone(storeId, apex, "bind", { host: fake.host });
    expect(file.ok && file.body).toContain("@\t3600\tIN\tMX\t1 smtp.google.com.");
    const csv = await move.exportZone(storeId, apex, "csv", { host: fake.host });
    expect(csv.ok && csv.filename).toBe(`${apex}-dns.csv`);
  });

  it("checks the new provider, switches only when its records are there or may go, and switches back", async () => {
    const fake = fakeHost(zone());
    const deps = { host: fake.host, ask: askWithoutTxt, registrar: () => fakeRegistrar };
    const check = await move.nameserverSwitchCheck(storeId, apex, "ns1.other-dns.net\nns2.other-dns.net", deps);
    expect(check).toMatchObject({ ok: true, ready: false, unanswered: [], missing: [{ type: "TXT" }] });
    const refused = await move.switchNameservers(owner, storeId, apex, "ns1.other-dns.net ns2.other-dns.net", {}, deps);
    expect(refused.ok).toBe(false);
    expect(nameserverCalls).toEqual([]);

    const switched = await move.switchNameservers(owner, storeId, apex, "ns1.other-dns.net ns2.other-dns.net", { acceptMissing: true }, deps);
    expect(switched).toMatchObject({ ok: true, how: "registrar" });
    expect(nameserverCalls).toEqual([`${apex} ns1.other-dns.net,ns2.other-dns.net`]);
    // Read-only while it is kept: no change is made on a zone that is leaving.
    const change = await dns.applyDnsChange(owner, storeId, apex, [{ op: "add", record: { type: "TXT", name: "", value: "hello" } }], { source: "editor", host: fake.host });
    expect(change.ok).toBe(false);

    expect(await move.switchBack(owner, storeId, apex, deps)).toEqual({ ok: true });
    expect(nameserverCalls.at(-1)).toBe(`${apex} vercel`);
    const [z] = await db().execute<Row>(sql`select status, moved_to from commerce.dns_zones where apex = ${apex}`);
    expect(z).toMatchObject({ status: "active", moved_to: null });
  });

  it("keeps a zone 30 days after its nameservers moved, then lets it go without removing a domain still registered here", async () => {
    const fake = fakeHost(zone());
    const deps = { host: fake.host, ask: askWithoutTxt, registrar: () => fakeRegistrar };
    await move.switchNameservers(owner, storeId, apex, "ns1.other-dns.net ns2.other-dns.net", { acceptMissing: true }, deps);
    expect(await dns.leaveZones(30, deps)).toEqual({ left: 0, failed: 0 });
    await db().execute(sql`update commerce.dns_zones set leaving_at = now() - interval '31 days' where apex = ${apex} and status = 'leaving'`);
    expect(await dns.leaveZones(30, deps)).toEqual({ left: 1, failed: 0 });
    expect(fake.removedZones).toEqual([]);
    const [z] = await db().execute<Row>(sql`select status from commerce.dns_zones where apex = ${apex} order by created_at desc limit 1`);
    expect(z.status).toBe("left");
  });

  it("shows the transfer code only to the page, keeps no copy, and refuses it while a lock stands", async () => {
    const locked = `locked-${run}.com`;
    await db().execute(sql`
      insert into commerce.domain_registrations (store_id, apex, registrar, registered_at, expires_at, contact_verified)
      values (${storeId}::uuid, ${locked}, 'vercel', now() - interval '10 days', now() + interval '355 days', true)
    `);
    expect(await move.revealTransferCode(owner, storeId, locked, { registrar: () => fakeRegistrar })).toMatchObject({ ok: false });

    const shown = await move.revealTransferCode(owner, storeId, apex, { registrar: () => fakeRegistrar });
    expect(shown).toEqual({ ok: true, code: CODE });
    const [reg] = await db().execute<Row>(sql`select status, transfer_started_at from commerce.domain_registrations where apex = ${apex}`);
    expect(reg.status).toBe("transferring_out");
    // The canary: the code is in no row of the store's audit log, registrations, purchases, changes or zones.
    const [found] = await db().execute<Row>(sql`
      select
        (select count(*)::int from commerce.audit_log a where a.store_id = ${storeId}::uuid and a::text like ${`%${CODE}%`}) +
        (select count(*)::int from commerce.domain_registrations r where r.store_id = ${storeId}::uuid and r::text like ${`%${CODE}%`}) +
        (select count(*)::int from commerce.domain_purchases p where p.store_id = ${storeId}::uuid and p::text like ${`%${CODE}%`}) +
        (select count(*)::int from commerce.dns_changes c where c.store_id = ${storeId}::uuid and c::text like ${`%${CODE}%`}) +
        (select count(*)::int from commerce.dns_zones z where z.store_id = ${storeId}::uuid and z::text like ${`%${CODE}%`}) as n
    `);
    expect(found.n).toBe(0);
    const [entry] = await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${storeId}::uuid and action = 'store.domain_transfer_code_shown'`);
    expect(entry).toBeDefined();
  });

  it("follows the transfer until the registrar no longer holds the domain, then stops renewing it", async () => {
    expect(await move.watchTransfers({ registrar: () => fakeRegistrar })).toEqual({ moved: 0, given_up: 0 });
    held = false;
    expect(await move.watchTransfers({ registrar: () => fakeRegistrar })).toEqual({ moved: 1, given_up: 0 });
    const [reg] = await db().execute<Row>(sql`select status, renew, transferred_out_at from commerce.domain_registrations where apex = ${apex}`);
    expect(reg).toMatchObject({ status: "transferred_out", renew: false });
    expect(reg.transferred_out_at).not.toBeNull();
    // A moved registration stays moved.
    await expect(db().execute(sql`update commerce.domain_registrations set status = 'active' where apex = ${apex}`)).rejects.toThrow();
  });

  it("keeps a closing store's domains with their email, renewal off", async () => {
    const kept = `kept-${run}.com`;
    await db().execute(sql`
      insert into commerce.domain_registrations (store_id, apex, registrar, registered_at, expires_at, contact_verified)
      values (${storeId}::uuid, ${kept}, 'vercel', now() - interval '1 year', '2027-03-01', true)
    `);
    const lines = await move.keepDomainsOnClose(owner, storeId, { registrar: () => fakeRegistrar });
    expect(lines.some((l) => l.startsWith(`${kept} stays yours`))).toBe(true);
    const [reg] = await db().execute<Row>(sql`select renew from commerce.domain_registrations where apex = ${kept}`);
    expect(reg.renew).toBe(false);
  });
});
