import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

/**
 * The AI manager's extension suggestions (D748 E9, D852): an offer only on a fact from the store's records, at most once in 30 days, quiet
 * for 90 days after a no, and a trial started only on the owner's yes, refused before it waits when the account had it.
 */

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const offers = await import("./extension-offers");
const stores = await import("./stores");

const run = Date.now().toString(36);
let owner: Account;
let slug: string;
let organisationId: string;
let launchedBefore: unknown;

beforeAll(async () => {
  const [a] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`offers-${run}@example.com`}, 'Offers') returning id, email`);
  owner = { id: String(a.id), email: String(a.email), name: "Offers", platformAdmin: false };
  const [made] = await db().execute<Row>(sql`select commerce.make_workspace(${owner.id}::uuid, 'Offers desk', 'NO', 'NOK', 'nb-NO') as id`);
  const [store] = await db().execute<Row>(sql`select slug, organisation_id from commerce.stores where id = ${String(made.id)}::uuid`);
  slug = String(store.slug);
  organisationId = String(store.organisation_id);
  const [settings] = await db().execute<Row>(sql`select extensions_launched_at from commerce.platform_settings`);
  launchedBefore = settings?.extensions_launched_at ?? null;
  await db().execute(sql`update commerce.platform_settings set extensions_launched_at = now() - interval '1 day'`);
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set extensions_launched_at = ${launchedBefore as string | null}::timestamptz`);
  await closeDb();
});

const ctx = async () => ({ account: owner, store: (await stores.getStore(slug))! });

describe("extension suggestions (D852)", () => {
  it("offers nothing on a quiet store", async () => {
    expect(await offers.extensionOffersTool(await ctx(), {})).toMatchObject({ offer: null });
  });

  it("offers email automation on its subscribers, with the fact and a price, once in 30 days", async () => {
    const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${slug}`);
    await db().execute(sql`
      insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token)
      select ${String(store.id)}::uuid, 'p' || n || '-${sql.raw(run)}@example.com', 'nb-NO', 'subscribed', 'form', 'Ja takk', now(),
             substr(md5(n::text || ${run} || 'a') || md5(n::text || ${run} || 'b'), 1, 43)
        from generate_series(1, 200) n
    `);
    const first = await offers.extensionOffersTool(await ctx(), {});
    expect(first).toMatchObject({ offer: { extension: "email_automation", fact: "200 people who said yes to marketing email", free_trial_days: 14 } });
    expect((first as { offer: { price_from: string } }).offer.price_from).toMatch(/a month, without VAT$/);
    // Offered: not again for 30 days.
    expect(await offers.extensionOffersTool(await ctx(), {})).toMatchObject({ offer: null });
  });

  it("keeps a no for 90 days, even once 30 have passed", async () => {
    expect(await offers.extensionOffersTool(await ctx(), { declined: "email_automation" })).toMatchObject({ recorded: true });
    await db().execute(sql`update commerce.extension_offers set offered_at = now() - interval '40 days' where organisation_id = ${organisationId}::uuid`);
    expect(await offers.extensionOffersTool(await ctx(), {})).toMatchObject({ offer: null });
    await db().execute(sql`update commerce.extension_offers set declined_at = now() - interval '91 days' where organisation_id = ${organisationId}::uuid`);
    expect(await offers.extensionOffersTool(await ctx(), {})).toMatchObject({ offer: { extension: "email_automation" } });
  });

  it("starts the trial only on the owner's yes, and refuses before it waits once the account had it", async () => {
    expect(await offers.preflightExtensionTrial(await ctx(), { extension: "email_automation" })).toBeNull();
    expect(await offers.startTrialOnYes(await ctx(), { extension: "email_automation" })).toEqual({ done: "The free trial has started: 14 days." });
    expect(await offers.preflightExtensionTrial(await ctx(), { extension: "email_automation" })).toBe("The account already has it.");
    // Having it, it is never offered again.
    expect(await offers.extensionOffersTool(await ctx(), {})).toMatchObject({ offer: null });
  });

  it("offers nothing to a member who is not the account's owner", async () => {
    expect(await offers.extensionOffersTool({ ...(await ctx()), holder: { role: "admin" } }, {})).toMatchObject({ offer: null, note: "Only the account's owner adds extensions." });
  });
});
