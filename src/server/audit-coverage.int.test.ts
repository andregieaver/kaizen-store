import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent } from "@/lib/page-content";
import { productInput } from "@/lib/product-input";

import { addMember, auditRows, makeAccount, makeStore, membershipOf, run } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const products = await import("./products");
const pages = await import("./pages");
const discounts = await import("./discounts");
const settings = await import("./settings");
const stores = await import("./stores");
const audit = await import("./audit");

type Row = Record<string, unknown>;

/**
 * What the activity log writes down (wave 1, 1f, docs/wave-1-trust.md 2.10): a product, a price, a page, a coupon, the shipping settings, the team
 * and the payment settings each write an entry with the account and the changed fields, in the allowlist of their kind, never a secret.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let member: Awaited<ReturnType<typeof membershipOf>>;

beforeAll(async () => {
  store = await makeStore("coverage");
  member = await membershipOf(store.slug, store.account, "owner");
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
    select ${store.id}::uuid, code, currency, default_locale, locales, true from commerce.countries where code in ('NO', 'SE')
    on conflict do nothing
  `);
  member = await membershipOf(store.slug, store.account, "owner");
});

afterAll(async () => {
  await closeDb();
});

/** The product's texts in the store's main language (the only one that must have a title). */
const texts = (primary: string, title: string) => [{ locale: primary, title, description: "En kopp.", safetyInformation: "Varm.", seoTitle: "", seoDescription: "" }];

async function product(overrides: { title?: string } & Record<string, unknown> = {}, id: string | null = null, prices = { NO: "249,00", SE: "" }) {
  const live = (await stores.getStore(store.slug))!;
  const context = await products.getEditorContext(live);
  const base = products.emptyProduct(context);
  const { title, ...rest } = overrides;
  // A product saved again keeps its variant (by id), as the editor sends it.
  const existing = id ? await products.getProductForEdit(live, context, id) : null;
  const input = productInput.parse({
    ...base,
    handle: `kopp-${run}`,
    translations: texts(context.primaryLocale, title ?? "Kopp"),
    media: [{ url: "https://example.com/kopp.webp", thumbnailUrl: "https://example.com/kopp-480.webp", alt: "" }],
    options: [{ name: "Farge", values: ["Hvit"] }],
    variants: [{ ...base.variants[0], id: existing?.variants[0].id ?? null, options: { Farge: "Hvit" }, sku: `K-${run}`, prices, stock: 5 }],
    manufacturer: { new: { name: "Keramikk AS", postalAddress: "Storgata 1, 0155 Oslo", electronicAddress: "post@keramikk.no", country: "NO" } },
    responsiblePerson: { new: { name: "Keramik AB", postalAddress: "Drottninggatan 1, Stockholm", electronicAddress: "info@keramik.se", country: "SE" } },
    status: "active",
    ...rest,
  });
  const saved = await products.saveProduct(live, context, id, input, undefined, undefined, member.account);
  if (!saved.ok) throw new Error(saved.problems.join(" | "));
  return saved;
}

