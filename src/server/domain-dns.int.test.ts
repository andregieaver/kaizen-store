import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { DnsRecord, DnsRecordInput } from "@/lib/dns-records";

import type { Account } from "./auth";
import type { DnsHostApi } from "./vercel-dns";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const dns = await import("./domain-dns");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const apex = `dns-${run}.shop`;

/** Vercel's DNS kept in memory; `failOn` makes one create refuse, as Vercel might mid-change. */
function fakeHost(initial: DnsRecordInput[]) {
  let n = 0;
  const records: DnsRecord[] = initial.map((r) => ({ id: `rec_${(n += 1)}`, ttl: 3600, ...r }));
  const state = { failOn: null as string | null };
  const host: DnsHostApi = {
    zone: async () => ({ serviceType: "zeit.world", nameservers: [], intendedNameservers: [], verified: true }),
    addZone: async () => ({ serviceType: "zeit.world", nameservers: [], intendedNameservers: [], verified: true }),
    removeZone: async () => {},
    records: async () => records.map((r) => ({ ...r })),
    create: async (_apex, record) => {
      if (state.failOn && record.value === state.failOn) throw new Error("refused");
      const id = `rec_${(n += 1)}`;
      records.push({ ttl: 3600, ...record, id } as DnsRecord);
      return id;
    },
    update: async () => {},
    remove: async (_apex, id) => {
      const at = records.findIndex((r) => r.id === id);
      if (at >= 0) records.splice(at, 1);
    },
  };
  return { host, records, state };
}

let owner: Account;
let storeId: string;

beforeAll(async () => {
  const [acc] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`dns-${run}@example.com`}, 'Kari Nordmann', false) returning id, email`);
  owner = { id: String(acc.id), email: String(acc.email), name: "Kari Nordmann", platformAdmin: false } as Account;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${owner.email}, 'Owner', ${`dns-${run}`}) returning id`);
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`dns-${run}`}, ${`dns-${run}`}, null) as id`);
  storeId = String(id);
  await db().execute(sql`insert into commerce.dns_zones (store_id, apex) values (${storeId}::uuid, ${apex})`);
  await db().execute(sql`insert into commerce.store_domains (store_id, hostname, token, status) values (${storeId}::uuid, ${apex}, ${`t-${run}`}, 'active')`);
});

afterAll(async () => {
  await closeDb();
});

const zone = (): DnsRecordInput[] => [
  { type: "A", name: "", value: "76.76.21.21" },
  { type: "MX", name: "", value: "mx1.domeneshop.no", mxPriority: 10 },
];

describe("changing a store's DNS (D315 5)", () => {
  it("applies a change planned on the records it read, keeps it, and refuses one planned on records that moved", async () => {
    const fake = fakeHost(zone());
    const preview = await dns.previewDnsChange(storeId, apex, [{ op: "add", record: { type: "CNAME", name: "blog", value: "ghost.io" } }], { host: fake.host });
    if (!preview.ok) throw new Error(preview.problems.join());
    const applied = await dns.applyDnsChange(owner, storeId, apex, [{ op: "add", record: { type: "CNAME", name: "blog", value: "ghost.io" } }], { source: "editor", rev: preview.plan.rev, host: fake.host });
    expect(applied.ok).toBe(true);
    expect(fake.records.some((r) => r.name === "blog")).toBe(true);
    // The rev it was planned on is gone now.
    const stale = await dns.applyDnsChange(owner, storeId, apex, [{ op: "add", record: { type: "TXT", name: "", value: "hello" } }], { source: "editor", rev: preview.plan.rev, host: fake.host });
    expect(stale).toEqual({ ok: false, problems: ["The records changed since you looked. Look at them again."] });
    const history = await dns.dnsHistory(storeId, apex);
    expect(history[0]).toMatchObject({ source: "editor", actor: "Kari Nordmann", undoneAt: null });
    expect(history[0].summary).toContain("blog");
  });

  it("never touches what serves the store", async () => {
    const fake = fakeHost(zone());
    const [a] = await fake.host.records(apex);
    const refused = await dns.applyDnsChange(owner, storeId, apex, [{ op: "remove", record: a }], { source: "ai_manager", host: fake.host });
    expect(refused.ok).toBe(false);
    expect(fake.records).toHaveLength(2);
  });

  it("takes back what it did when Vercel refuses a step", async () => {
    const fake = fakeHost(zone());
    fake.state.failOn = "second.example.com";
    const failed = await dns.applyDnsChange(
      owner,
      storeId,
      apex,
      [
        { op: "remove", record: { type: "MX", name: "", value: "mx1.domeneshop.no", mxPriority: 10 } },
        { op: "add", record: { type: "CNAME", name: "one", value: "first.example.com" } },
        { op: "add", record: { type: "CNAME", name: "two", value: "second.example.com" } },
      ],
      { source: "editor", host: fake.host },
    );
    expect(failed.ok).toBe(false);
    expect(fake.records.map((r) => `${r.type} ${r.name} ${r.value}`).sort()).toEqual(["A  76.76.21.21", "MX  mx1.domeneshop.no"]);
  });

  it("undoes a change once, only while the zone is as it left it", async () => {
    const fake = fakeHost(zone());
    const applied = await dns.applyDnsChange(owner, storeId, apex, [{ op: "add", record: { type: "TXT", name: "", value: "google-site-verification=abc" } }], { source: "recipe", host: fake.host });
    if (!applied.ok) throw new Error(applied.problems.join());
    const undone = await dns.undoDnsChange(owner, storeId, applied.changeId, { host: fake.host });
    expect(undone.ok).toBe(true);
    expect(fake.records.some((r) => r.value.startsWith("google-site"))).toBe(false);
    expect(await dns.undoDnsChange(owner, storeId, applied.changeId, { host: fake.host })).toEqual({ ok: false, problems: ["That change was undone already."] });

    const second = await dns.applyDnsChange(owner, storeId, apex, [{ op: "add", record: { type: "TXT", name: "", value: "first" } }], { source: "editor", host: fake.host });
    if (!second.ok) throw new Error(second.problems.join());
    await dns.applyDnsChange(owner, storeId, apex, [{ op: "add", record: { type: "TXT", name: "", value: "later" } }], { source: "editor", host: fake.host });
    expect(await dns.undoDnsChange(owner, storeId, second.changeId, { host: fake.host })).toMatchObject({ ok: false });
  });

  it("keeps the history append-only", async () => {
    const [row] = await db().execute<Row>(sql`select id from commerce.dns_changes where store_id = ${storeId}::uuid limit 1`);
    await expect(db().execute(sql`delete from commerce.dns_changes where id = ${String(row.id)}::uuid`)).rejects.toThrow();
    await expect(db().execute(sql`update commerce.dns_changes set summary = 'x' where id = ${String(row.id)}::uuid`)).rejects.toThrow();
  });

  it("is off for automatic changes until the owner says so", async () => {
    expect(await dns.dnsAuto(storeId)).toBe(false);
    await dns.setDnsAuto(owner, storeId, true);
    expect(await dns.dnsAuto(storeId)).toBe(true);
  });
});
