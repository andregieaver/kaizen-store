import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { DnsRecord, DnsRecordInput } from "@/lib/dns-records";

import type { Account } from "./auth";
import type { DnsHostApi } from "./vercel-dns";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const sending = await import("./sending-domains");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const apex = `send-${run}.shop`;
const settings = { apiKey: "re_test", from: "butikk@kaizenaflow.com" };

/** Vercel's DNS kept in memory. */
function fakeHost(initial: DnsRecordInput[]) {
  let n = 0;
  const records: DnsRecord[] = initial.map((r) => ({ id: `rec_${(n += 1)}`, ttl: 3600, ...r }));
  const host: DnsHostApi = {
    zone: async () => ({ serviceType: "zeit.world", nameservers: [], intendedNameservers: [], verified: true }),
    addZone: async () => ({ serviceType: "zeit.world", nameservers: [], intendedNameservers: [], verified: true }),
    removeZone: async () => {},
    records: async () => records.map((r) => ({ ...r })),
    create: async (_apex, record) => {
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
  return { host, records };
}

/** Resend's domains API in memory: a domain verifies once `verifyAfter` reads have passed. */
function fakeResend(opts: { refuse?: number; verifyAfter?: number } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let reads = 0;
  const domain = (name: string, status: string) => ({
    id: "dom_1",
    name,
    status,
    region: "eu-west-1",
    records: [
      { record: "DKIM", name: "resend._domainkey", value: "p=KEY", type: "TXT", status },
      { record: "SPF", name: "send", type: "MX", value: "feedback-smtp.eu-west-1.amazonses.com", priority: 10, status },
      { record: "SPF", name: "send", type: "TXT", value: '"v=spf1 include:amazonses.com ~all"', status },
    ],
  });
  let name = "";
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace("https://api.resend.com", "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (opts.refuse) return json(opts.refuse, { name: "restricted_api_key", message: "This API key is restricted to only send emails" });
    if (method === "POST" && path === "/domains") {
      name = String((body as { name: string }).name);
      return json(201, domain(name, "not_started"));
    }
    if (method === "POST" && path.endsWith("/verify")) return json(200, { object: "domain", id: "dom_1" });
    if (method === "GET") {
      reads += 1;
      return json(200, domain(name, reads > (opts.verifyAfter ?? 0) ? "verified" : "pending"));
    }
    if (method === "DELETE") return json(200, { object: "domain", id: "dom_1", deleted: true });
    return json(404, { message: "not found" });
  }) as typeof fetch;
  return { fetcher, calls };
}

let owner: Account;
let storeId: string;
let otherStoreId: string;

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${owner.email}, 'Owner', ${slug}) returning id`);
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${slug}, null) as id`);
  return String(id);
}

beforeAll(async () => {
  const [acc] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`send-${run}@example.com`}, 'Kari Nordmann', false) returning id, email`);
  owner = { id: String(acc.id), email: String(acc.email), name: "Kari Nordmann", platformAdmin: false } as Account;
  storeId = await makeStore(`send-${run}`);
  otherStoreId = await makeStore(`send-other-${run}`);
  await db().execute(sql`insert into commerce.dns_zones (store_id, apex) values (${storeId}::uuid, ${apex})`);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.sending_domains where domain like ${`%${run}%`}`);
  await closeDb();
});

