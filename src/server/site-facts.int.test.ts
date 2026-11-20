import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const { siteFacts } = await import("./site-facts");
const { siteCookies, listCookieNotes } = await import("./site-cookies");
const { getChatAgent } = await import("./chat-agent");
const { usesRememberedModals } = await import("./page-modals");
const { affiliateSite } = await import("./affiliates");
const { getRecommendSettings } = await import("./recommend-settings");
const { storeHasExperiments } = await import("./experiments-read");
const { referralPublicSettings } = await import("./referrals");
const { getPlatformLangs } = await import("./platform-navigation");
const { countStatements } = await import("@/db/statement-count");

type Row = Record<string, unknown>;

/**
 * The site's facts (bloat review step 2.18): one statement for what `siteCookies()` asks about a site's optional features, which must say
 * what each reader it folds says, for a store with nothing on, after each switch, and for Kaizena Flow's own site. Fixture as in
 * consents.int.test.ts.
 */

const run = Date.now().toString(36);
let storeId: string;

beforeAll(async () => {
  const [store] = await db().execute<Row>(sql`
    insert into commerce.stores (slug, name) values (${`facts-${run}`}, 'Facts store') returning id
  `);
  storeId = String(store.id);
});

afterAll(async () => {
  try {
    // The stores stay (as consents.int.test.ts leaves its own); what other files' jobs would find on them goes.
    await db().execute(sql`update commerce.experiments set status = 'stopped' where store_id = ${storeId}::uuid and status = 'running'`);
    await db().execute(sql`delete from commerce.chat_agents where store_id = ${storeId}::uuid`);
    await db().execute(sql`delete from commerce.recommendation_settings where store_id = ${storeId}::uuid`);
  } finally {
    await closeDb();
  }
});

/** The site's facts against what each reader they fold says today. */
async function agrees(): Promise<Awaited<ReturnType<typeof siteFacts>>> {
  const f = await siteFacts(storeId);
  expect(f.chat).toBe((await getChatAgent(storeId))?.enabled ?? false);
  expect(f.modals).toBe(await usesRememberedModals(storeId));
  const site = await affiliateSite(storeId);
  expect(f.affiliate).toEqual({ capture: site.capture, captureDays: site.captureDays });
  expect(f.recommendations).toBe((await getRecommendSettings(storeId)).enabled);
  expect(f.experiments).toBe(await storeHasExperiments(storeId));
  expect(f.notes).toEqual(await listCookieNotes(storeId));
  const [store] = await db().execute<Row>(sql`select features, visit_counting, heatmaps, recordings from commerce.stores where id = ${storeId}::uuid`);
  expect(f.features).toEqual((store.features as string[]).map(String));
  expect({ visitCounting: f.visitCounting, heatmaps: f.heatmaps, recordings: f.recordings }).toEqual({
    visitCounting: Boolean(store.visit_counting),
    heatmaps: Boolean(store.heatmaps),
    recordings: Boolean(store.recordings),
  });
  expect(f.referral).toBeNull();
  expect(f.platformLangs).toBe(0);
  return f;
}

