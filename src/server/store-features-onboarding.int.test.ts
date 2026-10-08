import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { answersForFeatures } from "@/lib/onboarding";
import { setupStepsFor } from "@/lib/setup-steps";
import { parseStarterDetails } from "@/lib/store-starters";

import type { Account } from "./auth";
import { addMember, auditRows, makeAccount, makeStore, membershipOf, run } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const setup = await import("./setup");
const features = await import("./store-features");
const starters = await import("./store-starters");
const { createStoreForOwner } = await import("./platform");
const { runOwnerTool, preflightOwnerTool, OwnerToolError } = await import("./owner-tools");
const { featureApprovalDetails } = await import("./feature-tools");
const { mcpToolsFor } = await import("./store-mcp");

type Row = Record<string, unknown>;

/**
 * Onboarding (D178 step 6, docs/store-features.md 4f): the setup wizard's question sets the features through `setFeatures()` (owners only,
 * needs, blockers, warnings, the audit), the wizard's steps follow them, a website opens without products or payments, a store template's
 * features reach the stores made from it through its published copy, and the AI manager lists and switches features as the page does.
 */

let n = 0;
const kept = async (storeId: string) => ((await db().execute<Row>(sql`select features from commerce.stores where id = ${storeId}::uuid`))[0].features as string[]);
const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];

