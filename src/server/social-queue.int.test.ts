import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const { closeDb, db } = await import("@/db/client");
const { encryptSecret, parseKey } = await import("@/lib/secret-box");
const { makeStore } = await import("./trust-fixtures");
const { passMembership } = await import("./auth");
const { scheduleSocialPosts, requestSocialPost } = await import("./social-queue");
const { runSocialQueue } = await import("./social-queue-run");
const { InstagramError } = await import("./instagram");

/**
 * The posting queue (D870 S3.2), with Instagram scripted: an approved post is queued for its planned day and published by the job once its
 * moment comes, as who queued it; a refusal waits and the queue gives up after three; the AI manager's request queues one for now; a post
 * whose queuer can no longer post waits for a person. Nothing reaches Meta.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
let refuse = false;
const instagram = (async (url: string, init?: RequestInit) => {
  if (refuse) throw new InstagramError("Instagram said: (#9) Application request limit reached");
  const u = new URL(url);
  if (u.pathname.endsWith("/media") && init?.method === "POST") return { id: "17890000000000011" };
  if (u.pathname.endsWith("/media_publish")) return { id: "17890000000000012" };
  if (u.searchParams.get("fields") === "status_code") return { status_code: "FINISHED" };
  return { permalink: "https://www.instagram.com/p/queued/" };
}) as never;
const deps = { instagram, picture: async () => "https://example.com/post.jpg", wait: async () => {} };

const post = async (ref: string, day: string) => {
  const [row] = await db().execute<{ id: string }>(sql`
    insert into commerce.social_posts (store_id, channel, ref, topic, locale, caption, link, planned_for, approved_at)
    values (${store.id}::uuid, 'instagram', ${ref}, 'The workshop', 'en-GB', 'A morning at the wheel.', 'https://example.com', ${day}::date, now()) returning id`);
  return String(row.id);
};
const row = async (id: string) =>
  (await db().execute<{ scheduled_for: string | null; published_at: string | null; publish_tries: number; next_try_at: string | null; publish_problem: string | null }>(
    sql`select scheduled_for, published_at, publish_tries, next_try_at, publish_problem from commerce.social_posts where id = ${id}::uuid`,
  ))[0];

beforeAll(async () => {
  store = await makeStore("social-queue");
  await db().execute(sql`update commerce.stores set time_zone = 'Europe/Oslo' where id = ${store.id}::uuid`);
  await db().execute(sql`
    insert into commerce.instagram_accounts (store_id, ig_user_id, username, token_encrypted, token_expires_at, publish)
    values (${store.id}::uuid, '17841400000000019', 'shop', ${encryptSecret("ig-token", key)}, now() + interval '50 days', true)`);
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.social_posts where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.instagram_accounts where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("the posting queue", () => {
  it("queues an approved post for 10:00 on its planned day, and publishes it once that moment comes", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    const id = await post("queueaaaaaaa", "2030-03-04");
    expect(await scheduleSocialPosts(member, [id], true, new Date("2030-03-01T12:00:00Z"))).toEqual({ ok: true, changed: 1 });
    expect(new Date((await row(id)).scheduled_for!).toISOString()).toBe("2030-03-04T09:00:00.000Z");
    // Not yet: the day has not come.
    expect((await runSocialQueue(new Date("2030-03-04T08:00:00Z"), deps)).published).toBe(0);
    expect(await runSocialQueue(new Date("2030-03-04T09:01:00Z"), deps)).toMatchObject({ published: 1 });
    expect((await row(id)).published_at).not.toBeNull();
  });

  it("waits after a refusal, gives up after three tries, and keeps Instagram's words for a person", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    const id = await post("queuebbbbbbb", "2030-03-05");
    await scheduleSocialPosts(member, [id], true, new Date("2030-03-01T12:00:00Z"));
    refuse = true;
    const first = new Date("2030-03-05T09:01:00Z");
    expect(await runSocialQueue(first, deps)).toMatchObject({ failed: 1 });
    let r = await row(id);
    expect(r.publish_tries).toBe(1);
    expect(new Date(r.next_try_at!).toISOString()).toBe("2030-03-05T09:16:00.000Z");
    // Not before its wait is over.
    expect((await runSocialQueue(new Date("2030-03-05T09:10:00Z"), deps)).failed).toBe(0);
    await runSocialQueue(new Date("2030-03-05T09:17:00Z"), deps);
    await runSocialQueue(new Date("2030-03-05T10:18:00Z"), deps);
    r = await row(id);
    expect(r.publish_tries).toBe(3);
    expect(r.publish_problem).toContain("(#9)");
    // Given up: the queue leaves it for a person's Post now.
    expect(await runSocialQueue(new Date("2030-03-06T12:00:00Z"), deps)).toMatchObject({ published: 0, failed: 0 });
    refuse = false;
  });

  it("queues one for now on the AI manager's request, never a post nobody approved", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    const id = await post("queuecccccccc".slice(0, 12), "2030-04-01");
    expect(await requestSocialPost(member, id)).toEqual({ ok: true });
    expect(await runSocialQueue(new Date(Date.now() + 60_000), deps)).toMatchObject({ published: 1 });
    const [draft] = await db().execute<{ id: string }>(sql`
      insert into commerce.social_posts (store_id, channel, ref, topic, locale, caption, link) values (${store.id}::uuid, 'instagram', 'queuedraftaa', 'x', 'en-GB', 'Draft.', 'https://example.com') returning id`);
    expect(await requestSocialPost(member, String(draft.id))).toMatchObject({ ok: false });
  });

  it("hands a post back to a person when who queued it can no longer post for the store", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    const id = await post("queueddddddd", "2030-03-06");
    await scheduleSocialPosts(member, [id], true, new Date("2030-03-01T12:00:00Z"));
    await db().execute(sql`update commerce.social_posts set scheduled_by = null where id = ${id}::uuid`);
    expect(await runSocialQueue(new Date("2030-03-06T09:01:00Z"), deps)).toMatchObject({ failed: 1 });
    const r = await row(id);
    expect(r.scheduled_for).toBeNull();
    expect(r.publish_problem).toContain("Post it by hand");
  });
});