describe("a site's facts (bloat review step 2.18)", () => {
  it("say what each reader they fold says, for a store with nothing on and after each switch", async () => {
    const plain = await agrees();
    expect(plain).toMatchObject({ chat: false, modals: false, recommendations: false, experiments: false, visitCounting: false, scanItems: [], notes: [] });
    expect(plain.affiliate).toEqual({ capture: false, captureDays: 30 });

    await db().execute(sql`insert into commerce.chat_agents (store_id, enabled) values (${storeId}::uuid, true)`);
    expect((await agrees()).chat).toBe(true);

    const modal = JSON.stringify({ rows: [{ id: "row-modal", type: "row", modal: { triggers: { exitIntent: true } }, columns: [] }] });
    const [page] = await db().execute<Row>(sql`
      insert into commerce.pages (store_id, slug, type, draft, published, published_at)
      values (${storeId}::uuid, ${`facts-modal-${run}`}, 'page', ${modal}::jsonb, ${modal}::jsonb, now()) returning id
    `);
    expect((await agrees()).modals).toBe(true);

    await db().execute(sql`update commerce.stores set features = features || array['bonus', 'referrals'] where id = ${storeId}::uuid`);
    await db().execute(sql`insert into commerce.bonus_settings (store_id, enabled, currency) values (${storeId}::uuid, true, 'NOK')`);
    await db().execute(sql`insert into commerce.affiliate_settings (store_id, enabled, cookie_days) values (${storeId}::uuid, true, 45)`);
    expect((await agrees()).affiliate).toEqual({ capture: true, captureDays: 45 });
    await db().execute(sql`insert into commerce.creator_settings (store_id, enabled, cookie_days) values (${storeId}::uuid, true, 60)`);
    expect((await agrees()).affiliate).toEqual({ capture: true, captureDays: 60 });

    await db().execute(sql`insert into commerce.recommendation_settings (store_id, enabled) values (${storeId}::uuid, true)`);
    expect((await agrees()).recommendations).toBe(true);

    // A test as the admin makes one: a draft with the original and a published version, then started.
    const [version] = await db().execute<Row>(sql`
      insert into commerce.pages (store_id, slug, type, draft, published, published_at)
      values (${storeId}::uuid, ${`facts-version-${run}`}, 'variant', ${modal}::jsonb, ${modal}::jsonb, now()) returning id
    `);
    const [test] = await db().execute<Row>(sql`
      insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values (${storeId}::uuid, 'Facts', ${String(page.id)}::uuid, 'orders') returning id
    `);
    await db().execute(sql`
      insert into commerce.experiment_variants (store_id, experiment_id, key, name, share, page_id)
      values (${storeId}::uuid, ${String(test.id)}::uuid, 'a', 'Original', 0.5, null), (${storeId}::uuid, ${String(test.id)}::uuid, 'b', 'Version B', 0.5, ${String(version.id)}::uuid)
    `);
    expect((await agrees()).experiments).toBe(false);
    await db().execute(sql`update commerce.experiments set status = 'running' where id = ${String(test.id)}::uuid`);
    expect((await agrees()).experiments).toBe(true);

    await db().execute(sql`update commerce.stores set visit_counting = true where id = ${storeId}::uuid`);
    expect((await agrees()).visitCounting).toBe(true);

    const item = { kind: "cookie", name: "_facts", domain: "example.com", thirdParty: true, days: 30, beforeConsent: false, page: "/" };
    await db().execute(sql`
      insert into commerce.cookie_scans (store_id, status, items, finished_at) values (${storeId}::uuid, 'done', ${JSON.stringify([item])}::jsonb, now())
    `);
    expect((await agrees()).scanItems).toEqual([item]);

    await db().execute(sql`
      insert into commerce.cookie_notes (store_id, kind, name, domain, category, provider, purpose)
      values (${storeId}::uuid, 'cookie', '_facts', 'example.com', 'marketing', 'Example', 'Counts visits')
    `);
    expect((await agrees()).notes).toHaveLength(1);
  });

  it("say the same for Kaizena Flow's own site", async () => {
    const f = await siteFacts(null);
    expect(f.features).toBeNull();
    expect(f.affiliate).toBeNull();
    expect(f.referral).toEqual(await referralPublicSettings());
    expect(f.platformLangs).toBe((await getPlatformLangs()).length);
    expect(f.chat).toBe((await getChatAgent(null))?.enabled ?? false);
    expect(f.modals).toBe(await usesRememberedModals(null));
    expect(f.notes).toEqual(await listCookieNotes(null));
    expect({ recommendations: f.recommendations, experiments: f.experiments, visitCounting: f.visitCounting }).toEqual({
      recommendations: false,
      experiments: false,
      visitCounting: false,
    });
  });

  it("is one statement, and siteCookies() for a plain store sends at most four", async () => {
    const [plain] = await db().execute<Row>(sql`insert into commerce.stores (slug, name) values (${`facts-plain-${run}`}, 'Plain store') returning id`);
    const id = String(plain.id);
    expect((await countStatements(() => siteFacts(id))).count).toBe(1);
    expect((await countStatements(() => siteFacts(null))).count).toBe(1);
    expect((await countStatements(() => siteCookies(id, {}))).count).toBeLessThanOrEqual(4);
  });
});
