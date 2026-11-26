import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { closeDb, db } = await import("@/db/client");
const { encryptSecret, parseKey } = await import("@/lib/secret-box");
const { makeStore } = await import("./trust-fixtures");
const { passMembership } = await import("./auth");
const { saveSocialRules, socialRulesOf, queueByRules, socialRulesAutopilotProblem } = await import("./social-rules");
const { scheduleSocialPosts } = await import("./social-queue");
const { approveSocialPosts } = await import("./social-calendar");
const { runSocialQueue } = await import("./social-queue-run");

/**
 * *Post on its own within my rules* (D870 S3.3), with Instagram scripted: the owner's switch, the queue approving what the rules allow (a
 * checked picture, no person's hold, a product on sale), posting as the autopilot within the posts a day and outside the quiet hours, and
 * switching off handing the rules' posts back. Nothing reaches Meta.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
const instagram = (async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  if (u.pathname.endsWith("/media") && init?.method === "POST") return { id: "17890000000000021" };
  if (u.pathname.endsWith("/media_publish")) return { id: "17890000000000022" };
  if (u.searchParams.get("fields") === "status_code") return { status_code: "FINISHED" };
  return { permalink: "https://www.instagram.com/p/rules/" };
}) as never;
const deps = { instagram, picture: async () => "https://example.com/post.jpg", wait: async () => {} };

/** A draft planned for a day; checked (passed) unless said. */
const draft = async (ref: string, day: string, opts: { checked?: boolean; problems?: string[]; productId?: string } = {}) => {
  const [row] = await db().execute<{ id: string }>(sql`
    insert into commerce.social_posts (store_id, channel, ref, topic, locale, caption, link, planned_for, checked_at, check_problems, product_id)
    values (${store.id}::uuid, 'instagram', ${ref}, 'The workshop', 'en-GB', 'A morning at the wheel.', 'https://example.com', ${day}::date,
      ${opts.checked === false ? null : new Date().toISOString()}::timestamptz, ${`{${(opts.problems ?? []).join(",")}}`}::text[], ${opts.productId ?? null}::uuid) returning id`);
  return String(row.id);
};
const row = async (id: string) =>
  (await db().execute<{ approved_at: string | null; rules_queued_at: string | null; scheduled_for: string | null; published_at: string | null; next_try_at: string | null; held_at: string | null; publish_problem: string | null }>(
    sql`select approved_at, rules_queued_at, scheduled_for, published_at, next_try_at, held_at, publish_problem from commerce.social_posts where id = ${id}::uuid`,
  ))[0];
const on = { on: true, postsPerDay: 1, quietFrom: 21, quietTo: 8 };
/** A fixed time outside the quiet hours, so the test never depends on the hour it runs at. */
const NOON = new Date("2030-05-06T12:00:00Z");

