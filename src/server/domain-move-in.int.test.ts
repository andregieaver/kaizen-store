import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { recordKey, type DnsRecord, type DnsRecordInput } from "@/lib/dns-records";
import type { Answer } from "@/lib/domain-move";

import type { Account } from "./auth";
import type { PublicDns } from "./domain-health";
import type { MoveInDeps } from "./domain-move-in";
import type { DnsHostApi } from "./vercel-dns";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const moveIn = await import("./domain-move-in");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const apex = `movein-${run}.com`;

/** The current provider's records, answered as its nameservers would. */
const elsewhere: DnsRecordInput[] = [
  { type: "A", name: "", value: "203.0.113.10" },
  { type: "MX", name: "", value: "mx.provider.example", mxPriority: 10 },
  { type: "TXT", name: "", value: "v=spf1 include:provider.example ~all" },
  { type: "CNAME", name: "selector1._domainkey", value: "dkim.provider.example" },
];

const answerFrom =
  (records: () => DnsRecordInput[]) =>
  async (_ns: readonly string[], _apex: string, questions: readonly { name: string; type: string }[]): Promise<Answer[]> =>
    questions.map((q) => ({ ...q, records: records().filter((r) => r.name === q.name && (r.type === q.type || (q.type === "A" && r.type === "ALIAS"))) }));

/** Vercel's DNS in memory; its nameservers answer what the zone holds. */
function fakeHost() {
  let n = 0;
  const records: DnsRecord[] = [];
  const removed: string[] = [];
  const host: DnsHostApi = {
    zone: async () => null,
    addZone: async () => ({ serviceType: "zeit.world", nameservers: [], intendedNameservers: ["ns1.vercel-dns.com", "ns2.vercel-dns.com"], verified: true }),
    removeZone: async (a) => void removed.push(a),
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
  return { host, records, removed };
}

let nameservers = ["ns1.provider.example", "ns2.provider.example"];
const dns: PublicDns = { mx: async () => [], txt: async () => [], caa: async () => [], ns: async () => nameservers };

let owner: Account;
let storeId: string;

beforeAll(async () => {
  const [acc] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`movein-${run}@example.com`}, 'Kari Nordmann', false) returning id, email`);
  owner = { id: String(acc.id), email: String(acc.email), name: "Kari Nordmann", platformAdmin: false } as Account;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${owner.email}, 'Owner', ${`movein-${run}`}) returning id`);
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`movein-${run}`}, ${`movein-${run}`}, null) as id`);
  storeId = String(id);
  await db().execute(sql`insert into commerce.store_domains (store_id, hostname, token, status) values (${storeId}::uuid, ${apex}, ${`t-${run}`}, 'active')`);
});

afterAll(async () => {
  await closeDb();
});

describe("moving a domain's DNS here (D315 5.4)", () => {
  it("only for a domain the store has shown is its own", async () => {
    const result = await moveIn.lookBeforeMoveIn(storeId, `stranger-${run}.com`, null, { dns, ask: answerFrom(() => elsewhere), rdap: async () => null });
    expect(result.ok).toBe(false);
  });

  it("finds the records by asking, adds the zone file's, and keeps the store's own pointing records for itself", async () => {
    const file = `$ORIGIN ${apex}.\n@ 3600 IN TXT "google-site-verification=abc"\nold 3600 IN A 192.0.2.9\n`;
    const result = await moveIn.lookBeforeMoveIn(storeId, apex, file, { dns, ask: answerFrom(() => elsewhere), rdap: async () => ({ registrar: "Example Registrar", expiresAt: null }) });
    if (!result.ok) throw new Error(result.problems.join());
    const { look } = result;
    expect(look.registrar).toBe("Example Registrar");
    expect(look.kept.map((r) => `${r.type} ${r.name}`)).toEqual(["A "]);
    expect(look.found.map((f) => `${f.record.type} ${f.record.name || "@"} ${f.from} ${f.live}`).sort()).toEqual(
      [
        "A old file null",
        "CNAME selector1._domainkey probe true",
        "MX @ probe true",
        "TXT @ file false",
        "TXT @ probe true",
      ].sort(),
    );
  });

  it("copies them into a zone here with the store's own, checks them at Vercel's nameservers, and arrives when the nameservers change", async () => {
    const fake = fakeHost();
    // The current provider for the look; Vercel's (the fake zone) for the check after copying.
    const deps: MoveInDeps = {
      dns,
      host: fake.host,
      rdap: async () => null,
      ask: async (ns, a, questions) => (ns[0]?.includes("vercel") ? answerFrom(() => fake.records)(ns, a, questions) : answerFrom(() => elsewhere)(ns, a, questions)),
    };
    const started = await moveIn.startMoveIn(owner, storeId, apex, { zoneText: null }, deps);
    if (!started.ok) throw new Error(started.problems.join());
    expect(started.nameservers).toEqual(["ns1.vercel-dns.com", "ns2.vercel-dns.com"]);
    expect(started.check).toMatchObject({ missing: [], unanswered: [] });
    const keys = fake.records.map((r) => recordKey(r));
    expect(keys).toContain(recordKey({ type: "A", name: "", value: "76.76.21.21" }));
    expect(keys).toContain(recordKey(elsewhere[1]));
    expect(keys).not.toContain(recordKey(elsewhere[0]));
    const [zone] = await db().execute<Row>(sql`select status, arrived_at from commerce.dns_zones where apex = ${apex} and status <> 'left'`);
    expect(zone).toMatchObject({ status: "active", arrived_at: null });
    expect(await moveIn.arrivingZones(storeId)).toHaveLength(1);
    // A second move of the same domain is refused: its DNS is here.
    expect((await moveIn.lookBeforeMoveIn(storeId, apex, null, deps)).ok).toBe(false);

    expect(await moveIn.checkArrivals({ storeId }, { dns })).toEqual([]);
    nameservers = ["ns1.vercel-dns.com", "ns2.vercel-dns.com"];
    expect(await moveIn.checkArrivals({ storeId }, { dns })).toEqual([apex]);
    expect(await moveIn.arrivingZones(storeId)).toHaveLength(0);
  });

  it("stops a move that hasn't arrived, taking the zone out of the team", async () => {
    nameservers = ["ns1.provider.example", "ns2.provider.example"];
    const other = `stop-${run}.com`;
    await db().execute(sql`insert into commerce.store_domains (store_id, hostname, token, status) values (${storeId}::uuid, ${other}, ${`s-${run}`}, 'active')`);
    const fake = fakeHost();
    const started = await moveIn.startMoveIn(owner, storeId, other, { zoneText: null }, { dns, host: fake.host, rdap: async () => null, ask: answerFrom(() => []) });
    expect(started.ok).toBe(true);
    expect(await moveIn.stopMoveIn(owner, storeId, other, { host: fake.host })).toEqual({ ok: true });
    expect(fake.removed).toEqual([other]);
    const [zone] = await db().execute<Row>(sql`select status from commerce.dns_zones where apex = ${other}`);
    expect(zone.status).toBe("left");
  });
});
