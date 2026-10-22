import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const ownerTools = await import("./owner-tools");
const setupTools = await import("./setup-tools");
const { newStore } = await import("./inventory-test-support");
const { currentStore } = await import("./stores");
const { getSetupProgress, saveStoreDetails, setMarkets } = await import("./setup");
const { getShippingSettings } = await import("./settings");
const { getShippingSetup } = await import("./shipping-methods");
const { storeDetailsInput } = await import("@/lib/store-details");

type Row = Record<string, unknown>;
type Answer = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const DETAILS = { name: "Fjord", legal_name: "Fjord AS", organisation_number: "923 456 789", contact_email: "hei@fjord.example", postal_address: "Storgata 1, 0155 Oslo", country: "NO" };

/** A store as approving an access request makes it, with the features its owner would switch on for several countries, languages and currencies. */
async function setUpStore(label: string) {
  const made = await newStore(label);
  await db().execute(sql`update commerce.stores set features = array['shop', 'countries', 'languages', 'currencies'] where id = ${made.storeId}::uuid`);
  return made;
}

async function contextOf(storeId: string, slug: string, accountId: string, tags: string[] = []) {
  const store = (await currentStore(slug))!;
  const [account] = await db().execute<Row>(sql`select id, email, name from commerce.accounts where id = ${accountId}::uuid`);
  return {
    account: { id: String(account.id), email: String(account.email), name: account.name ? String(account.name) : null, platformAdmin: false } as never,
    store,
    invalidate: (tag: string) => void tags.push(tag),
    storeId,
  };
}

const refusal = (promise: Promise<unknown>) => promise.then(() => "no refusal", (error: Error) => error.message);

afterAll(() => closeDb());

