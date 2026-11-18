import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";
import { EXTENSION_IDS } from "@/lib/extensions";

import type { Account } from "./auth";
import { getExtensionCatalogue, organisationExtensionStandings, saveBundle, saveExtension, savePlanGrants } from "./extensions";

/**
 * Paid extensions' catalogue and an account's standing (D748 step E2) against a real database: the seeded catalogue reads back, a changed
 * price is a new row and an unchanged one stays, a bundle and a plan's grants save, and an account has every extension until extensions are
 * sold, then what its plan includes and its own rows.
 */

type Row = Record<string, unknown>;

const tag = Date.now().toString(36);
let admin: Account;
let plan: string;
let organisation: string;
let store: string;
const bundles: string[] = [];

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`ext-${tag}@example.com`}, 'Ext Admin') returning id`);
  admin = { id: String(account.id), email: `ext-${tag}@example.com`, name: "Ext Admin" } as Account;
  const [p] = await db().execute<Row>(sql`insert into commerce.plans (name, position) values (${`Ext ${tag}`}, 9100) returning id`);
  plan = String(p.id);
  const [s] = await db().execute<Row>(sql`insert into commerce.stores (slug, name, created_by) values (${`ext-${tag}`}, 'Ext Store', ${admin.id}::uuid) returning id`);
  store = String(s.id);
  await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${store}::uuid, ${admin.id}::uuid, 'owner')`);
  const [o] = await db().execute<Row>(sql`select organisation_id from commerce.stores where id = ${store}::uuid`);
  organisation = String(o.organisation_id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.plan_extension_grants where plan_id = ${plan}::uuid`);
  for (const id of bundles) {
    await db().execute(sql`delete from commerce.extension_bundle_prices where bundle_id = ${id}::uuid`);
    await db().execute(sql`delete from commerce.extension_bundles where id = ${id}::uuid`);
  }
  await closeDb();
});

describe("the extension catalogue (D748 E2)", () => {
  it("reads the seeded catalogue in code's order with its sizes, prices and bundles", async () => {
    const catalogue = await getExtensionCatalogue();
    expect(catalogue.extensions.map((e) => e.id)).toEqual([...EXTENSION_IDS]);
    const email = catalogue.extensions.find((e) => e.id === "email_automation");
    expect(email?.sizes.map((s) => s.allowances.contacts)).toEqual([2500, 10000, 25000, 50000]);
    expect(email?.sizes[0].prices.find((p) => p.currency === "EUR" && p.interval === "month")?.amountMinor).toBe(2500);
    expect(catalogue.bundles.find((b) => b.name === "Customers")?.members).toEqual(["support_desk", "email_automation", "deals"]);
  });

  it("keeps an unchanged price's row, makes a changed one a new row, and adds a new size", async () => {
    const before = (await getExtensionCatalogue()).extensions.find((e) => e.id === "work");
    if (!before) throw new Error("no Work");
    const size = before.sizes[0];
    const eurMonth = size.prices.find((p) => p.currency === "EUR" && p.interval === "month");
    const kept = size.prices.filter((p) => p !== eurMonth);
    const result = await saveExtension(admin, "work", {
      name: before.name,
      description: before.description,
      standalone: before.standalone,
      position: before.position,
      active: before.active,
      sizes: [
        { id: size.id, label: size.label, allowances: size.allowances, position: 0, active: true, prices: [...kept, { currency: "EUR", interval: "month", amountMinor: 3600 }] },
        { id: null, label: `10 people ${tag}`, allowances: { people: 10 }, position: 1, active: false, prices: [] },
      ],
    });
    expect(result.ok).toBe(true);
    const after = (await getExtensionCatalogue()).extensions.find((e) => e.id === "work");
    const priced = after?.sizes[0].prices;
    expect(priced?.find((p) => p.currency === "EUR" && p.interval === "month")?.amountMinor).toBe(3600);
    expect(priced?.find((p) => p.currency === "EUR" && p.interval === "month")?.id).not.toBe(eurMonth?.id);
    expect(priced?.filter((p) => p.currency === "NOK").map((p) => p.id).sort()).toEqual(kept.filter((p) => p.currency === "NOK").map((p) => p.id).sort());
    expect(after?.sizes.find((s) => s.label === `10 people ${tag}`)).toMatchObject({ active: false, allowances: { people: 10 }, prices: [] });
    // Back to the list price, as a new row again.
    await saveExtension(admin, "work", { ...before, sizes: [{ ...size, position: 0, active: true, prices: size.prices }] });
  });

  it("saves a new bundle with its members and prices, and a plan's grants", async () => {
    expect(
      (await saveBundle(admin, null, {
        name: `Office ${tag}`,
        description: "",
        position: 9,
        active: true,
        members: ["work", "deals"],
        prices: [{ currency: "EUR", interval: "month", amountMinor: 5900 }],
      })).ok,
    ).toBe(true);
    const bundle = (await getExtensionCatalogue()).bundles.find((b) => b.name === `Office ${tag}`);
    if (bundle) bundles.push(bundle.id);
    expect(bundle).toMatchObject({ members: ["work", "deals"], prices: [{ currency: "EUR", interval: "month", amountMinor: 5900 }] });

    const catalogue = await getExtensionCatalogue();
    const ab = catalogue.extensions.find((e) => e.id === "ab_testing")?.sizes[0].id ?? "";
    expect((await savePlanGrants(admin, [plan], [{ planId: plan, extensionId: "ab_testing", sizeId: ab }])).ok).toBe(true);
    expect((await getExtensionCatalogue()).grants.filter((g) => g.planId === plan)).toEqual([{ planId: plan, extensionId: "ab_testing", sizeId: ab }]);
  });
});

describe("an account's standing (D748 E2)", () => {
  it("has every extension until extensions are sold", async () => {
    const standings = await organisationExtensionStandings(organisation);
    expect(Object.values(standings).every((s) => s.state === "active" && s.source === "legacy")).toBe(true);
  });

  it("once sold, has what its store's plan includes and its own trial, and nothing else", async () => {
    await db()
      .transaction(async (tx) => {
        await tx.execute(sql`update commerce.platform_settings set extensions_launched_at = now() - interval '1 day'`);
        await tx.execute(sql`insert into commerce.store_billing (store_id, plan_id, status) values (${store}::uuid, ${plan}::uuid, 'active')
          on conflict (store_id) do update set plan_id = excluded.plan_id, status = excluded.status`);
        await tx.execute(sql`insert into commerce.organisation_extensions (organisation_id, extension_id, source, trial_ends_at)
          values (${organisation}::uuid, 'work', 'trial', now() + interval '14 days')`);
        const standings = await organisationExtensionStandings(organisation, new Date(), tx);
        expect(standings.ab_testing).toEqual({ state: "active", source: "plan" });
        expect(standings.work).toEqual({ state: "trial", source: "trial" });
        expect(standings.deals).toEqual({ state: "absent", source: null });
        const platform = await tx.execute<Row>(sql`select id from commerce.organisations where platform`);
        const own = await organisationExtensionStandings(String(platform[0].id), new Date(), tx);
        expect(Object.values(own).every((s) => s.state === "platform")).toBe(true);
        throw new Error("rollback");
      })
      .catch((error: unknown) => {
        if (!(error instanceof Error && error.message === "rollback")) throw error;
      });
    expect((await organisationExtensionStandings(organisation)).deals.source).toBe("legacy");
  });
});
