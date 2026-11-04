import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

import {
  checkTripletexSettings,
  connectTripletex,
  disconnectTripletex,
  getTripletexConnection,
  pauseTripletex,
  saveTripletexSettings,
  startTripletex,
  tripletexCounts,
  tripletexCredential,
} from "./tripletex";
import { fakeTripletex, type FakeTripletex } from "./tripletex-test-support";

type Row = Record<string, unknown>;

/** Made-up tokens, put together here so secret scanners do not take them for real ones. */
const token = (label: string) => ["test-tlxr", `eyJhbGciOiJIUzI1NiJ9.${label}.signature0123456789`].join("_");
const EMPLOYEE = ["eyJ0b2tlbklkIjo0Miwi", "dG9rZW4iOiJhYmMifQ=="].join("");

let accountId: string;

beforeAll(async () => {
  const tag = randomBytes(4).toString("hex");
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`tx-${tag}@example.com`}, 'Owner') returning id`);
  accountId = String(account.id);
});

async function makeStore(org: string | null = "912345678"): Promise<{ id: string; organisationNumber: string | null }> {
  const slug = `tx-${randomBytes(5).toString("hex")}`;
  const [store] = await db().execute<Row>(sql`
    insert into commerce.stores (slug, name, created_by, organisation_number) values (${slug}, ${slug}, ${accountId}::uuid, ${org}) returning id
  `);
  return { id: String(store.id), organisationNumber: org };
}

function company(id: number): FakeTripletex {
  const tx = fakeTripletex({ companyId: id });
  tx.apiTokens.add(token(String(id)));
  return tx;
}

describe("connecting a store to Tripletex with one paste (D453)", () => {
  it("reads the company, plans the books from its chart and keeps the token encrypted, showing only its hint", async () => {
    const store = await makeStore();
    const tx = company(7001);
    const result = await connectTripletex(accountId, store, `  ${token("7001")}\n`, { fetch: tx.fetch });
    expect(result).toMatchObject({ ok: true, company: { id: 7001, name: "Human Web AS" }, sameOrganisation: true, questions: [] });
    if (!result.ok) return;
    expect(result.plan.bookings.standard_25).toEqual({ account: 3000, vatCode: "3" });

    const connection = await getTripletexConnection(store.id);
    expect(connection).toMatchObject({ mode: "test", tokenKind: "api_token", state: "setup", syncFrom: null, company: { id: 7001 } });
    expect(connection?.tokenHint).toBe("test-tlxr_…6789");
    expect(connection?.settings?.receivableAccount).toBe(1500);

    const [kept] = await db().execute<Row>(sql`select token_encrypted from commerce.tripletex_connections where store_id = ${store.id}::uuid`);
    expect(String(kept.token_encrypted)).toMatch(/^v2\./);
    expect(String(kept.token_encrypted)).not.toContain("tlxr");
    expect(await tripletexCredential(store.id)).toEqual({ kind: "api_token", mode: "test", token: token("7001") });

    const [entry] = await db().execute<Row>(sql`select action, details::text as details from commerce.audit_log where store_id = ${store.id}::uuid order by created_at desc limit 1`);
    expect(entry.action).toBe("integration.tripletex_connected");
    expect(String(entry.details)).not.toContain("tlxr");
    // Only reads went to Tripletex.
    expect(tx.calls.every((c) => c.method === "GET" || c.path.startsWith("/token/"))).toBe(true);
  });

  it("says plainly what is wrong with the paste, and keeps nothing", async () => {
    const store = await makeStore();
    const tx = company(7002);
    expect(await connectTripletex(accountId, store, "   ", { fetch: tx.fetch })).toEqual({ ok: false, message: "Paste the token you copied in Tripletex." });
    expect(await connectTripletex(accountId, store, "hello", { fetch: tx.fetch })).toMatchObject({ ok: false, message: expect.stringMatching(/does not look like a Tripletex token/) });
    expect(await connectTripletex(accountId, store, token("wrong"), { fetch: tx.fetch })).toMatchObject({ ok: false, message: expect.stringMatching(/did not accept the token/) });
    expect(await getTripletexConnection(store.id)).toBeNull();
  });

  it("finds a test company's token without the test prefix in Tripletex's test environment", async () => {
    const store = await makeStore();
    const tx = fakeTripletex({ companyId: 7003 });
    const plain = ["tlxr", "eyJhbGciOiJIUzI1NiJ9.e30.withoutprefix0123456789"].join("_");
    tx.apiTokens.add(plain);
    const hosts: string[] = [];
    const watching: typeof fetch = async (input, init) => {
      hosts.push(new URL(String(input)).host);
      if (new URL(String(input)).host === "tripletex.no") return new Response(JSON.stringify({ status: 401 }), { status: 401 });
      return tx.fetch(input, init);
    };
    expect(await connectTripletex(accountId, store, plain, { fetch: watching })).toMatchObject({ ok: true });
    expect(hosts.slice(0, 2)).toEqual(["tripletex.no", "api-test.tripletex.tech"]);
    expect((await getTripletexConnection(store.id))?.mode).toBe("test");
  });

  it("says when an employee token needs Kaizena Flow's approval from Tripletex, and connects one once it is there", async () => {
    const store = await makeStore();
    const tx = fakeTripletex({ companyId: 7004 });
    tx.employeeTokens.add(EMPLOYEE);
    tx.consumerTokens.add("consumer-token-0123456789");
    expect(await connectTripletex(accountId, store, EMPLOYEE, { fetch: tx.fetch, consumerToken: () => null })).toMatchObject({ ok: false, message: expect.stringMatching(/Company → API tokens/) });
    const result = await connectTripletex(accountId, store, EMPLOYEE, { fetch: tx.fetch, consumerToken: () => "consumer-token-0123456789" });
    expect(result).toMatchObject({ ok: true });
    expect((await getTripletexConnection(store.id))?.tokenKind).toBe("employee_token");
  });

  it("warns when the company is not the store's own, and never lets one company serve two stores", async () => {
    const mine = await makeStore("998877665");
    const tx = company(7005);
    expect(await connectTripletex(accountId, mine, token("7005"), { fetch: tx.fetch })).toMatchObject({ ok: true, sameOrganisation: false });
    const another = await makeStore();
    expect(await connectTripletex(accountId, another, token("7005"), { fetch: tx.fetch })).toMatchObject({ ok: false, message: expect.stringMatching(/already connected to another/) });
  });

  it("asks only about what the store's documents need", async () => {
    const store = await makeStore();
    const tx = company(7006);
    tx.accounts = tx.accounts.filter((a) => a.number !== 3100 && a.number !== 2900);
    const result = await connectTripletex(accountId, store, token("7006"), { fetch: tx.fetch });
    // No Work and no shop invoices yet: only sales at 25 % are needed, and those fit; exempt sales and gift cards are not asked about.
    expect(result.ok && result.questions).toEqual([]);
    expect(result.ok && result.plan.questions.map((q) => q.key).sort()).toEqual(["exempt", "gift_card"]);
  });

  it("says what Tripletex would refuse before anything is sent", async () => {
    const store = await makeStore();
    const tx = company(7007);
    await connectTripletex(accountId, store, token("7007"), { fetch: tx.fetch });
    const settings = (await getTripletexConnection(store.id))!.settings!;
    const wrong = { ...settings, bookings: { ...settings.bookings, standard_25: { account: 3100, vatCode: "3" } } };
    const check = await checkTripletexSettings(store.id, wrong, { fetch: tx.fetch });
    expect(check.ok && check.problems.map((p) => [p.key, p.problem])).toEqual([["standard_25", "vat_code_not_allowed"]]);
    expect(await saveTripletexSettings(accountId, store.id, wrong, check.ok ? check.problems : [])).toMatchObject({ ok: false });
    expect(await startTripletex(accountId, store.id, { problems: check.ok ? check.problems : [] })).toMatchObject({ ok: false });
    expect(await saveTripletexSettings(accountId, store.id, { ...settings, language: "en" }, [])).toEqual({ ok: true });
    expect((await getTripletexConnection(store.id))?.settings?.language).toBe("en");
  });

  it("starts from today, never in the future, and pauses", async () => {
    const store = await makeStore();
    const tx = company(7008);
    await connectTripletex(accountId, store, token("7008"), { fetch: tx.fetch });
    const now = new Date("2026-11-05T09:00:00Z");
    expect(await startTripletex(accountId, store.id, { syncFrom: "2026-11-06", now })).toMatchObject({ ok: false });
    expect(await startTripletex(accountId, store.id, { now })).toEqual({ ok: true, syncFrom: "2026-11-05" });
    expect((await getTripletexConnection(store.id))?.state).toBe("on");
    expect(await pauseTripletex(accountId, store.id)).toBe(true);
    expect((await getTripletexConnection(store.id))?.state).toBe("paused");
    expect(await startTripletex(accountId, store.id, { now })).toEqual({ ok: true, syncFrom: "2026-11-05" });
  });

  it("keeps the settings and the start day when a new token for the same company is pasted, and starts again for another company", async () => {
    const store = await makeStore();
    const first = company(7009);
    await connectTripletex(accountId, store, token("7009"), { fetch: first.fetch });
    await startTripletex(accountId, store.id, { now: new Date("2026-11-05T09:00:00Z") });
    await db().execute(sql`update commerce.tripletex_connections set state = 'auth_failed' where store_id = ${store.id}::uuid`);
    first.apiTokens.add(token("7009b"));
    await connectTripletex(accountId, store, token("7009b"), { fetch: first.fetch });
    expect(await getTripletexConnection(store.id)).toMatchObject({ state: "on", syncFrom: "2026-11-05", tokenHint: "test-tlxr_…6789" });

    const second = company(7010);
    await connectTripletex(accountId, store, token("7010"), { fetch: second.fetch });
    expect(await getTripletexConnection(store.id)).toMatchObject({ state: "setup", syncFrom: null, company: { id: 7010 } });
  });

  it("disconnects: the token is forgotten, what waited is skipped, and what was sent stays recorded", async () => {
    const store = await makeStore();
    const tx = company(7011);
    await connectTripletex(accountId, store, token("7011"), { fetch: tx.fetch });
    await db().execute(sql`
      insert into commerce.tripletex_sync (store_id, mode, company_id, kind, local_id, state, their_id, external_key, synced_at)
      values (${store.id}::uuid, 'test', 7011, 'work_invoice', 'a', 'synced', 5, 'kf/x/W-1', now()),
             (${store.id}::uuid, 'test', 7011, 'work_invoice', 'b', 'failed', null, null, null)
    `);
    expect(await tripletexCounts(store.id)).toMatchObject({ synced: 1, failed: 1, lastWeek: 1 });
    expect(await disconnectTripletex(accountId, store.id)).toBe(true);
    expect(await getTripletexConnection(store.id)).toBeNull();
    expect(await tripletexCredential(store.id)).toBeNull();
    const rows = await db().execute<Row>(sql`select local_id, state from commerce.tripletex_sync where store_id = ${store.id}::uuid order by local_id`);
    expect(rows.map((r) => [r.local_id, r.state])).toEqual([
      ["a", "synced"],
      ["b", "skipped"],
    ]);
    expect(await disconnectTripletex(accountId, store.id)).toBe(false);
  });
});
