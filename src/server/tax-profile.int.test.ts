import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { TaxProfileForm } from "@/lib/tax-profile";
import { VIES_LIMIT_OWNER_PER_HOUR } from "@/lib/vies";

import type { Membership } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * A store's tax profile (D157): saved by owners only, every field checked, a number's check kept and cleared with the number,
 * what the audit log says (never a number), what a copy of the store keeps (the choices, never the numbers), and what the
 * store checkup reports. VIES and the Norwegian register are faked here.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const { checkOwnVatNumber, getTaxProfile, saveTaxProfile, taxCheckupFindings, taxProfileView } = await import("./tax-profile");
const ownerTools = await import("./owner-tools");

const run = Date.now().toString(36);
const slug = `tax-${run}`;
let storeId: string;
let owner: Membership;
let admin: Membership;

const empty: TaxProfileForm = {
  vatRegistered: false, vatNumber: "", dispatchCountry: "", ossScheme: "none", ossMemberState: "", ossNumber: "", ossRegisteredOn: "",
  iossNumber: "", iossIntermediary: "", iossMarkets: [], iossRegisteredOn: "",
};
const swedish: TaxProfileForm = { ...empty, vatRegistered: true, vatNumber: "SE 5566-7788-9901" };

const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const asFetch = (impl: (url: unknown, init?: RequestInit) => Promise<Response>) => vi.fn(impl) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

