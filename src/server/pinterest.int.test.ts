import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.PINTEREST_APP_ID = "1500000";
process.env.PINTEREST_APP_SECRET = "pinterest-test-secret";

const { closeDb, db } = await import("@/db/client");
const { makeStore } = await import("./trust-fixtures");
const { passMembership } = await import("./auth");
const { connectPinterest, choosePinterestBoard, disconnectPinterest, pinterestTarget, pinterestView } = await import("./pinterest");
const { publishSocialPost, publishTargets } = await import("./social-publish");

/**
 * Pinterest (D870 S3.4), with Pinterest scripted: connecting keeps the tokens encrypted and lists the boards, the owner chooses one, an
 * approved Pinterest post is pinned there with its link, and a token near its end is renewed before it is used. Nothing reaches Pinterest.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const calls: { path: string; body: string }[] = [];
let renewals = 0;
const pinterest = (async (path: string, init?: RequestInit) => {
  calls.push({ path, body: String(init?.body ?? "") });
  if (path === "/oauth/token") {
    const body = new URLSearchParams(String(init?.body));
    if (body.get("grant_type") === "refresh_token") renewals += 1;
    return { access_token: `pina_${renewals}`, refresh_token: "pinr_1", expires_in: 2592000, refresh_token_expires_in: 31536000, scope: "boards:read,pins:read,pins:write,user_accounts:read" };
  }
  if (path === "/user_account") return { username: "theshop" };
  if (path.startsWith("/boards")) return { items: [{ id: "549755885175", name: "Kitchen", privacy: "PUBLIC" }, { id: "549755885176", name: "Gifts", privacy: "PUBLIC" }] };
  if (path === "/pins") return { id: "813744226420795884" };
  throw new Error(`unexpected ${path}`);
}) as never;

beforeAll(async () => {
  store = await makeStore("pinterest");
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.social_posts where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.pinterest_accounts where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("Pinterest", () => {
  it("connects, keeps the tokens encrypted, and pins to the board the owner chose", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    expect(await connectPinterest(store.account.id, store.id, new URLSearchParams({ code: "abc" }), pinterest)).toEqual({
      choose: [
        { id: "549755885175", name: "Kitchen" },
        { id: "549755885176", name: "Gifts" },
      ],
    });
    const [row] = await db().execute<{ access: string }>(sql`select access_token_encrypted as access from commerce.pinterest_accounts where store_id = ${store.id}::uuid`);
    expect(row.access).not.toContain("pina_");
    expect((await pinterestView(store.id)).state).toBe("choose");
    expect(await choosePinterestBoard(store.account.id, store.id, "999")).toBe(false);
    expect(await choosePinterestBoard(store.account.id, store.id, "549755885176")).toBe(true);
    expect(await pinterestView(store.id)).toMatchObject({ state: "ready", username: "theshop", board: "Gifts", publish: true });
    expect((await publishTargets(member.store)).pinterest).toBe(true);

    const [post] = await db().execute<{ id: string }>(sql`
      insert into commerce.social_posts (store_id, channel, ref, topic, locale, title, caption, hashtags, link, approved_at)
      values (${store.id}::uuid, 'pinterest', 'pinpostaaaaa', 'Bowls', 'en-GB', 'Bowls from above', 'Glazed in small batches.', '{ceramics}', 'https://example.com/p?utm_source=pinterest', now()) returning id`);
    const result = await publishSocialPost(member, String(post.id), "https://example.com", { pinterest, picture: async () => "https://example.com/pin.jpg" });
    expect(result).toEqual({ ok: true, url: "https://www.pinterest.com/pin/813744226420795884/" });
    const pin = JSON.parse(calls.find((c) => c.path === "/pins")!.body);
    expect(pin).toMatchObject({ board_id: "549755885176", title: "Bowls from above", link: "https://example.com/p?utm_source=pinterest", media_source: { url: "https://example.com/pin.jpg" } });
  });

  it("renews the access token before it ends, and asks to connect again once the refresh token has", async () => {
    await db().execute(sql`update commerce.pinterest_accounts set token_expires_at = now() + interval '1 day' where store_id = ${store.id}::uuid`);
    expect(await pinterestTarget(store.id, new Date(), pinterest)).toEqual({ boardId: "549755885176", token: "pina_1" });
    expect(renewals).toBe(1);
    const [row] = await db().execute<{ days: number }>(sql`select extract(day from token_expires_at - now())::int as days from commerce.pinterest_accounts where store_id = ${store.id}::uuid`);
    expect(row.days).toBeGreaterThanOrEqual(29);
    await db().execute(sql`update commerce.pinterest_accounts set token_expires_at = now(), refresh_expires_at = now() - interval '1 minute' where store_id = ${store.id}::uuid`);
    expect(await pinterestTarget(store.id, new Date(), pinterest)).toEqual({ problem: "The Pinterest connection has run out. Connect it again." });
  });

  it("disconnects", async () => {
    await disconnectPinterest(store.account.id, store.id);
    expect(await pinterestView(store.id)).toEqual({ state: "none" });
  });
});