describe("products and prices", () => {
  let productId: string;

  it("a new product writes product.created with its fields, and the first price of each market writes product.price_changed", async () => {
    const result = await product();
    expect(result).toMatchObject({ ok: true });
    productId = (result as { productId: string }).productId;
    const created = await auditRows(store.id, "product.created");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ account_id: store.account.id, area: "products", target_type: "product", target_id: productId });
    expect(created[0].changes).toMatchObject({ title: { from: null, to: "Kopp" }, status: { from: null, to: "active" }, handle: { from: null, to: `kopp-${run}` }, vatCategory: { from: null, to: "standard" }, variantCount: { from: null, to: 1 } });
    const prices = await auditRows(store.id, "product.price_changed");
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({ target_id: productId, details: { sku: `K-${run}`, market: "NO", currency: "NOK" }, changes: { priceMinor: { from: null, to: 24900 } } });
  });

  it("a change writes product.updated with only what changed, and the price entry carries minor units with the currency", async () => {
    const result = await product({ status: "active" }, productId, { NO: "199,00", SE: "209" });
    expect(result).toMatchObject({ ok: true });
    expect(await auditRows(store.id, "product.updated")).toHaveLength(0); // nothing about the product itself changed: no entry
    const prices = (await auditRows(store.id, "product.price_changed")).slice(1);
    expect(prices.map((p) => p.details)).toMatchObject([
      { sku: `K-${run}`, market: "NO", currency: "NOK" },
      { sku: `K-${run}`, market: "SE", currency: "SEK" },
    ]);
    expect(prices.map((p) => p.changes)).toEqual([{ priceMinor: { from: 24900, to: 19900 } }, { priceMinor: { from: null, to: 20900 } }]);
    const renamed = await product({ title: "Kopp med hank" }, productId, { NO: "199,00", SE: "209" });
    expect(renamed).toMatchObject({ ok: true });
    const updated = await auditRows(store.id, "product.updated");
    expect(updated).toHaveLength(1);
    expect(updated[0].changes).toEqual({ title: { from: "Kopp", to: "Kopp med hank" } });
    expect(updated[0].changes).not.toHaveProperty("stock");
    expect((await auditRows(store.id, "product.price_changed")).length).toBe(3);
  });

  it("an unchanged price writes nothing, and a price that ended is written as to null", async () => {
    const same = await auditRows(store.id, "product.price_changed");
    await product({}, productId, { NO: "199,00", SE: "209" });
    expect((await auditRows(store.id, "product.price_changed")).length).toBe(same.length);
    await product({}, productId, { NO: "199,00", SE: "" });
    const ended = (await auditRows(store.id, "product.price_changed")).at(-1)!;
    expect(ended).toMatchObject({ details: { market: "SE" }, changes: { priceMinor: { from: 20900, to: null } } });
  });

  it("archiving writes product.archived, and bringing it back writes product.updated", async () => {
    const live = (await stores.getStore(store.slug))!;
    expect(await products.setArchived(live, productId, true, member.account)).toBe(true);
    const archived = await auditRows(store.id, "product.archived");
    expect(archived).toHaveLength(1);
    expect(archived[0].changes).toEqual({ status: { from: "active", to: "archived" } });
    expect(await products.setArchived(live, productId, false, member.account)).toBe(true);
    expect((await auditRows(store.id, "product.updated")).at(-1)!.changes).toEqual({ status: { from: "archived", to: "draft" } });
  });

  it("a product the store does not have writes nothing, and one without an actor is saved as before", async () => {
    const live = (await stores.getStore(store.slug))!;
    const before = (await auditRows(store.id)).length;
    expect(await products.setArchived(live, "44444444-4444-4444-8444-444444444444", true, member.account)).toBe(false);
    expect((await auditRows(store.id)).length).toBe(before);
  });
});

describe("pages", () => {
  const content = (title: string, slug: string, rows: unknown[] = []) => ({ ...newPageContent(), title, slug, rows });

  it("a saved draft, a publish, an unpublish and a delete each write their entry with the title, address, state and counts", async () => {
    const saved = await pages.savePage(member.account, store.id, null, content("Om oss", `om-oss-${run}`), { publish: false });
    if (!saved.ok) throw new Error(saved.problems.join());
    expect((await auditRows(store.id, "store.page_saved")).at(-1)).toMatchObject({ area: "website", target_type: "page", target_id: saved.id, changes: { title: { from: null, to: "Om oss" }, state: { from: null, to: "draft" }, address: { from: null, to: `om-oss-${run}` }, rowCount: { from: null, to: 0 } } });
    const published = await pages.savePage(member.account, store.id, saved.id, content("Om oss", `om-oss-${run}`), { publish: true });
    expect(published).toMatchObject({ ok: true });
    expect((await auditRows(store.id, "store.page_published")).at(-1)!.changes).toEqual({ state: { from: "draft", to: "published" } });
    expect(await pages.unpublishPage(member.account, store.id, saved.id)).toBe(true);
    expect((await auditRows(store.id, "store.page_unpublished")).at(-1)).toMatchObject({ target_id: saved.id });
    expect(await pages.deletePage(member.account, store.id, saved.id)).toBe(true);
    expect((await auditRows(store.id, "store.page_deleted")).at(-1)).toMatchObject({ target_id: saved.id, details: { label: "Om oss" } });
  });

  it("writes the page's counts and never its words", async () => {
    const rows = [{ id: crypto.randomUUID(), type: "row", layout: "1", columns: [{ id: crypto.randomUUID(), blocks: [{ id: crypto.randomUUID(), type: "heading", level: 2, text: "A SECRET HEADING" }] }] }];
    const saved = await pages.savePage(member.account, store.id, null, content("Counts", `counts-${run}`, rows), { publish: false });
    if (!saved.ok) throw new Error(saved.problems.join());
    const entry = (await auditRows(store.id, "store.page_saved")).at(-1)!;
    expect(entry.changes).toMatchObject({ rowCount: { to: 1 }, blockCount: { to: 1 } });
    expect(JSON.stringify(entry)).not.toContain("A SECRET HEADING");
  });
});