async function member(role: "owner" | "admin"): Promise<Membership> {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`${role}-${slug}@example.com`}, ${role}) returning id`);
  return {
    account: { id: String(account.id), email: `${role}-${slug}@example.com`, name: role, platformAdmin: false },
    role,
    // Sell to businesses on (D178), as the store row says.
    store: { id: storeId, slug, markets: [], features: ["shop", "business"] } as unknown as Store,
  };
}

const auditOf = async (action: string) =>
  db().execute<Row>(sql`select details, account_id from commerce.audit_log where store_id = ${storeId}::uuid and action = ${action} order by created_at`);

beforeAll(async () => {
  const [created] = await db().execute<Row>(sql`insert into commerce.stores (slug, name, country, features) values (${slug}, 'Tax test', 'SE', '{shop,business}') returning id`);
  storeId = String(created.id);
  owner = await member("owner");
  admin = await member("admin");
});

afterAll(async () => {
  await closeDb();
});

describe("saving the tax profile", () => {
  it("is the defaults until something is saved", async () => {
    const profile = await getTaxProfile(storeId);
    expect(profile).toMatchObject({ vatRegistered: false, vatNumber: null, ossScheme: "none", iossMarkets: [], dispatchCountry: null });
    expect(await taxCheckupFindings(storeId)).toEqual([]);
  });

  it("is saved by an owner, with the number normalised, and written to the audit log without the number", async () => {
    const saved = await saveTaxProfile(owner, swedish);
    expect(saved).toMatchObject({ ok: true, profile: { vatRegistered: true, vatNumber: "SE556677889901", vatNumberValid: null } });
    const [entry] = await auditOf("store.tax_profile_updated");
    expect(entry.account_id).toBe(owner.account.id);
    expect(JSON.stringify(entry.details)).not.toContain("556677889901");
    expect((entry.details as { fields: string[] }).fields).toEqual(expect.arrayContaining(["vatRegistered", "vatNumber"]));
  });

  it("is refused for an admin, who may only read it", async () => {
    expect(await saveTaxProfile(admin, { ...swedish, vatRegistered: false })).toEqual({ ok: false, errors: {}, problems: ["Only an owner can change the tax settings."] });
    expect((await getTaxProfile(storeId)).vatRegistered).toBe(true);
    expect(await checkOwnVatNumber(admin, { fetch: asFetch(async () => answer(200, { valid: true })) })).toEqual({ ok: false, problems: ["Only an owner can change the tax settings."] });
  });

  it("says what is wrong, field by field, and keeps what was saved", async () => {
    const refused = await saveTaxProfile(owner, {
      ...swedish,
      vatNumber: "DE123456789",
      iossNumber: "IM123",
      iossMarkets: ["NO", "DE"],
      ossScheme: "union",
      ossMemberState: "",
    });
    expect(refused).toMatchObject({
      ok: false,
      errors: {
        vatNumber: expect.stringContaining("own country"),
        iossNumber: expect.stringContaining("IM and ten digits"),
        iossMarkets: expect.stringContaining("EU countries only"),
        ossMemberState: expect.stringContaining("EU member state"),
      },
    });
    expect((await getTaxProfile(storeId)).vatNumber).toBe("SE556677889901");
  });

  it("holds OSS and IOSS: the scheme, the member state, the IOSS number, the intermediary, the markets and the dates", async () => {
    const form: TaxProfileForm = {
      ...swedish,
      dispatchCountry: "cn",
      ossScheme: "union",
      ossMemberState: "se",
      ossRegisteredOn: "2026-07-01",
      iossNumber: "im 246 000 0000",
      iossIntermediary: "Customs Agent AB",
      iossMarkets: ["DE", "DK", "DE"],
      iossRegisteredOn: "2026-07-01",
    };
    const saved = await saveTaxProfile(owner, form);
    expect(saved).toMatchObject({
      ok: true,
      profile: {
        dispatchCountry: "CN", ossScheme: "union", ossMemberState: "SE", ossRegisteredOn: "2026-07-01", iossNumber: "IM2460000000",
        iossIntermediary: "Customs Agent AB", iossMarkets: ["DE", "DK"], iossRegisteredOn: "2026-07-01",
      },
    });
    // Choosing no OSS scheme clears what belonged to it.
    expect(await saveTaxProfile(owner, { ...form, ossScheme: "none" })).toMatchObject({ ok: true, profile: { ossScheme: "none", ossMemberState: null, ossRegisteredOn: null } });
  });

  it("is refused by the database too when it is written round the application", async () => {
    await expect(db().execute(sql`update commerce.store_tax_profile set vat_number = 'DE123456789' where store_id = ${storeId}::uuid`)).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/tax_profile_vat_prefix/) },
    });
    await expect(db().execute(sql`update commerce.store_tax_profile set ioss_markets = array['NO'] where store_id = ${storeId}::uuid`)).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/tax_profile_ioss_markets/) },
    });
    await expect(db().execute(sql`update commerce.store_tax_profile set vat_number_valid = true where store_id = ${storeId}::uuid`)).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/tax_profile_check/) },
    });
  });
});

describe("checking the store's own number", () => {
  it("asks VIES, keeps the answer on the profile and the log, and audits the outcome without the number", async () => {
    const fetcher = asFetch(async () => answer(200, { valid: true, name: "ACME AB", address: "STOCKHOLM", requestIdentifier: "---" }));
    const checked = await checkOwnVatNumber(owner, { fetch: fetcher });
    expect(checked).toMatchObject({ ok: true, check: { status: "valid", purpose: "seller", source: "vies", name: "ACME AB" }, profile: { vatNumberValid: true } });
    // The seller's own number is not sent as the requester: a store's check carries no consultation number of its own.
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toEqual({ countryCode: "SE", vatNumber: "556677889901" });
    const profile = await getTaxProfile(storeId);
    expect(profile.vatNumberCheckId).not.toBeNull();
    expect(profile.vatNumberCheckedAt).not.toBeNull();
    const [entry] = (await auditOf("store.tax_number_checked")).slice(-1);
    expect(entry.details).toEqual({ status: "valid", source: "vies", error: null });
    // Goods sent from China are an import, so reverse charge is off for goods (the same number keeps its check) ...
    await saveTaxProfile(owner, { ...swedish, dispatchCountry: "CN" });
    expect((await taxProfileView(storeId)).readiness.find((line) => line.key === "reverse_charge")).toMatchObject({ on: false, text: expect.stringContaining("goods sent from an EU country") });
    // ... and with the goods sent from the store's own country (the same number keeps its check) it is on.
    await saveTaxProfile(owner, { ...swedish, dispatchCountry: "" });
    const view = await taxProfileView(storeId);
    expect(view.check).toMatchObject({ status: "valid", name: "ACME AB" });
    expect(view.readiness.find((line) => line.key === "reverse_charge")).toMatchObject({ on: true });
  });

  it("keeps a number that is not valid as such, and one that could not be checked as unknown, never valid", async () => {
    expect(await checkOwnVatNumber(owner, { fetch: asFetch(async () => answer(200, { valid: false })) })).toMatchObject({ ok: true, check: { status: "invalid" }, profile: { vatNumberValid: false } });
    const down = await checkOwnVatNumber(owner, { fetch: asFetch(async () => answer(503, "down")) });
    expect(down).toMatchObject({ ok: true, check: { status: "unavailable", error: "http_503" }, profile: { vatNumberValid: null } });
    expect((await taxProfileView(storeId)).readiness.find((line) => line.key === "reverse_charge")).toMatchObject({ on: false });
    expect((await taxCheckupFindings(storeId)).map((f) => f.code)).toContain("vat_number_not_valid");
  });

  it("is cleared when the number is changed, and a check needs a number", async () => {
    await checkOwnVatNumber(owner, { fetch: asFetch(async () => answer(200, { valid: true })) });
    expect((await getTaxProfile(storeId)).vatNumberValid).toBe(true);
    // The same number saved again keeps its check.
    await saveTaxProfile(owner, swedish);
    expect((await getTaxProfile(storeId)).vatNumberValid).toBe(true);
    await saveTaxProfile(owner, { ...swedish, vatNumber: "SE556677889902" });
    expect(await getTaxProfile(storeId)).toMatchObject({ vatNumber: "SE556677889902", vatNumberValid: null, vatNumberCheckId: null, vatNumberCheckedAt: null });
    await saveTaxProfile(owner, { ...swedish, vatNumber: "" });
    expect(await checkOwnVatNumber(owner, { fetch: asFetch(async () => answer(200, { valid: true })) })).toEqual({ ok: false, problems: ["Save the store's VAT number first."] });
    await saveTaxProfile(owner, swedish);
  });

  it("asks the open register for a Norwegian number, with no call to VIES", async () => {
    const [norwegian] = await db().execute<Row>(sql`insert into commerce.stores (slug, name, country) values (${`${slug}-no`}, 'Norsk', 'NO') returning id`);
    const nid = String(norwegian.id);
    const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`no-${slug}@example.com`}, 'Eier') returning id`);
    const no: Membership = { account: { id: String(account.id), email: "x", name: "Eier", platformAdmin: false }, role: "owner", store: { id: nid, slug: `${slug}-no`, markets: [] } as unknown as Store };
    expect(await saveTaxProfile(no, { ...empty, vatRegistered: true, vatNumber: "923 609 017" })).toMatchObject({ ok: false, errors: { vatNumber: expect.stringContaining("Norwegian") } });
    expect(await saveTaxProfile(no, { ...empty, vatRegistered: true, vatNumber: "923 609 016" })).toMatchObject({ ok: true, profile: { vatNumber: "NO923609016MVA" } });
    const vies = asFetch(async () => answer(200, { valid: true }));
    const brreg = vi.fn(async () => ({ ok: true as const, company: { organisationNumber: "923609016", legalName: "EQUINOR ASA", name: "Equinor ASA", organisationForm: "ASA", organisationFormName: null, address: { line1: "Forusbeen 50", line2: "", postalCode: "4035", city: "Stavanger" }, vatRegistered: true, vatNumber: "NO923609016MVA", locale: "nb" as const, website: null, warnings: [] } }));
    const checked = await checkOwnVatNumber(no, { fetch: vies, brreg });
    expect(checked).toMatchObject({ ok: true, check: { status: "valid", source: "brreg", name: "EQUINOR ASA", address: "Forusbeen 50, 4035, Stavanger" }, profile: { vatNumberValid: true } });
    expect(brreg).toHaveBeenCalledWith("NO923609016MVA");
    expect(vies).not.toHaveBeenCalled();
    // A company outside the VAT register is not valid; a register that cannot be reached is unknown.
    expect(await checkOwnVatNumber(no, { brreg: async () => ({ ok: true, company: { ...(await brreg()).company, vatRegistered: false } }) })).toMatchObject({ check: { status: "invalid" }, profile: { vatNumberValid: false } });
    expect(await checkOwnVatNumber(no, { brreg: async () => ({ ok: false, reason: "unavailable" }) })).toMatchObject({ check: { status: "unavailable", error: "brreg_unavailable" }, profile: { vatNumberValid: null } });
  });

  it("is limited for the owner's own checks, in a count of their own: over the limit the answer is unavailable", async () => {
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count)
      values (${storeId}::uuid, 'vies:o', date_trunc('hour', now()), ${VIES_LIMIT_OWNER_PER_HOUR})
      on conflict (store_id, bucket, "window") do update set count = ${VIES_LIMIT_OWNER_PER_HOUR}
    `);
    try {
      const fetcher = asFetch(async () => answer(200, { valid: true }));
      expect(await checkOwnVatNumber(owner, { fetch: fetcher })).toMatchObject({ ok: true, check: { status: "unavailable", error: "limit" } });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await db().execute(sql`delete from commerce.chat_usage where store_id = ${storeId}::uuid and bucket like 'vies:%'`);
    }
  });

  it("is not stopped by shoppers using up the store's limit", async () => {
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count)
      values (${storeId}::uuid, 'vies:s', date_trunc('hour', now()), 500)
      on conflict (store_id, bucket, "window") do update set count = 500
    `);
    try {
      const fetcher = asFetch(async () => answer(200, { valid: true }));
      expect(await checkOwnVatNumber(owner, { fetch: fetcher })).toMatchObject({ ok: true, check: { status: "valid" } });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      await db().execute(sql`delete from commerce.chat_usage where store_id = ${storeId}::uuid and bucket like 'vies:%'`);
    }
  });
});