beforeAll(async () => {
  store = await makeStore("social-rules");
  await db().execute(sql`update commerce.stores set time_zone = 'Europe/Oslo' where id = ${store.id}::uuid`);
  await db().execute(sql`
    insert into commerce.instagram_accounts (store_id, ig_user_id, username, token_encrypted, token_expires_at, publish)
    values (${store.id}::uuid, '17841400000000029', 'shop', ${encryptSecret("ig-token", key)}, now() + interval '50 days', true)`);
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.social_posts where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.products where store_id = ${store.id}::uuid and handle like 'rules-%'`);
  await db().execute(sql`delete from commerce.instagram_accounts where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.autopilot_settings where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("posting within the owner's rules", () => {
  it("is the owner's alone, off by default, and kept with who switched it on", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    expect((await socialRulesOf(store.id)).on).toBe(false);
    expect(await saveSocialRules({ ...member, role: "admin" } as typeof member, on)).toMatchObject({ ok: false });
    expect(await saveSocialRules(member, on)).toMatchObject({ ok: true, rules: { on: true, by: store.account.id } });
  });

  it("queues what the rules allow, and leaves an unchecked, failed, held or off-sale post for a person", async () => {
    const [product] = await db().execute<{ id: string }>(sql`
      insert into commerce.products (store_id, handle, tax_code, status) values (${store.id}::uuid, 'rules-hidden', 'txcd_99999999', 'draft') returning id`);
    const ok = await draft("rulesokaaaaa", "2030-05-02");
    const unchecked = await draft("rulesuncheck", "2030-05-02", { checked: false });
    const failed = await draft("rulesfailedd", "2030-05-02", { problems: ["cut_off"] });
    const held = await draft("rulesheldddd", "2030-05-02");
    await db().execute(sql`update commerce.social_posts set held_at = now() where id = ${held}::uuid`);
    const hidden = await draft("ruleshiddenn", "2030-05-02", { productId: String(product.id) });
    const later = await draft("ruleslaterrr", "2030-05-09");

    expect(await queueByRules(new Date("2030-05-01T12:00:00Z"))).toBe(1);
    const queued = await row(ok);
    expect(queued.rules_queued_at).not.toBeNull();
    // 10:00 in Oslo on its day (summer time).
    expect(new Date(queued.scheduled_for!).toISOString()).toBe("2030-05-02T08:00:00.000Z");
    for (const id of [unchecked, failed, held, hidden, later]) expect((await row(id)).approved_at).toBeNull();

    expect(await runSocialQueue(new Date("2030-05-02T08:01:00Z"), deps)).toMatchObject({ published: 1 });
    expect((await row(ok)).published_at).not.toBeNull();
    const [audit] = await db().execute<{ acted_by: string }>(sql`
      select acted_by from commerce.audit_log where store_id = ${store.id}::uuid and action = 'store.social_post_published' order by created_at desc limit 1`);
    expect(audit?.acted_by).toBe("autopilot");
  });

  it("waits for the next day past the rules' posts a day, and out of the quiet hours", async () => {
    const second = await draft("rulessecondd", "2030-05-02");
    await queueByRules(new Date("2030-05-02T08:05:00Z"));
    expect((await row(second)).rules_queued_at).not.toBeNull();
    expect(await runSocialQueue(new Date("2030-05-02T08:10:00Z"), deps)).toMatchObject({ published: 0, waiting: 1 });

    // 22:30 in Oslo is quiet: it waits until 08:00.
    await db().execute(sql`update commerce.social_posts set next_try_at = null where id = ${second}::uuid`);
    await db().execute(sql`update commerce.social_posts set published_at = now() - interval '2 days' where store_id = ${store.id}::uuid and published_at is not null`);
    expect(await runSocialQueue(new Date("2030-05-03T20:30:00Z"), deps)).toMatchObject({ waiting: 1 });
    expect(new Date((await row(second)).next_try_at!).toISOString()).toBe("2030-05-04T06:00:00.000Z");
  });

  it("sends a post back to a person when its product went off sale before it was due", async () => {
    const [product] = await db().execute<{ id: string }>(sql`
      insert into commerce.products (store_id, handle, tax_code, status) values (${store.id}::uuid, 'rules-gone', 'txcd_99999999', 'draft') returning id`);
    const id = await draft("rulesgoneeee", "2030-05-06");
    await db().execute(sql`update commerce.social_posts set approved_at = now(), rules_queued_at = now(), scheduled_for = '2030-05-06T08:00:00Z', scheduled_by = ${store.account.id}::uuid, product_id = ${String(product.id)}::uuid where id = ${id}::uuid`);
    expect(await runSocialQueue(new Date("2030-05-06T08:01:00Z"), deps)).toMatchObject({ failed: 1 });
    const r = await row(id);
    expect(r.approved_at).toBeNull();
    expect(r.held_at).not.toBeNull();
    expect(r.publish_problem).toContain("not on sale");
  });

  it("leaves a post a person took back, and lets the autopilot ask for one only within the rules", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    const id = await draft("rulestakenbk", "2030-05-07");
    await queueByRules(new Date("2030-05-06T12:00:00Z"));
    expect((await row(id)).rules_queued_at).not.toBeNull();
    expect(await scheduleSocialPosts(member, [id], false)).toMatchObject({ changed: 1 });
    const r = await row(id);
    expect(r.approved_at).toBeNull();
    expect(r.held_at).not.toBeNull();
    await queueByRules(new Date("2030-05-06T12:05:00Z"));
    expect((await row(id)).approved_at).toBeNull();
    // A person's own yes takes it over.
    await approveSocialPosts(member, [id], true);
    expect((await row(id)).held_at).toBeNull();

    expect(await socialRulesAutopilotProblem({ id: store.id, timeZone: "UTC" }, id, NOON)).toBeNull();
    const unchecked = await draft("rulesautoask", "2030-05-07", { checked: false });
    expect(await socialRulesAutopilotProblem({ id: store.id, timeZone: "UTC" }, unchecked, NOON)).toContain("not been checked");
    // In the quiet hours (21:00 to 08:00 here) it asks, whatever the post.
    expect(await socialRulesAutopilotProblem({ id: store.id, timeZone: "UTC" }, id, new Date("2030-05-06T22:30:00Z"))).toContain("quiet hours");
  });

  it("switched off, hands every post the rules queued back to a person at once", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    const id = await draft("rulesoffffff", "2030-05-08");
    await queueByRules(new Date("2030-05-07T12:00:00Z"));
    expect((await row(id)).rules_queued_at).not.toBeNull();
    expect(await saveSocialRules(member, { ...on, on: false })).toMatchObject({ ok: true, handedBack: 1 });
    const r = await row(id);
    expect(r.approved_at).toBeNull();
    expect(r.scheduled_for).toBeNull();
    expect(await socialRulesAutopilotProblem({ id: store.id, timeZone: "UTC" }, id, NOON)).toContain("off");
  });
});