describe("coupons", () => {
  const code = `SPRING${run}`.toUpperCase();
  const base = { code, kind: "percent", percent: 15, amounts: {}, minSubtotals: {}, startsAt: null, endsAt: null, usageLimit: null, oncePerCustomer: false, active: true, productIds: null, recurring: false };

  it("created, changed and deleted: the code, kind, value, limits, dates and whether it is on", async () => {
    const created = await discounts.saveDiscount(member, null, base);
    if (!created.ok || !created.id) throw new Error("coupon");
    expect((await auditRows(store.id, "discount.created")).at(-1)).toMatchObject({ area: "marketing", target_type: "discount", changes: { code: { from: null, to: code }, kind: { from: null, to: "percent" }, value: { from: null, to: 15 }, active: { from: null, to: true } } });
    await discounts.saveDiscount(member, created.id, { ...base, percent: 20, usageLimit: 100, active: false });
    expect((await auditRows(store.id, "discount.updated")).at(-1)!.changes).toEqual({ value: { from: 15, to: 20 }, usageLimit: { from: null, to: 100 }, active: { from: true, to: false } });
    await discounts.deleteDiscount(member, created.id);
    expect((await auditRows(store.id, "discount.deleted")).at(-1)).toMatchObject({ details: { code }, changes: { code: { from: code, to: null } } });
  });

  it("an unchanged save writes nothing", async () => {
    const created = await discounts.saveDiscount(member, null, { ...base, code: `${code}B` });
    if (!created.ok || !created.id) throw new Error("coupon");
    const before = (await auditRows(store.id, "discount.updated")).length;
    await discounts.saveDiscount(member, created.id, { ...base, code: `${code}B` });
    expect((await auditRows(store.id, "discount.updated")).length).toBe(before);
  });
});