describe("what the store checkup says", () => {
  it("reports a profile that is half filled in, and nothing for one that is whole", async () => {
    await saveTaxProfile(owner, { ...empty, vatRegistered: true, iossMarkets: ["DE"], ossScheme: "non_union" });
    expect((await taxCheckupFindings(storeId)).map((f) => f.code).sort()).toEqual(["ioss_markets_without_number", "oss_incomplete", "vat_registered_without_number"]);
    await saveTaxProfile(owner, empty);
    expect(await taxCheckupFindings(storeId)).toEqual([]);
  });
});

describe("copying a store", () => {
  it("keeps the tax choices and never the numbers, and makes a store from the template with none", async () => {
    await saveTaxProfile(owner, {
      ...swedish,
      dispatchCountry: "CN",
      ossScheme: "union",
      ossMemberState: "SE",
      ossRegisteredOn: "2026-07-01",
      iossNumber: "IM2460000000",
      iossIntermediary: "Agent AB",
      iossMarkets: ["DE"],
      iossRegisteredOn: "2026-07-01",
    });
    await checkOwnVatNumber(owner, { fetch: asFetch(async () => answer(200, { valid: true })) });
    const [made] = await db().execute<Row>(sql`
      select commerce.duplicate_store(${storeId}::uuid, ${`${slug}-copy`}, 'Copy', ${owner.account.id}::uuid, '{}'::uuid[], '{}'::uuid[], '{}'::uuid[]) as id
    `);
    const copy = await getTaxProfile(String(made.id));
    expect(copy).toMatchObject({
      vatRegistered: true, ossScheme: "union", ossMemberState: "SE", dispatchCountry: "CN", iossMarkets: ["DE"],
      vatNumber: null, vatNumberValid: null, vatNumberCheckId: null, vatNumberCheckedAt: null, ossNumber: null, ossRegisteredOn: null,
      iossNumber: null, iossIntermediary: null, iossRegisteredOn: null,
    });
    const [none] = await db().execute<Row>(sql`select count(*)::int as n from commerce.vat_checks where store_id = ${String(made.id)}::uuid`);
    expect(Number(none.n)).toBe(0);
    // The source keeps its own.
    expect((await getTaxProfile(storeId)).vatNumber).toBe("SE556677889901");
  });
});

