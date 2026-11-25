import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { makeStore } = await import("./trust-fixtures");
const { passMembership } = await import("./auth");
const cal = await import("./social-calendar");

/**
 * The social calendar (D870 S2.4): drafts planned for a day show on the store's two weeks; a person approves one or a week's, takes it back,
 * and changes a draft's words, which the claims filter reads and which takes back the yes. Another store's posts are never touched.
 */

type Store = Awaited<ReturnType<typeof makeStore>>;
let mine: Store;
let other: Store;
let a: string;
let b: string;
let theirs: string;

const post = async (store: Store, ref: string, channel: string, day: string) => {
  const [row] = await db().execute<{ id: string }>(sql`
    insert into commerce.social_posts (store_id, channel, ref, topic, locale, caption, link, planned_for)
    values (${store.id}::uuid, ${channel}, ${ref}, 'The workshop', 'en-GB', 'A morning in the workshop.', 'https://example.com', ${day}::date) returning id`);
  return String(row.id);
};
const member = async (store: Store) => (await passMembership(store.slug, store.account.id))!;

beforeAll(async () => {
  [mine, other] = await Promise.all([makeStore("calendar-mine"), makeStore("calendar-other")]);
  a = await post(mine, "calendaraaaa", "instagram", "2026-11-26");
  b = await post(mine, "calendarbbbb", "facebook", "2026-11-28");
  theirs = await post(other, "calendarcccc", "instagram", "2026-11-26");
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.social_posts where store_id in (${mine.id}::uuid, ${other.id}::uuid)`);
  await closeDb();
});

describe("the social calendar", () => {
  it("shows the drafts planned for the two weeks beside the adviser's plan", async () => {
    const weeks = await cal.calendarOf(mine.id, "2026-11-25", [{ day: "2026-11-26", channel: "instagram", productId: null, idea: "The workshop at work." }]);
    const items = weeks.flatMap((w) => w.days.flatMap((d) => d.items));
    expect(items.map((it) => [it.day, it.channel, it.draft?.id, it.idea])).toEqual([
      ["2026-11-26", "instagram", a, "The workshop at work."],
      ["2026-11-28", "facebook", b, ""],
    ]);
    expect(weeks[0].toApprove.map((d) => d.id).sort()).toEqual([a, b].sort());
  });

  it("approves the week's posts at once, never another store's, and takes one yes back", async () => {
    const m = await member(mine);
    expect(await cal.approveSocialPosts(m, [a, b, theirs], true)).toEqual({ ok: true, changed: 2 });
    const [t] = await db().execute<{ approved_at: string | null }>(sql`select approved_at from commerce.social_posts where id = ${theirs}::uuid`);
    expect(t.approved_at).toBeNull();
    expect((await cal.calendarOf(mine.id, "2026-11-25", []))[0].toApprove).toEqual([]);
    expect(await cal.approveSocialPosts(m, [b], false)).toEqual({ ok: true, changed: 1 });
    expect((await cal.calendarOf(mine.id, "2026-11-25", []))[0].toApprove.map((d) => d.id)).toEqual([b]);
  });

  it("changes a draft's words, takes back its yes, and refuses words that make a claim", async () => {
    const m = await member(mine);
    expect(await cal.editSocialPost(m, { id: a, caption: "Only today: 50% off everything!" })).toMatchObject({ ok: false });
    expect(await cal.editSocialPost(m, { id: theirs, caption: "Hello." })).toMatchObject({ ok: false, problem: "That post is not this store's." });
    expect(await cal.editSocialPost(m, { id: a, caption: "A slow morning at the wheel." })).toEqual({ ok: true });
    const [row] = await db().execute<{ caption: string; approved_at: string | null; edited_at: string | null }>(
      sql`select caption, approved_at, edited_at from commerce.social_posts where id = ${a}::uuid`,
    );
    expect(row).toMatchObject({ caption: "A slow morning at the wheel.", approved_at: null });
    expect(row.edited_at).not.toBeNull();
  });
});
