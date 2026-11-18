import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { HOUSE_SLUG } from "@/lib/house-routing";
import { newPageContent, type PageContent } from "@/lib/page-content";
import { newBlock, newRow } from "@/lib/page-rows";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { actingAs } = await import("./actor");
const { runOwnerTool } = await import("./owner-tools");
const { experimentTraffic } = await import("./experiment-traffic");
const { houseSignupRate } = await import("./house-signups");
const { dropGoal, goalFigures, listGoals, setGoal } = await import("./autopilot-goals");
const { setSignupGoalFrom } = await import("./autopilot-actions");
const { autopilotOverview } = await import("./autopilot-overview");
const pages = await import("./pages");
const stores = await import("./stores");
const admin_ = await import("./experiment-admin");
const { makeAccount, makeStore } = await import("./trust-fixtures");

type Row = Record<string, unknown>;
type Store = NonNullable<Awaited<ReturnType<typeof stores.currentStore>>>;

/**
 * Kaizena Flow's own site tested on its sign-ups (ecosystem plan E5.3, D757), on the real house store (`stores.house`, D466): its sign-ups per
 * visit counted from its visits and the sign-up form's requests, the autopilot's tests of its pages sized from them and counting them, and the
 * goal that aims at them, set on Kaizena Flow's own Autopilot or its store's and refused on any other store. The house store counts visits
 * here through the store object it is handed (the seed leaves it off), so nothing global is switched; every row made is removed after.
 */

const run = randomUUID().slice(0, 8);
const MARK = `e53-${run}`;
const EMAILS = `${MARK}-%@signups.invalid`;
/** A day far from any other test's rows: the window counted is the 30 whole days before it. */
const LATER = new Date("2031-03-15T12:00:00Z");
const SLUG = `${MARK}-pricing`;

let house: Store;
let counting: Store;
let admin: Awaited<ReturnType<typeof makeAccount>>;
let other: Awaited<ReturnType<typeof makeStore>>;
const made: { experiments: string[]; pages: string[]; goals: string[] } = { experiments: [], pages: [], goals: [] };

/** Visits of a store on a day, landing on a page. */
const visits = (storeId: string, day: string, n: number, path = `/no/${SLUG}`) =>
  db().execute(sql`
    insert into commerce.visits (store_id, day, visitor, market_code, device, channel, landing_path, first_seen, last_seen)
    select ${storeId}::uuid, ${day}::date, substr(md5(${`${MARK}-${day}-`} || g), 1, 24), 'NO', 'mobile', 'direct', ${path}, ${day}::date + time '10:00', ${day}::date + time '10:00'
    from generate_series(1, ${n}) g
  `);

/** Requests to Kaizena Flow, sent from its sign-up form (the terms accepted) unless `terms` is false. */
const requests = (at: string, n: number, terms = true) =>
  db().execute(sql`
    insert into commerce.access_requests (email, name, store_name, status, terms_accepted_at, created_at)
    select ${`${MARK}-`} || ${terms ? "t" : "n"} || g || ${`-${at.slice(0, 10)}@signups.invalid`}, 'Test', 'Test', 'declined', ${terms ? sql`${at}::timestamptz` : sql`null`}, ${at}::timestamptz
    from generate_series(1, ${n}) g
  `);

function pageWith(slug: string, heading: string): PageContent {
  const content = newPageContent();
  const row = newRow("1", () => `r-${randomUUID().slice(0, 8)}`);
  const block = newBlock("heading", () => `h-${randomUUID().slice(0, 8)}`);
  if (block.type !== "heading") throw new Error("not a heading");
  block.text = heading;
  block.level = 1;
  row.columns[0].blocks.push(block);
  return { ...content, title: heading, slug, rows: [row] };
}