describe("setting a store up through the AI manager", () => {
  let made: Awaited<ReturnType<typeof setUpStore>>;
  let ctx: Awaited<ReturnType<typeof contextOf>>;
  const tags: string[] = [];
  const run = async (name: string, input: unknown) => ownerTools.runOwnerTool(await contextOf(made.storeId, made.slug, made.accountId, tags), name, input) as Promise<Answer>;

  beforeAll(async () => {
    made = await setUpStore("setuptools");
    ctx = await contextOf(made.storeId, made.slug, made.accountId, tags);
  });

  it("says what is left, in order, and what only the owner can do", async () => {
    const status = await run("setup_progress", {});
    expect(status).toMatchObject({ open: false, ready_to_open: false, next: { step: "Business details", tools: ["set_store_details"] } });
    expect(status.owner_only.map((o: Answer) => o.what)).toContain("Payments account (Stripe or Mollie)");
    expect(status.owner_only.find((o: Answer) => o.what.startsWith("Payments account")).page).toBe(`/admin/${made.slug}/settings/payments`);
  });

  it("refuses details the Company page would refuse, saying what is missing, and saves them at once while the store is being set up", async () => {
    expect(await ownerTools.gateNeeded(ctx.store, "set_store_details", DETAILS)).toBe(false);
    const missing = await refusal(run("set_store_details", { name: "Fjord" }));
    expect(missing).toContain("Enter the business's legal name.");
    expect(missing).toContain("Enter a contact email shoppers can write to.");
    expect(await refusal(run("set_store_details", { ...DETAILS, country: "ZZ" }))).toBe("ZZ is not a country Kaizena Flow knows.");

    const done = await run("set_store_details", DETAILS);
    expect(done.done).toContain('Changed the store\'s details: the name to "Fjord", the legal name to "Fjord AS"');
    const store = (await currentStore(made.slug))!;
    expect({ name: store.name, ...store.details }).toEqual({
      name: "Fjord",
      legalName: "Fjord AS",
      organisationNumber: "923 456 789",
      contactEmail: "hei@fjord.example",
      postalAddress: "Storgata 1, 0155 Oslo",
      country: "NO",
    });
    expect((await run("set_store_details", { contact_email: "hei@fjord.example" })).done).toBe("Nothing changed: the details are already so.");
  });

  it("chooses the countries, the flat rates and a shipping method, read back as the Shipping page reads them", async () => {
    expect(await refusal(run("set_countries", { countries: ["NO", "XX"] }))).toBe("Not a country Kaizena Flow knows: XX.");
    const countries = await run("set_countries", { countries: ["no", "se"] });
    expect(countries.done).toBe("The store sells in Norway and Sweden: stop offering Denmark (its prices and settings are kept).");
    expect((await currentStore(made.slug))!.markets.map((m) => m.code).sort()).toEqual(["NO", "SE"]);

    expect(await refusal(run("set_flat_shipping", { rates: [{ country: "DK", price: "10" }] }))).toContain("The store does not sell to DK");
    await run("set_flat_shipping", { rates: [{ country: "SE", price: "69", free_over: "800" }] });
    const flat = await getShippingSettings((await currentStore(made.slug))!);
    expect(flat.find((r) => r.marketCode === "SE")).toMatchObject({ amountMinor: 6900, freeOverMinor: 80000 });

    expect(await refusal(run("save_shipping_method", { country: "NO", name: "Hjemlevering", rates: [{ tiers: [{ by: "weight", from: 100, price: "99" }] }] }))).toContain(
      "no gap between tiers",
    );
    const method = await run("save_shipping_method", {
      country: "NO",
      name: "Hjemlevering",
      transit_days: { min: 1, max: 3 },
      rates: [{ tiers: [{ by: "weight", up_to: 5000, price: "99" }, { by: "weight", from: 5000, price: "149" }] }],
    });
    expect(method.done).toMatch(/^Saved\. The store has the shipping method "Hjemlevering" in Norway: 1 block of prices, 1–3 days\.$/);
    await run("save_shipping_method", { method: "hjemlevering", country: "NO", free_over: "1500" });
    const saved = (await getShippingSetup(made.storeId)).methods.find((m) => m.id === method.method)!;
    expect(saved).toMatchObject({ name: "Hjemlevering", freeOverMinor: 150000, estimate: { min: 1, max: 3 } });
    expect(saved.rates.map((r) => [r.minValue, r.maxValue, r.amountMinor])).toEqual([
      [0, 5000, 9900],
      [5000, null, 14900],
    ]);
    expect(await refusal(run("save_shipping_method", { method: "Express", country: "NO" }))).toBe('No shipping method "Express" in Norway. Its methods: Hjemlevering.');
  });

  it("sets the languages and currencies with the Localization page's rules", async () => {
    expect(await refusal(run("set_languages", { main: "xx" }))).toContain("xx is not a language stores can offer.");
    const languages = await run("set_languages", { main: "en" });
    expect(languages.done).toContain("Make British English the main language");
    expect((await currentStore(made.slug))!.localization.locales).toEqual(["en-GB", "nb-NO", "sv-SE"]);

    expect(await refusal(run("set_currencies", { remove: ["NOK"] }))).toBe("NOK is a country's own currency, which its prices are in, so it stays.");
    expect(await refusal(run("set_currencies", { add: [{ currency: "DKK" }], rates_follow_ecb: false }))).toBe(
      "DKK needs a rate to be shown to shoppers, or let the rates follow the ECB's.",
    );
    await run("set_currencies", { add: [{ currency: "EUR", round_to: 0.1 }], rates_follow_ecb: false });
    const [eur] = await db().execute<Row>(sql`select rate, round_to from commerce.store_currencies where store_id = ${made.storeId}::uuid and currency = 'EUR'`);
    expect({ rate: Number(eur.rate), roundTo: Number(eur.round_to) }).toEqual({ rate: 1, roundTo: 10 });
  });

  it("reaches ready to open as the wizard's store does, opens only on a yes, and then every change waits for one", async () => {
    // The same details and countries saved through the wizard's own savers on a second store.
    const wizard = await setUpStore("setupwizard");
    const wizardCtx = await contextOf(wizard.storeId, wizard.slug, wizard.accountId);
    const member = { account: wizardCtx.account, store: wizardCtx.store, role: "owner" as const };
    await saveStoreDetails(member, storeDetailsInput.parse({ name: DETAILS.name, legalName: DETAILS.legal_name, organisationNumber: DETAILS.organisation_number, contactEmail: DETAILS.contact_email, postalAddress: DETAILS.postal_address, country: DETAILS.country }));
    await setMarkets({ ...member, store: (await currentStore(wizard.slug))! }, ["NO", "SE"]);
    const viaWizard = await getSetupProgress((await currentStore(wizard.slug))!);
    const viaTools = await getSetupProgress((await currentStore(made.slug))!);
    expect(viaTools.readyToOpen).toBe(true);
    for (const key of ["details", "countries", "readyToOpen"] as const) expect([key, viaTools[key]]).toEqual([key, viaWizard[key]]);

    const fresh = await contextOf(made.storeId, made.slug, made.accountId, tags);
    expect(await ownerTools.gateNeeded(fresh.store, "open_store", {})).toBe(true);
    await ownerTools.preflightOwnerTool(fresh, "open_store", {});
    expect(await setupTools.setupApprovalWords(fresh, "open_store", {})).toMatch(/^Open Fjord to shoppers: its pages become public, search engines may list it/);
    expect((await run("open_store", {})).done).toBe("Fjord is open.");
    expect((await currentStore(made.slug))!.setupCompletedAt).not.toBeNull();
    expect(tags).toEqual(expect.arrayContaining([`catalog:${made.storeId}`]));

    const open = await contextOf(made.storeId, made.slug, made.accountId);
    expect(await ownerTools.gateNeeded(open.store, "set_countries", { countries: ["NO"] })).toBe(true);
    expect(await refusal(ownerTools.preflightOwnerTool(open, "open_store", {}))).toBe("The store is already open.");
    expect(await setupTools.setupApprovalWords(open, "set_countries", { countries: ["NO"] })).toBe("Sell in Norway: stop offering Sweden (its prices and settings are kept).");
    expect((await run("setup_progress", {})).note).toContain("waits for the owner's yes");

    const audit = await db().execute<Row>(sql`select action, area from commerce.audit_log where store_id = ${made.storeId}::uuid and action like 'store.assistant.%'`);
    expect(audit.filter((a) => a.action === "store.assistant.open_store").map((a) => a.area)).toEqual(["settings"]);
    expect(new Set(audit.map((a) => a.area))).toEqual(new Set(["settings"]));
  });

  it("refuses a store not ready to open, and a member whose role may not change the settings", async () => {
    const bare = await setUpStore("setupbare");
    const bareCtx = await contextOf(bare.storeId, bare.slug, bare.accountId);
    expect(await refusal(ownerTools.preflightOwnerTool(bareCtx, "open_store", {}))).toBe(
      "The store cannot open yet: it needs its business details (set_store_details).",
    );
    const reader = { ...bareCtx, holder: { role: "admin" as const, permissions: ["orders:read"] } };
    expect(await refusal(ownerTools.runOwnerTool(reader, "set_flat_shipping", { rates: [{ country: "NO", price: "10" }] }))).not.toBe("no refusal");
    expect(await refusal(ownerTools.runOwnerTool(reader, "set_store_details", DETAILS))).not.toBe("no refusal");
  });
});
