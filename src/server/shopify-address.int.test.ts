import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { encryptSecret, parseKey } from "@/lib/secret-box";

import type { Membership } from "./auth";
import { membersOf } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";
import type { DomainServices } from "./vercel";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.SHOPIFY_CLIENT_ID = "kaizentestclient0001";
process.env.SHOPIFY_CLIENT_SECRET = "shpss_test_secret_for_kaizen";

const address = await import("./shopify-address");

type Row = Record<string, unknown>;

/**
 * Move day's address (D445 step 7b) against a stand-in DNS and Vercel: the Shopify shop's own address and its `www.` pair are added through
 * the domains page's own writer, wait for their records, and work once the records are there, Shopify's primary becoming the store's
 * address. Where the DNS is kept is read from the nameservers; nothing on Shopify is touched.
 */

let fx: Fixture;
let owner: Membership;
const run = Date.now().toString(36);
const apex = `kopibutikk-${run}.no`;

function fakeServices() {
  const txt = new Map<string, string[]>();
  const pointed = new Set<string>();
  const onProject = new Set<string>();
  const found = () => ({ verified: true, verification: [], apexName: apex });
  const services: DomainServices = {
    add: async (hostname) => (onProject.add(hostname), found()),
    get: async (hostname) => (onProject.has(hostname) ? found() : null),
    verify: async () => found(),
    config: async (hostname) => ({ misconfigured: !pointed.has(hostname), aValues: ["76.76.21.21"], cname: "cname.vercel-dns.com" }),
    remove: async (hostname) => void onProject.delete(hostname),
    deploy: async () => undefined,
    txt: async (name) => txt.get(name) ?? [],
  };
  return { services, txt, pointed };
}

const fake = fakeServices();
const dns = {
  ns: async () => ["ns1.shopify.com", "ns2.shopify.com"],
  points: async (name: string) => (fake.pointed.has(name) ? { a: ["76.76.21.21"], cname: null } : { a: ["23.227.38.65"], cname: null }),
};
const deps = { dns, services: fake.services, configured: true, connect: async () => null };

beforeAll(async () => {
  fx = await makeStore("shopify-address");
  ({ owner } = await membersOf(fx));
  const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
  await db().execute(sql`
    insert into commerce.shop_moves (store_id, source, shop_domain, shop_name, primary_domain, status, scopes, access_token, connected_by, connected_at)
    values (${fx.storeId}::uuid, 'shopify', 'kopibutikk.myshopify.com', 'Kopibutikk', ${`www.${apex}`}, 'connected', 'read_products', ${encryptSecret("shpca_x", key)}, ${owner.account.id}::uuid, now())
  `);
  // The store starts with no domain of its own.
  await db().execute(sql`delete from commerce.store_domains where store_id = ${fx.storeId}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

describe("pointing the Shopify address here", () => {
  it("says where the DNS is kept and that both names still lead to Shopify", async () => {
    const view = (await address.addressView(owner, deps))!;
    expect([view.primary, view.apex, view.dnsHost, view.done]).toEqual([`www.${apex}`, apex, "shopify", false]);
    expect(view.hosts.map((h) => [h.hostname, h.status, h.atShopify])).toEqual([
      [`www.${apex}`, "not_added", true],
      [apex, "not_added", true],
    ]);
  });

  it("adds both names through the domains page's writer, shows their records, and has them work once the records are there", async () => {
    const started = await address.startAddress(owner, deps);
    expect(started).toEqual({ ok: true });
    const rows = await db().execute<Row>(sql`select hostname, status from commerce.store_domains where store_id = ${fx.storeId}::uuid order by hostname`);
    expect(rows.map((r) => [r.hostname, r.status])).toEqual([
      [apex, "pending"],
      [`www.${apex}`, "pending"],
    ]);
    const waiting = (await address.addressView(owner, deps))!;
    const www = waiting.hosts.find((h) => h.hostname === `www.${apex}`)!;
    expect(www.status).toBe("waiting");
    expect(www.records.map((r) => r.type)).toEqual(["TXT", "CNAME"]);
    expect(waiting.hosts.find((h) => h.hostname === apex)!.records.map((r) => r.type)).toEqual(["TXT", "A"]);
    // Pressing again changes nothing.
    expect(await address.startAddress(owner, deps)).toEqual({ ok: true });
    expect(await address.checkAddress(owner, deps)).toEqual({ done: false });

    // The owner makes the records at Shopify's DNS.
    for (const h of waiting.hosts) {
      const proof = h.records.find((r) => r.type === "TXT")!;
      fake.txt.set(proof.name, [proof.value]);
      fake.pointed.add(h.hostname);
    }
    expect(await address.checkAddress(owner, deps)).toEqual({ done: true });
    const after = await db().execute<Row>(sql`select hostname, status, is_primary from commerce.store_domains where store_id = ${fx.storeId}::uuid order by hostname`);
    // Shopify's own primary is the store's address here.
    expect(after.map((r) => [r.hostname, r.status, r.is_primary])).toEqual([
      [apex, "active", false],
      [`www.${apex}`, "active", true],
    ]);
    const done = (await address.addressView(owner, deps))!;
    expect(done.done).toBe(true);
    expect(done.hosts.every((h) => !h.atShopify)).toBe(true);
  });

  it("has nothing to point for a shop with only its myshopify.com address, and is the owner's alone", async () => {
    await db().execute(sql`update commerce.shop_moves set primary_domain = null where store_id = ${fx.storeId}::uuid`);
    expect(await address.addressView(owner, deps)).toMatchObject({ primary: null, hosts: [], done: true });
    expect(await address.startAddress(owner, deps)).toEqual({ ok: false, problems: [] });
    const { admin } = await membersOf(fx);
    expect(await address.addressView(admin, deps)).toBeNull();
    expect(await address.startAddress(admin, deps)).toMatchObject({ ok: false });
  });
});