describe("shipping, the team and payments", () => {
  it("shipping: the rate and free-above of each market that changed, in the market's own currency, before and after", async () => {
    const live = (await stores.getStore(store.slug))!;
    await settings.saveShippingSettings({ ...member, store: live }, [{ marketCode: "NO", amountMinor: 9123, freeOverMinor: 100000 }]);
    await settings.saveShippingSettings({ ...member, store: live }, [{ marketCode: "NO", amountMinor: 7123, freeOverMinor: 100000 }]);
    const log = await auditRows(store.id, "shipping.updated");
    expect(log).toHaveLength(2);
    // The store came with the template's rates: what is written is what these two saves changed, in minor units of NOK.
    expect(log[0].changes).toMatchObject({ rates: { to: 9123 }, freeAboveMinor: { to: 100000 } });
    expect(log[0].details).toMatchObject({ rates: [{ marketCode: "NO", amountMinor: 9123, freeOverMinor: 100000 }] });
    expect(log[1].changes).toEqual({ rates: { from: 9123, to: 7123 } });
    // Saved again with nothing changed: nothing is written.
    await settings.saveShippingSettings({ ...member, store: live }, [{ marketCode: "NO", amountMinor: 7123, freeOverMinor: 100000 }]);
    expect(await auditRows(store.id, "shipping.updated")).toHaveLength(2);
  });

  it("the team: an invitation with its role and a removal", async () => {
    const email = `team-${run}@example.com`;
    await settings.inviteStaff(member, email, "admin");
    expect((await auditRows(store.id, "staff.invited")).at(-1)).toMatchObject({ area: "staff", target_type: "account", changes: { email: { from: null, to: email }, role: { from: null, to: "admin" } } });
    const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${email}`);
    await settings.disableStaff(member, String(account.id));
    expect((await auditRows(store.id, "staff.disabled")).at(-1)).toMatchObject({ target_id: String(account.id), details: { email } });
  });

  it("payments: whether Stripe is on, the mode and invoices, and never a key", async () => {
    const live = (await stores.getStore(store.slug))!;
    await db().execute(sql`insert into commerce.payment_providers (store_id, provider, enabled, active_mode) values (${store.id}::uuid, 'stripe', false, 'test') on conflict do nothing`);
    await settings.setStripeProvider({ ...member, store: live }, false, "test", false);
    await settings.setStripeProvider({ ...member, store: live }, true, "test", true);
    const entry = (await auditRows(store.id, "payments.provider_updated")).at(-1)!;
    expect(entry).toMatchObject({ area: "settings", changes: { enabled: { from: false, to: true }, orderInvoices: { from: false, to: true } } });
    expect(JSON.stringify(entry)).not.toMatch(/sk_|whsec|secret_key|ciphertext/i);
  });
});

describe("never a secret, never a long value", () => {
  it("a field outside the allowlist is written as changed with no value; a secret-like field is refused under test; a long value is cut", async () => {
    const actor = { accountId: store.account.id, storeId: store.id };
    await audit.auditChange(actor, "product.updated", { type: "product", id: "x" }, { title: "a", notes: "old" }, { title: "b", notes: "new" }, "product");
    expect((await auditRows(store.id, "product.updated")).at(-1)!.changes).toEqual({ title: { from: "a", to: "b" }, notes: { changed: true } });
    await expect(audit.auditChange(actor, "product.updated", { type: "product", id: "x" }, { apiKey: "1" }, { apiKey: "2" }, "product")).rejects.toThrow(/secret-like/);
    await audit.auditChange(actor, "product.updated", { type: "product", id: "y" }, { title: "a" }, { title: "x".repeat(500) }, "product");
    const long = (await auditRows(store.id, "product.updated")).at(-1)!.changes as { title: { to: string } };
    expect(long.title.to.length).toBe(300);
    expect(long.title.to.endsWith("…")).toBe(true);
  });

  it("an update that changed nothing writes nothing; a creation and a deletion always do", async () => {
    const actor = { accountId: store.account.id, storeId: store.id };
    const before = (await auditRows(store.id)).length;
    await audit.auditChange(actor, "role.updated", { type: "role", id: "r" }, { name: "a" }, { name: "a" }, "role");
    expect((await auditRows(store.id)).length).toBe(before);
    await audit.auditChange(actor, "role.created", { type: "role", id: "r" }, null, { name: "a" }, "role");
    await audit.auditChange(actor, "role.deleted", { type: "role", id: "r" }, { name: "a" }, null, "role");
    expect((await auditRows(store.id)).length).toBe(before + 2);
  });

  it("writes an account's security event for the platform and for each store the person works in, with the area staff there", async () => {
    const person = await makeAccount("auditee");
    await addMember(store.id, person.id, "admin");
    await audit.auditAccount(person.id, "account.two_step_enrolled");
    const mine = (await auditRows(store.id, "account.two_step_enrolled")).filter((r) => r.target_id === person.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ area: "staff", account_id: person.id });
    const platform = (await auditRows(null, "account.two_step_enrolled")).filter((r) => r.target_id === person.id);
    expect(platform).toHaveLength(1);
    expect(platform[0].area).toBe("account");
    // A disabled member's store is not written to.
    await db().execute(sql`update commerce.store_members set disabled_at = now() where store_id = ${store.id}::uuid and account_id = ${person.id}::uuid`);
    await audit.auditAccount(person.id, "account.two_step_removed");
    expect((await auditRows(store.id, "account.two_step_removed")).filter((r) => r.target_id === person.id)).toHaveLength(0);
  });
});

describe("data in and out (wave 2, D165)", () => {
  it("the actions of the imports, exports and bulk edits are named in their area, and the entries of an export hold counts and never a person", async () => {
    const { areaOfAction } = await import("@/lib/audit");
    const orders = ["order.exported", "order.export_downloaded"];
    const customers = ["customer.exported", "customer.export_downloaded"];
    const productActions = ["products.import_started", "products.import_applied", "products.import_cancelled", "products.export_made", "products.export_downloaded", "products.bulk_edited", "products.bulk_undone"];
    for (const action of orders) expect(areaOfAction(action)).toBe("orders");
    for (const action of customers) expect(areaOfAction(action)).toBe("customers");
    for (const action of productActions) expect(areaOfAction(action)).toBe("products");
    // An entry written the way the export writes it keeps its area and target, and the secret-like check is not tripped by counts.
    const auth = await import("./auth");
    await auth.audit(store.account.id, store.id, "order.exported", { job: "j", rows: 3, direct: false }, { area: "orders", target: { type: "data_job", id: "j" } });
    expect((await auditRows(store.id, "order.exported")).at(-1)).toMatchObject({ area: "orders", target_type: "data_job", details: { rows: 3, direct: false } });
  });
});
