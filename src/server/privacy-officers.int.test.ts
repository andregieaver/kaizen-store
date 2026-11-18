import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const officers = await import("./privacy-officers");
const { getStore } = await import("./stores");
const { legalFacts } = await import("./legal-facts");

/**
 * The data protection officer (D763): an account's for all its stores, a store's own instead, a person on the team read from their account,
 * someone else as written; one who leaves the team names nobody; the store's legal facts carry the officer only when one is named.
 */

const run = Date.now().toString(36);
let store: { id: string; slug: string; organisationId: string };
let ownerId: string;
let staffId: string;
let outsiderId: string;

beforeAll(async () => {
  const slug = `dpo-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Owner', 'Test') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Officer test', null)`);
  const s = (await getStore(slug))!;
  store = { id: s.id, slug, organisationId: s.organisationId! };
  const [owner] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${store.id}::uuid and role = 'owner'`);
  ownerId = String(owner.account_id);
  const [staff] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`dpo-staff-${run}@example.com`}, 'Siri Staff') returning id`);
  staffId = String(staff.id);
  await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${store.id}::uuid, ${staffId}::uuid, 'admin')`);
  const [outsider] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`dpo-out-${run}@example.com`}, 'Otto Outside') returning id`);
  outsiderId = String(outsider.id);
});

afterAll(async () => {
  await closeDb();
});

describe("the data protection officer (D763)", () => {
  it("names nobody until the account names someone, and the store follows its account", async () => {
    expect(await officers.officerForStore(store)).toEqual({ source: "none", officer: null });
    expect(await officers.setOfficer(ownerId, store.organisationId, null, { kind: "person", name: "Firm Ombud", email: "dpo@firm.example", phone: null, firm: "Firm AS" })).toEqual({ ok: true });
    expect(await officers.officerForStore(store)).toEqual({
      source: "account",
      officer: { name: "Firm Ombud", email: "dpo@firm.example", phone: null, firm: "Firm AS", staff: false },
    });
    expect(await officers.storedChoice(store.organisationId, store.id)).toEqual({ kind: "account" });
  });

  it("lets a store name a person on its team instead, read from their account, and go back to its account's", async () => {
    expect(await officers.setOfficer(ownerId, store.organisationId, store.id, { kind: "staff", accountId: staffId })).toEqual({ ok: true });
    expect(await officers.officerForStore(store)).toEqual({ source: "store", officer: { name: "Siri Staff", email: `dpo-staff-${run}@example.com`, phone: null, firm: null, staff: true } });
    await db().execute(sql`update commerce.accounts set name = 'Siri Staffsen' where id = ${staffId}::uuid`);
    expect((await officers.officerForStore(store)).officer?.name).toBe("Siri Staffsen");
    expect(await officers.setOfficer(ownerId, store.organisationId, store.id, { kind: "account" })).toEqual({ ok: true });
    expect((await officers.officerForStore(store)).source).toBe("account");
  });

  it("refuses someone who is not on the team, and names nobody once a chosen person leaves it", async () => {
    expect(await officers.setOfficer(ownerId, store.organisationId, store.id, { kind: "staff", accountId: outsiderId })).toEqual({
      ok: false,
      problems: ["Choose someone on the team, or write in someone else."],
    });
    expect((await officers.officerCandidates(store.organisationId, store.id)).map((p) => p.accountId)).toContain(staffId);
    await officers.setOfficer(ownerId, store.organisationId, store.id, { kind: "staff", accountId: staffId });
    await db().execute(sql`delete from commerce.store_members where store_id = ${store.id}::uuid and account_id = ${staffId}::uuid`);
    // Their row names nobody now, so the store falls back to its account's officer.
    expect(await officers.officerForStore(store)).toEqual({ source: "account", officer: expect.objectContaining({ email: "dpo@firm.example" }) });
  });

  it("puts the officer in the store's legal facts only when one is named", async () => {
    const s = (await getStore(store.slug))!;
    expect((await legalFacts(s)).privacyOfficer).toEqual({ name: "Firm Ombud", email: "dpo@firm.example" });
    await officers.setOfficer(ownerId, store.organisationId, null, { kind: "none" });
    await officers.setOfficer(ownerId, store.organisationId, store.id, { kind: "account" });
    expect("privacyOfficer" in (await legalFacts(s))).toBe(false);
  });

  it("keeps the rule that a row names someone, and finds the account a person owns", async () => {
    await expect(db().execute(sql`insert into commerce.privacy_officers (organisation_id) values (${store.organisationId}::uuid)`)).rejects.toThrow();
    expect((await officers.ownedAccount(ownerId))?.id).toBe(store.organisationId);
    expect(await officers.ownedAccount(staffId)).toBeNull();
  });
});