/** A paid order with goods still to send (real payment): what blocks switching the online shop off. */
async function paidUnsent(storeId: string): Promise<void> {
  const number = `ON-${run}-${++n}`;
  const [o] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
    values (${storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', ${`${number}@example.com`}, 'paid', 10000, 0, 0, 2000, 10000, '{"name":"A"}'::jsonb, '{"name":"A","line1":"G 1","postalCode":"0150","city":"Oslo","country":"NO"}'::jsonb)
    returning id
  `);
  const [variant] = await db().execute<Row>(sql`
    select v.id from commerce.product_variants v join commerce.products p on p.id = v.product_id where p.store_id = ${storeId}::uuid and p.kind = 'goods' limit 1
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
    values (${storeId}::uuid, ${String(o.id)}::uuid, ${String(variant.id)}::uuid, 'X', 'Thing', 1, 10000, 100, 10000, 2000, 0.25, 'txcd_99999999', 'physical'::commerce.delivery)
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, kaizen_fee_minor, currency, status, test_mode)
    values (${storeId}::uuid, ${String(o.id)}::uuid, 'stripe', ${`pi_on_${run}_${n}`}, 10000, 0, 'NOK', 'captured', false)
  `);
}

const ctx = (account: Account, store: Awaited<ReturnType<typeof membershipOf>>["store"]) => ({ account, store, invalidate: () => {} });

afterAll(async () => {
  await closeDb();
});

describe("a new store from the default template (D178 step 6, defaults)", () => {
  let store: Awaited<ReturnType<typeof makeStore>>;
  beforeAll(async () => {
    store = await makeStore("onboard-default");
  });

  it("starts with the online shop alone; its demo appointment, stay and rental are offered nowhere until their feature is on", async () => {
    expect(await kept(store.id)).toEqual(["shop"]);
    const rows = await db().execute<Row>(sql`
      select p.kind, commerce.kind_offered(p.store_id, p.kind, false) as offered from commerce.products p
      where p.store_id = ${store.id}::uuid and p.kind in ('appointment', 'stay', 'rental') and p.status = 'active'
    `);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect([row.kind, row.offered]).toEqual([row.kind, false]);
  });

  it("starts the wizard with the question, pre-filled as products to ship, and not answered yet", async () => {
    const member = await membershipOf(store.slug, store.account);
    const progress = await setup.getSetupProgress(member.store);
    expect(progress.features).toBe(false);
    expect(answersForFeatures(member.store)).toEqual({ sells: ["goods"], extras: [] });
    expect(setupStepsFor(member.store).map((s) => s.id)).toEqual(["features", "details", "countries", "payments", "products", "launch"]);
    expect(await setup.starterTitleOf(member.store)).toBeNull();
  });
});

describe("answering What will you sell? (D178 step 6)", () => {
  let store: Awaited<ReturnType<typeof makeStore>>;
  beforeAll(async () => {
    store = await makeStore("onboard-answer");
  });

  it("is the owner's alone, and changes nothing for anyone else", async () => {
    const staff = await makeAccount("onboard-staff");
    await addMember(store.id, staff.id, "admin");
    const member = await membershipOf(store.slug, staff, "admin");
    expect(await setup.answerFeatureQuestion(member, { sells: ["website"], extras: [] })).toEqual({ ok: false, problems: ["Only an owner can switch features on or off."] });
    expect(await kept(store.id)).toEqual(["shop"]);
    expect(await auditRows(store.id, "store.features_chosen")).toHaveLength(0);
  });

  it("refuses answers that do not fit, before anything is switched", async () => {
    const owner = await membershipOf(store.slug, store.account);
    expect(await setup.answerFeatureQuestion(owner, { sells: [], extras: [] })).toMatchObject({ ok: false });
    expect(await setup.answerFeatureQuestion(owner, { sells: ["website"], extras: ["business"] })).toMatchObject({ ok: false });
    expect(await kept(store.id)).toEqual(["shop"]);
  });

  it("switches on what the answers need, audits each switch and the answer, and the wizard knows it was answered", async () => {
    const owner = await membershipOf(store.slug, store.account);
    const result = await setup.answerFeatureQuestion(owner, { sells: ["goods", "appointments"], extras: ["countries", "languages"] });
    expect(result).toMatchObject({ ok: true, features: ["shop", "appointments", "countries", "languages", "currencies"] });
    expect((await kept(store.id)).sort()).toEqual(["appointments", "countries", "currencies", "languages", "shop"]);
    const switches = await auditRows(store.id, "store.feature");
    expect(switches.map((r) => (r.details as Row).feature)).toEqual(["appointments", "countries", "languages", "currencies"]);
    for (const row of switches) expect(row).toMatchObject({ area: "settings", target_type: "store", details: { on: true, via: "setup" } });
    const [chosen] = await auditRows(store.id, "store.features_chosen");
    expect(chosen).toMatchObject({ area: "settings", details: { sells: ["goods", "appointments"], extras: ["countries", "languages"] } });
    const fresh = await membershipOf(store.slug, store.account);
    const progress = await setup.getSetupProgress(fresh.store);
    expect(progress.features).toBe(true);
    // The template's demo staff take the demo appointment, so the bookings step is done.
    expect(progress.bookings).toBe(true);
    expect(setupStepsFor(fresh.store).map((s) => s.id)).toEqual(["features", "details", "countries", "bookings", "payments", "products", "launch"]);
  });

  it("asks for confirmation before leaving out a feature with something set up, then switches it off", async () => {
    const owner = await membershipOf(store.slug, store.account);
    const refused = await setup.answerFeatureQuestion(owner, { sells: ["goods"], extras: ["countries", "languages"] });
    expect(refused).toMatchObject({ ok: false, needsConfirmation: true });
    expect(refused.ok ? [] : refused.warnings).toEqual([expect.stringContaining("appointment product")]);
    expect((await kept(store.id)).sort()).toEqual(["appointments", "countries", "currencies", "languages", "shop"]);
    const done = await setup.answerFeatureQuestion(owner, { sells: ["goods"], extras: ["countries", "languages"] }, { confirmed: true });
    expect(done).toMatchObject({ ok: true, features: ["shop", "countries", "languages", "currencies"] });
  });

  it("keeps the programs the question does not ask about", async () => {
    await db().execute(sql`update commerce.stores set features = features || '{bonus}' where id = ${store.id}::uuid`);
    const owner = await membershipOf(store.slug, store.account);
    // Leaving out the other countries the template sells in warns, so it is confirmed.
    expect(await setup.answerFeatureQuestion(owner, { sells: ["goods"], extras: [] }, { confirmed: true })).toMatchObject({ ok: true, features: ["shop", "bonus"] });
  });
});

describe("a website's setup (D178 step 6)", () => {
  let store: Awaited<ReturnType<typeof makeStore>>;
  beforeAll(async () => {
    store = await makeStore("onboard-website");
  });

  it("leaves the shop's steps out and opens with its details and country alone", async () => {
    const owner = await membershipOf(store.slug, store.account);
    expect(await setup.answerFeatureQuestion(owner, { sells: ["website"], extras: [] })).toMatchObject({ ok: true, features: [] });
    const website = await membershipOf(store.slug, store.account);
    expect(setupStepsFor(website.store).map((s) => s.id)).toEqual(["features", "details", "countries", "launch"]);
    await setup.saveStoreDetails(website, {
      name: "Nettsted",
      legalName: "Nettsted AS",
      organisationNumber: "999999999",
      contactEmail: "hei@example.com",
      postalAddress: "Gata 1, 0150 Oslo",
      country: "NO",
    });
    const ready = await membershipOf(store.slug, store.account);
    const progress = await setup.getSetupProgress(ready.store);
    // Only its demo products and no live payments: a website opens without products or payments of its own.
    expect(progress).toMatchObject({ features: true, details: true, countries: true, payments: false, products: false, readyToOpen: true });
    expect(await setup.completeSetup(ready)).toEqual({ ok: true });
    expect((await one(sql`select setup_completed_at is not null as open, commerce.store_is_active(id) as active from commerce.stores where id = ${store.id}::uuid`))).toEqual({ open: true, active: true });
  });

  it("is refused while customers would be hit, and switches nothing", async () => {
    const other = await makeStore("onboard-blocked");
    await paidUnsent(other.id);
    const owner = await membershipOf(other.slug, other.account);
    const result = await setup.answerFeatureQuestion(owner, { sells: ["website"], extras: [] }, { confirmed: true });
    expect(result).toMatchObject({ ok: false, problems: ["Not everything can be switched off yet.", expect.stringContaining("goods still to send")] });
    expect(await kept(other.id)).toEqual(["shop"]);
    expect(await auditRows(other.id, "store.features_chosen")).toHaveLength(0);
  });

  it("refuses a set that does not hold together", async () => {
    const owner = await membershipOf(store.slug, store.account);
    expect(await features.setFeatures(owner, ["shop", "referrals"])).toEqual({ ok: false, problems: ["Referral program needs Bonus program."] });
  });
});

describe("store templates choose features (D178 step 6)", () => {
  let admin: Account;
  let owner: Account;
  let starterId: string;
  const slug = `onb-spa-${run}`;

  beforeAll(async () => {
    admin = await makeAccount("onboard-platform", { platformAdmin: true });
    const first = await makeStore("onboard-owner");
    owner = first.account;
    const details = parseStarterDetails({ title: "Spa", summary: "Treatments", description: "", category: "appointments" });
    if (!details.ok) throw new Error("details");
    const made = await starters.createStarter(admin, { slug, details: details.details });
    if (!made.ok) throw new Error(made.problems.join(" "));
    starterId = made.id;
  });

  it("are set by a platform admin on the template's own store, audited, and refused to anyone else", async () => {
    expect(await starters.setStarterFeatures(owner, starterId, ["shop", "appointments"])).toMatchObject({ ok: false });
    expect(await starters.setStarterFeatures(admin, starterId, ["shop", "appointments", "bonus"])).toEqual({ ok: true, features: ["shop", "appointments", "bonus"] });
    const starter = (await starters.getStarter(starterId))!;
    expect(starter.features).toEqual(["appointments", "bonus", "shop"]);
    const [switched] = await auditRows(starter.storeId, "store.feature");
    expect(switched).toMatchObject({ account_id: admin.id, details: { via: "store_template" } });
  });

  it("are carried through Publish into the frozen copy, offered on the cards, and into a store made from it", async () => {
    expect(await starters.publishStarter(admin, starterId)).toMatchObject({ ok: true });
    const starter = (await starters.getStarter(starterId))!;
    expect(starter.publishedFeatures?.sort()).toEqual(["appointments", "bonus", "shop"]);
    const offered = (await starters.listOfferedStarters()).find((s) => s.id === starterId)!;
    expect(offered.features.sort()).toEqual(["appointments", "bonus", "shop"]);
    const card = (await starters.starterCards()).find((c) => c.id === starterId)!;
    expect(card.featureWords).toBe("Online shop with Appointments and Bonus program");
    expect((await starters.starterCards())[0].featureWords).toBe("Online shop");

    const made = await createStoreForOwner(owner, "My spa", `onb-myspa-${run}`, starterId);
    expect(made).toMatchObject({ ok: true });
    const store = await one(sql`select id, features from commerce.stores where slug = ${`onb-myspa-${run}`}`);
    expect((store.features as string[]).sort()).toEqual(["appointments", "bonus", "shop"]);
    // Its wizard asks the question pre-filled with the template's features, naming the template.
    const member = await membershipOf(`onb-myspa-${run}`, owner);
    expect(answersForFeatures(member.store)).toEqual({ sells: ["appointments"], extras: [] });
    expect(await setup.starterTitleOf(member.store)).toBe("Spa");
    expect((await setup.getSetupProgress(member.store)).features).toBe(false);
  });

  it("reach new stores only on the next Publish", async () => {
    expect(await starters.setStarterFeatures(admin, starterId, ["shop", "bookings"], { confirmed: true })).toMatchObject({ ok: true });
    expect((await starters.getStarter(starterId))!.changedInStore).toBe(true);
    await createStoreForOwner(owner, "Before", `onb-before-${run}`, starterId);
    expect(((await one(sql`select features from commerce.stores where slug = ${`onb-before-${run}`}`)).features as string[]).sort()).toEqual(["appointments", "bonus", "shop"]);
    await starters.publishStarter(admin, starterId);
    await createStoreForOwner(owner, "After", `onb-after-${run}`, starterId);
    expect(((await one(sql`select features from commerce.stores where slug = ${`onb-after-${run}`}`)).features as string[]).sort()).toEqual(["bookings", "shop"]);
  });
});

describe("the AI manager's feature tools (D178 step 6)", () => {
  let store: Awaited<ReturnType<typeof makeStore>>;
  beforeAll(async () => {
    store = await makeStore("onboard-tools");
  });

  it("lists every feature with its state, use, needs and page", async () => {
    const member = await membershipOf(store.slug, store.account);
    await db().execute(sql`update commerce.stores set features = '{shop,business,bonus}' where id = ${store.id}::uuid`);
    const asleep = await membershipOf(store.slug, store.account);
    void member;
    await db().execute(sql`update commerce.stores set features = '{business,bonus}' where id = ${store.id}::uuid`);
    const website = await membershipOf(store.slug, store.account);
    const listed = (await runOwnerTool(ctx(store.account, website.store), "list_features", {})) as { features: Row[] };
    const byId = Object.fromEntries(listed.features.map((f) => [f.id, f]));
    expect(listed.features).toHaveLength(11);
    expect(byId.shop).toMatchObject({ state: "off", needs: [] });
    expect(byId.bonus).toMatchObject({ state: "asleep", waiting_for: ["the online shop"], needs: ["the online shop"] });
    expect(byId.appointments).toMatchObject({ state: "off", in_use: true });
    expect(byId.referrals).toMatchObject({ needs: ["the online shop", "Bonus program"] });
    expect(asleep.store.features.sort()).toEqual(["bonus", "business", "shop"]);
    await db().execute(sql`update commerce.stores set features = '{shop}' where id = ${store.id}::uuid`);
  });

  it("refuses a switch that could not be made before it is kept for a yes", async () => {
    const member = await membershipOf(store.slug, store.account);
    const refusal = async (args: Row) => {
      try {
        await preflightOwnerTool(ctx(store.account, member.store), "set_feature", args);
        return null;
      } catch (error) {
        expect(error).toBeInstanceOf(OwnerToolError);
        return (error as Error).message;
      }
    };
    expect(await refusal({ feature: "referrals", on: true })).toBe("Referral program needs Bonus program. Switch it on first.");
    expect(await refusal({ feature: "shop", on: true })).toBe("Online shop is already switched on.");
    expect(await refusal({ feature: "appointments", on: true })).toBeNull();
    // A staff member may not, whatever the switch.
    const staff = { ...ctx(store.account, member.store), holder: { role: "admin" as const } };
    await expect(preflightOwnerTool(staff, "set_feature", { feature: "appointments", on: true })).rejects.toThrow("only an owner can");
  });

  it("switches on at the owner's yes, through setFeature, audited", async () => {
    const member = await membershipOf(store.slug, store.account);
    const details = await featureApprovalDetails(member.store, { feature: "appointments", on: true });
    expect(details).toEqual({ summary: expect.stringContaining("Switch on Appointments"), warnings: [] });
    expect(await runOwnerTool(ctx(store.account, member.store), "set_feature", { feature: "appointments", on: true, approved_warnings: [] })).toMatchObject({
      done: "Appointments is switched on.",
      set_up: `/admin/${store.slug}/bookings/staff`,
    });
    expect((await kept(store.id)).sort()).toEqual(["appointments", "shop"]);
    expect((await auditRows(store.id, "store.feature")).at(-1)).toMatchObject({ details: { feature: "appointments", on: true } });
  });

  it("switches off only with the warnings the owner approved, and refuses when they changed", async () => {
    const member = await membershipOf(store.slug, store.account);
    const details = await featureApprovalDetails(member.store, { feature: "appointments", on: false });
    expect(details.warnings).toEqual([expect.stringContaining("appointment product")]);
    expect(details.summary).toContain(details.warnings[0]);
    await expect(runOwnerTool(ctx(store.account, member.store), "set_feature", { feature: "appointments", on: false, approved_warnings: [] })).rejects.toThrow(
      "has changed since you were asked",
    );
    expect((await kept(store.id)).sort()).toEqual(["appointments", "shop"]);
    expect(await runOwnerTool(ctx(store.account, member.store), "set_feature", { feature: "appointments", on: false, approved_warnings: details.warnings })).toMatchObject({
      done: "Appointments is switched off.",
    });
    expect(await kept(store.id)).toEqual(["shop"]);
  });

  it("is served to Kaizen Life as an owner tool, in a website too", async () => {
    await db().execute(sql`update commerce.stores set features = '{}' where id = ${store.id}::uuid`);
    const tools = (await mcpToolsFor({ account: store.account, stores: [{ id: store.id, slug: store.slug, name: "x" }], aal: "aal2" })).map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(["list_features", "set_feature"]));
    await db().execute(sql`update commerce.stores set features = '{shop}' where id = ${store.id}::uuid`);
  });
});
