import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account, Membership } from "./auth";

type Row = Record<string, unknown>;

/**
 * The VAT screens' server actions (D157), as the forms call them: the tax settings are the owner's and a store's own, the platform's
 * VAT pages are a platform admin's, and the shopper's VAT number action sets nothing but the cart row (VIES is faked here).
 */

vi.mock("server-only", () => ({}));
const calls = vi.hoisted(() => ({ refreshed: 0, role: "owner" as "owner" | "admin", admin: true }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {
    calls.refreshed += 1;
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const people = vi.hoisted(() => ({ byStore: new Map<string, Account>(), platform: null as Account | null }));
vi.mock("@/server/auth", async (original) => {
  const real = await original<typeof import("./auth")>();
  const { getStore } = await import("./stores");
  return {
    ...real,
    requireMember: async (storeSlug: string): Promise<Membership> => {
      const account = people.byStore.get(storeSlug);
      if (!account) throw new Error("NEXT_NOT_FOUND");
      return { account, role: calls.role, store: (await getStore(storeSlug))! };
    },
    getMembership: async (storeSlug: string): Promise<Membership | null> => {
      const account = people.byStore.get(storeSlug);
      if (!account) return null;
      return { account, role: calls.role, store: (await getStore(storeSlug))! };
    },
    requirePlatformAdmin: async (): Promise<Account> => {
      if (!calls.admin || !people.platform) throw new Error("NEXT_NOT_FOUND");
      return people.platform;
    },
  };
});

const vies = vi.hoisted(() => ({ valid: true, calls: 0 }));
vi.stubGlobal("fetch", async () => {
  vies.calls += 1;
  return new Response(JSON.stringify({ valid: vies.valid, name: "KUNDE", address: "BERLIN", requestIdentifier: "WAPI1" }), { status: 200 });
});

const taxActions = await import("../app/admin/(gated)/[store]/settings/tax/actions");
const platformActions = await import("../app/admin/(gated)/platform/vat/actions");
const cartActions = await import("../app/s/[store]/[market]/cart/actions");
const { changeLine } = await import("./cart");

const run = Date.now().toString(36);
const idle = { status: "idle" as const, messages: [] };
const slug = `vatact-${run}`;
const otherSlug = `vatact-other-${run}`;
let storeId: string;

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  return data;
};

async function makeStore(name: string, country: string) {
  const email = `${name}@example.com`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Kari', ${name}) returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, ${name}, null) as id`);
  // Selling to businesses as well (D178: Sell to businesses on), so a cart can be a company's.
  await db().execute(sql`update commerce.stores set country = ${country}, audience = 'both', features = features || array['business'] where id = ${String(store.id)}::uuid`);
  const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${email}`);
  people.byStore.set(name, { id: String(row.id), email: String(row.email), name: "Kari", platformAdmin: false });
  return String(store.id);
}

beforeAll(async () => {
  storeId = await makeStore(slug, "SE");
  await makeStore(otherSlug, "SE");
  const [platform] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`pa-${run}@example.com`}, 'PA', true) returning id`);
  people.platform = { id: String(platform.id), email: `pa-${run}@example.com`, name: "PA", platformAdmin: true };
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

describe("the tax settings (D157)", () => {
  const fields = { vatRegistered: "on", vatNumber: "SE556677889901", dispatchCountry: "", ossScheme: "none", iossMarkets: [] as string[] };

  it("are saved by the owner of the store, and the screen says so", async () => {
    calls.role = "owner";
    const before = calls.refreshed;
    expect(await taxActions.saveTaxProfileAction(slug, idle, form(fields))).toEqual({ status: "ok", messages: ["Saved."] });
    expect(calls.refreshed).toBe(before + 1);
    const [row] = await db().execute<Row>(sql`select vat_registered, vat_number from commerce.store_tax_profile where store_id = ${storeId}::uuid`);
    expect(row).toEqual({ vat_registered: true, vat_number: "SE556677889901" });
  });

  it("are refused for an admin, and what is wrong is said", async () => {
    calls.role = "admin";
    expect(await taxActions.saveTaxProfileAction(slug, idle, form({ ...fields, vatRegistered: "" }))).toEqual({ status: "error", messages: ["You do not have access to this."] });
    calls.role = "owner";
    const refused = await taxActions.saveTaxProfileAction(slug, idle, form({ ...fields, iossNumber: "IM1", iossMarkets: ["NO"] }));
    expect(refused.status).toBe("error");
    expect(refused.messages.join(" ")).toContain("IM and ten digits");
    expect(refused.messages.join(" ")).toContain("EU countries only");
  });

  it("keep a store out of reach of a member of another: refused, nothing changed", async () => {
    expect(await taxActions.saveTaxProfileAction(`nobody-${run}`, idle, form(fields))).toEqual({ status: "error", messages: ["You do not have access to this."] });
    const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.store_tax_profile where store_id = (select id from commerce.stores where slug = ${otherSlug})`);
    expect(Number(row.n)).toBe(0);
  });

  it("check the store's own number, and say a number VIES could not be asked about is not taken as valid", async () => {
    vies.valid = true;
    expect(await taxActions.checkVatNumberAction(slug)).toEqual({ status: "ok", messages: ["The VAT number is registered."] });
    vies.valid = false;
    expect((await taxActions.checkVatNumberAction(slug)).messages[0]).toContain("does not know this VAT number");
    calls.role = "admin";
    expect((await taxActions.checkVatNumberAction(slug)).status).toBe("error");
    calls.role = "owner";
  });
});

describe("the platform's VAT pages (D157)", () => {
  const code = `act${run}`.slice(0, 20);

  it("are for a platform admin only", async () => {
    calls.admin = false;
    await expect(platformActions.addVatCategoryAction(idle, form({ code, nameEn: "x" }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(platformActions.setVatRateAction(idle, form({}))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(platformActions.setShippingVatRuleAction(idle, form({}))).rejects.toThrow("NEXT_NOT_FOUND");
    calls.admin = true;
  });

  it("add a category, set a rate from a date, verify it and keep a shipping rule, each audit-logged", async () => {
    expect(await platformActions.addVatCategoryAction(idle, form({ code, nameEn: "Action goods", description: "", sort: "910" }))).toMatchObject({ status: "ok" });
    expect(await platformActions.addVatCategoryAction(idle, form({ code, nameEn: "Again" }))).toMatchObject({ status: "error" });
    expect(await platformActions.setVatRateAction(idle, form({ country: "NO", category: code, ratePercent: "11", validFrom: "2026-01-01", source: "Kaizen test data", checkedOn: "2026-10-03", note: "" }))).toMatchObject({ status: "ok" });
    expect(await platformActions.setVatRateAction(idle, form({ country: "NO", category: code, ratePercent: "11", validFrom: "2026-01-01", source: "Kaizen test data", checkedOn: "2026-10-03" }))).toMatchObject({ status: "error" });
    expect(await platformActions.verifyVatRateAction("NO", code, "2026-01-01")).toMatchObject({ status: "ok" });
    expect(await platformActions.setVatCategoryActiveAction(code, false)).toMatchObject({ status: "ok" });
    expect(await platformActions.setVatCategoryActiveAction("standard", false)).toMatchObject({ status: "error" });
    expect(await platformActions.setShippingVatRuleAction(idle, form({ country: "MT", rule: "standard", source: "", checkedOn: "", note: "" }))).toMatchObject({ status: "ok" });
    const actions = await db().execute<Row>(sql`select action from commerce.audit_log where account_id = ${people.platform!.id}::uuid and action like 'vat.%' order by created_at`);
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(["vat.category_added", "vat.rate_set", "vat.rate_verified", "vat.category_active", "vat.shipping_rule_set"]));
  });
});

describe("the shopper's VAT number (D157)", () => {
  const market = "se";
  const cartKey = () => `cart_${storeId}_se`;

  it("is kept on the cart with its answer, sets no cookie of its own, and never blocks", async () => {
    jar.clear();
    const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-MUG-WHITE'`);
    const { resolveShop } = await import("./shop");
    const shop = (await resolveShop(slug, market))!;
    await changeLine({ storeId, market: shop.market }, String(variant.id), 1, "add");
    const cookiesBefore = [...jar.keys()];
    expect(cookiesBefore).toEqual([cartKey()]);

    // A private buyer cannot give one.
    expect(await cartActions.vatNumberAction(slug, market, "DK12345678")).toEqual({ outcome: "no_company" });
    // The company is kept first, as checkout keeps it; the number is checked.
    vies.valid = true;
    const base = vies.calls;
    expect(await cartActions.vatNumberAction(slug, market, "DK12345678", { name: "Kunde ApS", number: "5566778899" })).toEqual({ outcome: "valid" });
    expect(await cartActions.vatNumberAction(slug, market, "DK12345678", { name: "Kunde ApS", number: "5566778899" })).toEqual({ outcome: "valid" });
    expect(vies.calls).toBe(base + 1);
    expect(await cartActions.vatNumberAction(slug, market, "", null)).toEqual({ outcome: "cleared" });
    expect(await cartActions.vatNumberAction(slug, market, "12", undefined)).toEqual({ outcome: "shape" });
    // Nothing was stored in the browser: the one cookie is still the cart's.
    expect([...jar.keys()]).toEqual(cookiesBefore);
    // A company with no name or a number that is not one is refused before anything is asked.
    const calls0 = vies.calls;
    expect(await cartActions.vatNumberAction(slug, market, "DK12345678", { name: "", number: "5566778899" })).toEqual({ outcome: "company" });
    expect(await cartActions.vatNumberAction(slug, market, "DK12345678", { name: "Kunde", number: "1234" })).toEqual({ outcome: "company_number" });
    expect(vies.calls).toBe(calls0);
  });
});