describe("a store's own sending domain (D727)", () => {
  it("adds the domain in Resend's EU region, writes its records into the zone we keep, and sends from it once verified", async () => {
    const dns = fakeHost([{ type: "MX", name: "", value: "aspmx.l.google.com", mxPriority: 1 }]);
    const resend = fakeResend({ verifyAfter: 0 });
    const added = await sending.addSendingDomain(owner, storeId, { domain: `https://www.${apex}/`, fromLocal: "Hello" }, { fetcher: resend.fetcher, settings, host: dns.host });
    if (!added.ok) throw new Error(added.problems.join());
    expect(resend.calls[0]).toEqual({ method: "POST", path: "/domains", body: { name: apex, region: "eu-west-1" } });
    expect(added.domain).toMatchObject({ domain: apex, from: `hello@${apex}`, status: "pending", recordsWritten: true });
    // Its records beside the store's own mail, which is untouched.
    expect(dns.records.map((r) => `${r.type} ${r.name} ${r.value}`).sort()).toEqual([
      "MX  aspmx.l.google.com",
      "MX send feedback-smtp.eu-west-1.amazonses.com",
      "TXT resend._domainkey p=KEY",
      "TXT send v=spf1 include:amazonses.com ~all",
    ]);
    // Pending: still the shared address.
    expect(await sending.senderFor(storeId)).toBeNull();

    const checked = await sending.checkSendingDomain(owner, storeId, { fetcher: resend.fetcher, settings, host: dns.host });
    if (!checked.ok) throw new Error(checked.problems.join());
    expect(checked.domain.status).toBe("verified");
    expect(checked.domain.verifiedAt).not.toBeNull();
    expect(await sending.senderFor(storeId)).toBe(`hello@${apex}`);
    // Another store is untouched.
    expect(await sending.senderFor(otherStoreId)).toBeNull();
    // Writing the records again changes nothing.
    expect(dns.records).toHaveLength(4);
  });

  it("keeps one domain a store, and goes back to the shared address when it is removed", async () => {
    const resend = fakeResend();
    const second = await sending.addSendingDomain(owner, storeId, { domain: `other-${run}.shop` }, { fetcher: resend.fetcher, settings });
    expect(second).toEqual({ ok: false, problems: ["This store already has a sending domain. Remove it first to use another."] });
    expect(resend.calls).toHaveLength(0);

    const changed = await sending.setFromLocal(owner, storeId, "butikk");
    expect(changed.ok && changed.domain.from).toBe(`butikk@${apex}`);
    expect(await sending.senderFor(storeId)).toBe(`butikk@${apex}`);

    expect(await sending.removeSendingDomain(owner, storeId, { fetcher: resend.fetcher, settings })).toEqual({ ok: true });
    expect(resend.calls.at(-1)).toMatchObject({ method: "DELETE", path: "/domains/dom_1" });
    expect(await sending.getSendingDomain(storeId)).toBeNull();
    expect(await sending.senderFor(storeId)).toBeNull();
    const [audit] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action like 'store.sending_domain_%'`);
    expect(Number(audit.n)).toBeGreaterThanOrEqual(4);
  });

  it("shows the records to copy when we don't keep the zone, and says plainly when the key can't add domains", async () => {
    const refused = await sending.addSendingDomain(owner, otherStoreId, { domain: `elsewhere-${run}.no` }, { fetcher: fakeResend({ refuse: 401 }).fetcher, settings });
    expect(refused).toEqual({ ok: false, problems: ["Kaizena Flow's email key can't add domains yet. A platform admin needs to give it full access in Resend."] });
    expect(await sending.getSendingDomain(otherStoreId)).toBeNull();

    const added = await sending.addSendingDomain(owner, otherStoreId, { domain: `elsewhere-${run}.no` }, { fetcher: fakeResend({ verifyAfter: 5 }).fetcher, settings });
    if (!added.ok) throw new Error(added.problems.join());
    expect(added.domain).toMatchObject({ status: "pending", recordsWritten: false, from: `news@elsewhere-${run}.no` });
    expect(added.domain.records.map((r) => r.host)).toEqual([`resend._domainkey.elsewhere-${run}.no`, `send.elsewhere-${run}.no`, `send.elsewhere-${run}.no`]);
  });

  it("is Kaizena Flow's own with no store, apart from every store's", async () => {
    const added = await sending.addSendingDomain(owner, null, { domain: `platform-${run}.com`, fromLocal: "hei" }, { fetcher: fakeResend().fetcher, settings });
    if (!added.ok) throw new Error(added.problems.join());
    expect(added.domain.storeId).toBeNull();
    expect((await sending.getSendingDomain(null))?.domain).toBe(`platform-${run}.com`);
    expect((await sending.getSendingDomain(otherStoreId))?.domain).toBe(`elsewhere-${run}.no`);
    await sending.removeSendingDomain(owner, null, { fetcher: fakeResend().fetcher, settings });
  });

  it("is checked again by the daily job, which never stops for one domain", async () => {
    const counts = await sending.recheckSendingDomains({ fetcher: fakeResend({ verifyAfter: 0 }).fetcher, settings });
    expect(counts.checked).toBeGreaterThanOrEqual(1);
    expect(counts.failed).toBe(0);
    expect((await sending.getSendingDomain(otherStoreId))?.status).toBe("verified");
  });

  it("refuses a domain or an address the database would not take", async () => {
    await expect(db().execute(sql`insert into commerce.sending_domains (store_id, domain) values (null, 'Not A Domain')`)).rejects.toThrow();
    await expect(db().execute(sql`insert into commerce.sending_domains (store_id, domain, status) values (null, ${`x-${run}.no`}, 'verified')`)).rejects.toThrow();
    await expect(db().execute(sql`insert into commerce.sending_domains (store_id, domain, from_local) values (null, ${`x-${run}.no`}, '.bad')`)).rejects.toThrow();
  });
});