beforeAll(async () => {
  const found = await stores.currentStore(HOUSE_SLUG);
  if (!found?.house) throw new Error("The database has no Kaizena Flow store.");
  house = found;
  counting = { ...found, visitCounting: true };
  // Only platform admins work in Kaizena Flow's own store (D466).
  admin = await makeAccount(`${MARK}-admin`, { platformAdmin: true });
  other = await makeStore(`${MARK}-other`);
});

afterAll(async () => {
  // A test that has run is kept until it is discarded (D148): stopped and discarded as a person would, then removed with its versions.
  for (const id of made.experiments) {
    const versions = await db().execute<Row>(sql`select page_id from commerce.experiment_variants where experiment_id = ${id}::uuid and page_id is not null`);
    await admin_.stopExperiment(admin, house.id, id, "person");
    await admin_.discardExperiment(admin, house.id, id);
    await db().execute(sql`delete from commerce.experiments where id = ${id}::uuid`);
    for (const v of versions) await db().execute(sql`delete from commerce.pages where store_id = ${house.id}::uuid and id = ${String(v.page_id)}::uuid`);
  }
  for (const id of made.goals) await db().execute(sql`delete from commerce.assistant_goals where id = ${id}::uuid`);
  await db().execute(sql`delete from commerce.pages where store_id = ${house.id}::uuid and slug like ${`${MARK}%`}`);
  await db().execute(sql`delete from commerce.visits where store_id = ${house.id}::uuid and landing_path = ${`/no/${SLUG}`}`);
  await db().execute(sql`delete from commerce.consents where store_id = ${house.id}::uuid and version = ${MARK}`);
  await db().execute(sql`delete from commerce.access_requests where email like ${EMAILS}`);
  await closeDb();
});