describe("the AI manager reads the tax profile, and cannot change it", () => {
  const run = (name: string) => ownerTools.runOwnerTool({ account: owner.account, store: owner.store, invalidate: () => {} }, name, {}) as Promise<Record<string, unknown>>;

  it("answers from the saved profile and says what each VAT feature needs", async () => {
    await saveTaxProfile(owner, swedish);
    await checkOwnVatNumber(owner, { fetch: asFetch(async () => answer(200, { valid: true })) });
    const profile = await run("get_tax_profile");
    expect(profile).toMatchObject({
      store_country: "SE",
      registered_for_vat: true,
      vat_number: "SE556677889901",
      vat_number_checked: "valid",
      checked_with: "VIES",
      page: `/admin/${slug}/settings/tax`,
    });
    const readiness = (await run("tax_readiness")) as { features: { feature: string; on: boolean; needs: string[] }[] };
    expect(readiness.features.find((f) => f.feature === "reverse_charge")).toMatchObject({ on: true, needs: [] });
    expect(readiness.features.find((f) => f.feature === "ioss")).toMatchObject({ on: false });
    // Without Sell to businesses (D178), reverse charge is not one of the store's VAT features.
    const consumersOnly = (await ownerTools.runOwnerTool({ account: owner.account, store: { ...owner.store, features: ["shop"] }, invalidate: () => {} }, "tax_readiness", {})) as {
      features: { feature: string }[];
    };
    expect(consumersOnly.features.map((f) => f.feature)).not.toContain("reverse_charge");
    expect(consumersOnly.features.map((f) => f.feature)).toContain("ioss");
  });

  it("has no tool that changes a VAT number, a registration or a rate", async () => {
    const { OWNER_TOOLS } = await import("@/lib/owner-tools");
    const taxTools = OWNER_TOOLS.filter((t) => /tax|vat|ioss|oss/.test(t.name)).map((t) => [t.name, t.gate ?? null]);
    // The two report tools of D161 only read (ungated, analytics:read); nothing here writes a number, a registration or a rate.
    expect(taxTools).toEqual([["get_tax_profile", null], ["tax_readiness", null], ["vat_report", null], ["oss_return_data", null]]);
  });
});
