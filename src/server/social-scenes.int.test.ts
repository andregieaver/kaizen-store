import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { makeStore } = await import("./trust-fixtures");
const { passMembership } = await import("./auth");
const { makeSocialScene, dropSocialScene } = await import("./social-scenes");
const { socialPicture } = await import("./social-pictures");
const { loadSharp } = await import("./sharp-load");

/**
 * A post's made scene (D870 S2.1): made by the picture model (scripted here: a library row stands in for each made picture), checked by the
 * vision check (scripted), made again at most twice while the check fails it, and given up for the drawn picture on request.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let post: string;
let made = 0;
const verdicts: string[] = [];
const connection = { provider: "openai", textModel: "fake", visionModel: "fake", usage: { storeId: null, feature: "social_posts", accountId: null } } as never;

/** Stands in for the picture model: keeps a library row as a made picture would, and says where it is. */
const make = (async () => {
  made += 1;
  const url = `https://example.com/scene-${store.id}-${made}.webp`;
  await db().execute(sql`insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes, created_by, made_by)
    values (${store.id}::uuid, 'image', ${url}, 'media', ${`scene-${made}`}, 'scene.webp', 'image/webp', 10, ${store.account.id}::uuid, 'ai_made')`);
  return { ok: true, picture: { url, thumbnailUrl: null, width: 1024, height: 1536, alt: "" } };
}) as never;

vi.mock("./ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ai")>();
  return { ...real, completeText: async () => ({ text: verdicts.shift() ?? "", region: null }) };
});

const PASS = '{"readable": true, "shows_subject": true, "whole": true, "on_brand": true, "note": ""}';
const FAIL = '{"readable": true, "shows_subject": true, "whole": true, "on_brand": false, "note": "The colours clash with the shop."}';
const deps = { make, idea: async () => "The workshop's Christmas market", check: { connection, picture: async () => ({ bytes: new Uint8Array([1]), type: "image/png" }) } };

beforeAll(async () => {
  store = await makeStore("social-scenes");
  const [row] = await db().execute<{ id: string }>(sql`
    insert into commerce.social_posts (store_id, channel, ref, topic, locale, caption, link, planned_for, approved_at)
    values (${store.id}::uuid, 'instagram', 'scenesceneaa', 'The workshop', 'en-GB', 'Come by on Saturday.', 'https://example.com', '2026-11-28', now()) returning id`);
  post = String(row.id);
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.social_posts where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.media where store_id = ${store.id}::uuid`);
  await closeDb();
});

const row = async () =>
  (await db().execute<{ scene_media_id: string | null; scene_tries: number; approved_at: string | null; check_problems: string[] }>(
    sql`select scene_media_id, scene_tries, approved_at, check_problems from commerce.social_posts where id = ${post}::uuid`,
  ))[0];

describe("a post's made scene", () => {
  it("makes a scene, takes back the post's yes, and keeps it when the check passes", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    verdicts.push(PASS);
    expect(await makeSocialScene(member, post, "https://example.com", deps)).toMatchObject({ ok: true, tries: 1, verdict: { problems: [] } });
    const r = await row();
    expect(r.scene_media_id).not.toBeNull();
    expect(r.approved_at).toBeNull();
  });

  it("makes the scene again while the check fails it, at most three times in all, then refuses", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    verdicts.push(FAIL, FAIL);
    // One try is used: two are left, and both fail.
    expect(await makeSocialScene(member, post, "https://example.com", deps)).toMatchObject({ ok: true, tries: 3, verdict: { problems: ["off_brand"] } });
    expect((await row()).check_problems).toEqual(["off_brand"]);
    expect(await makeSocialScene(member, post, "https://example.com", deps)).toMatchObject({ ok: false });
  });

  it("goes back to the drawn picture on request", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    expect(await dropSocialScene(member, post)).toEqual({ ok: true });
    expect((await row()).scene_media_id).toBeNull();
  });

  it("draws a topic's scene behind its headline, on a band of the theme's accent", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    // The post's tries are used up above: its last made scene is set back as its scene to draw it.
    await db().execute(sql`update commerce.social_posts set scene_media_id = (select id from commerce.media where store_id = ${store.id}::uuid order by created_at desc limit 1) where id = ${post}::uuid`);
    // A stand-in for the made scene: a warm gradient, served at the address the library row names.
    const sharp = await loadSharp();
    const scene = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: "#c99a6b" } })
      .composite([{ input: Buffer.from('<svg width="1024" height="1536"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3e3cf"/><stop offset="1" stop-color="#8a5a3b"/></linearGradient></defs><rect width="1024" height="1536" fill="url(#g)"/><circle cx="512" cy="620" r="230" fill="#5b3a29" opacity="0.55"/></svg>'), top: 0, left: 0 }])
      .jpeg()
      .toBuffer();
    const drawn = await socialPicture(member, post, "https://example.com", { fetch: (async () => new Response(new Uint8Array(scene), { headers: { "content-type": "image/jpeg" } })) as never });
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;
    const png = Buffer.from(await drawn.response.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    // The scene fills the picture: its top is the scene's light colour, not the theme's dark background.
    const { data } = await sharp(png).extract({ left: 540, top: 20, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(200);
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync("test-results", { recursive: true });
    writeFileSync("test-results/social-scene-topic.png", png);
  });
});