describe("Kaizena Flow's sign-ups per visit (E5.3, D757)", () => {
  it("counts the sign-up form's requests against the site's visits, over the 30 whole days before today", async () => {
    await visits(house.id, "2031-03-14", 400);
    await visits(house.id, "2031-02-20", 100);
    await requests("2031-03-14T10:00:00Z", 20);
    await requests("2031-02-20T10:00:00Z", 5);
    // Not counted: a request made another way (no terms accepted), one sent today, and one before the window.
    await requests("2031-03-14T11:00:00Z", 3, false);
    await requests("2031-03-15T09:00:00Z", 4);
    await requests("2031-01-10T09:00:00Z", 6);

    expect(await houseSignupRate(LATER, counting)).toEqual({ percent: 5, visits: 500, signups: 25 });
    expect(await houseSignupRate(LATER, house)).toMatchObject({ percent: null, reason: "not_counting" });
    // The autopilot's tests are sized from it: Kaizena Flow's store sells nothing, so sign-ups are all it is tested on.
    const facts = await experimentTraffic(counting, [], LATER);
    expect(facts.baselines).toEqual({ orders: null, cart: null, checkout: null, signup: 0.05 });
    // The goal measures it, on Kaizena Flow's own store; another store has no sign-ups to Kaizena Flow.
    expect((await goalFigures(counting, LATER)).signupRate30d).toBe(5);
    const theirs = await stores.currentStore(other.slug);
    await visits(other.id, "2031-03-14", 50, "/no/om");
    expect((await experimentTraffic({ ...theirs!, visitCounting: true }, [], LATER)).baselines.signup).toBeNull();
    const figures = await goalFigures(theirs!, LATER);
    expect(figures.signupRate30d).toBeNull();
    expect(figures.missing.signup_rate_30d).toContain("Only Kaizena Flow's own store");
  });

  it("is a goal set on Kaizena Flow's own store's Autopilot, in words, and refused on any other store", async () => {
    const before = await autopilotOverview({ account: admin, store: counting });
    expect(before.signups).not.toBeNull();
    expect(await setSignupGoalFrom({ account: admin, store: counting }, formWith({ percent: "4,5" }))).toEqual({ status: "ok", messages: [] });
    const goal = (await listGoals({ account: admin, store: counting })).find((g) => g.targets.some((t) => t.kind === "signup_rate_30d"));
    expect(goal).toMatchObject({ title: "More sign-ups to Kaizena Flow", targets: [{ kind: "signup_rate_30d", percent: 4.5 }] });
    made.goals.push(goal!.id);
    // While a goal aims at it, the page does not offer it again.
    expect((await autopilotOverview({ account: admin, store: counting })).signups).toBeNull();
    await dropGoal({ account: admin, store: counting }, goal!.id);

    const theirs = (await stores.currentStore(other.slug))!;
    await expect(setGoal({ account: other.account, store: theirs }, { title: "Sign-ups", targets: [{ kind: "signup_rate_30d", percent: 2 }] })).rejects.toThrow(
      "Only Kaizena Flow and its own store count sign-ups to Kaizena Flow.",
    );
    expect(await setSignupGoalFrom({ account: other.account, store: theirs }, formWith({ percent: "2" }))).toMatchObject({ status: "error" });
    expect(await setSignupGoalFrom({ account: admin, store: counting }, formWith({ percent: "0" }))).toEqual({ status: "error", messages: ["Give a share of visits between 0.1 and 100 %."] });
    expect((await autopilotOverview({ account: other.account, store: theirs })).signups).toBeNull();
  });

  it("leads Kaizena Flow's own Autopilot to its site's store, whose tests it lists", async () => {
    const platform = await autopilotOverview({ account: admin, store: null });
    expect(platform.site).toMatchObject({ slug: HOUSE_SLUG });
    expect(platform.tests).toBeNull();
  });

  it("tests the autopilot's change to a busy page of the site on its sign-ups, instead of publishing it", async () => {
    const saved = await pages.savePage(admin, house.id, null, pageWith(SLUG, "Pricing as it is"), { publish: true, fonts: async () => ({ ok: true }) });
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    made.pages.push(saved.id);
    // Two days ago 5,000 visits began on the page and one in ten ended in a sign-up; 25 cookie choices, 15 of them accepting statistics.
    const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    await visits(house.id, day, 5000);
    await requests(`${day}T10:00:00Z`, 500);
    await db().execute(sql`
      insert into commerce.consents (store_id, visitor, choices, version)
      select ${house.id}::uuid, gen_random_uuid(), jsonb_build_object('necessary', true, 'statistics', g <= 15), ${MARK} from generate_series(1, 25) g
    `);
    const page = await pages.getPageForEdit(house.id, saved.id, "page");
    const rows = page!.draft.rows.map((r) => ({ ...r, columns: r.columns.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.type === "heading" ? { ...b, text: "A clearer price" } : b)) })) }));
    const draft = await pages.savePage(admin, house.id, saved.id, { ...page!.draft, rows }, { publish: false, fonts: async () => ({ ok: true }) });
    if (!draft.ok) throw new Error(draft.problems.join(" "));

    const ctx = { account: admin, store: counting, invalidate: () => {}, holder: { role: "owner" as const } };
    const answer = (await actingAs("autopilot", () => runOwnerTool(ctx, "publish_page", { page: SLUG, type: "page" }))) as { done: string };
    expect(answer.done).toContain("Not published yet");
    const [t] = await db().execute<Row>(sql`
      select t.experiment_id, t.goal, t.days, e.primary_goal from commerce.autopilot_tests t join commerce.experiments e on e.id = t.experiment_id
      where t.store_id = ${house.id}::uuid and t.page_id = ${saved.id}::uuid
    `);
    made.experiments.push(String(t.experiment_id));
    expect(t).toMatchObject({ goal: "signup", primary_goal: "signup" });
    expect(Number(t.days)).toBeGreaterThanOrEqual(14);
    expect(Number(t.days)).toBeLessThanOrEqual(21);
    // The page stays as it was until the test answers for the change.
    const [live] = await db().execute<Row>(sql`select published from commerce.pages where id = ${saved.id}::uuid`);
    expect(JSON.stringify(live.published)).toContain("Pricing as it is");
  });
});

function formWith(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(values)) form.set(k, v);
  return form;
}
