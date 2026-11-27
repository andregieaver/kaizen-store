import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.LINKEDIN_CLIENT_ID = "77linkedintest";
process.env.LINKEDIN_CLIENT_SECRET = "linkedin-test-secret";
process.env.LINKEDIN_PAGES = "1";

const { closeDb, db } = await import("@/db/client");
const { makeStore } = await import("./trust-fixtures");
const { passMembership } = await import("./auth");
const { connectLinkedin, chooseLinkedinPlace, disconnectLinkedin, linkedinTarget, linkedinView } = await import("./linkedin");
const { publishSocialPost, publishTargets } = await import("./social-publish");

/**
 * LinkedIn (D870 S3.6), with LinkedIn scripted: connecting keeps the tokens encrypted and offers the member's profile and the Pages they
 * administer, a Page chosen is posted to with the post's picture uploaded first, and a token without a refresh token is used while it lasts,
 * then asks to connect again. Nothing reaches LinkedIn.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
const uploads: Record<string, string>[] = [];
const linkedin = (async (url: string, init?: RequestInit) => {
  calls.push({ url, body: String(init?.body ?? ""), headers: (init?.headers ?? {}) as Record<string, string> });
  const path = new URL(url).pathname;
  if (path === "/oauth/v2/accessToken") return { json: { access_token: "AQX", expires_in: 5184000, scope: "openid,profile,w_member_social,r_organization_admin,w_organization_social" }, restliId: null };
  if (path === "/v2/userinfo") return { json: { sub: "782bbtaQ", name: "Kari Nordmann" }, restliId: null };
  if (path === "/rest/organizationAcls") return { json: { elements: [{ organization: "urn:li:organization:2414183", state: "APPROVED" }] }, restliId: null };
  if (path === "/rest/organizations/2414183") return { json: { localizedName: "The Shop" }, restliId: null };
  if (path === "/rest/images") return { json: { value: { uploadUrl: "https://www.linkedin.com/dms-uploads/abc", image: "urn:li:image:C4E10AQ" } }, restliId: null };
  if (path === "/rest/posts") return { json: {}, restliId: "urn:li:share:7300000000000000001" };
  throw new Error(`unexpected ${url}`);
}) as never;
const deps = {
  linkedin,
  picture: async () => "https://example.com/post.jpg",
  videoBytes: async () => new Uint8Array([255, 216, 255, 224]),
  upload: async (_url: string, _bytes: Uint8Array, headers: Record<string, string>) => (uploads.push(headers), true),
};

beforeAll(async () => {
  store = await makeStore("linkedin");
}, 60_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.social_posts where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.linkedin_accounts where store_id = ${store.id}::uuid`);
  await closeDb();
});

describe("LinkedIn", () => {
  it("connects, offers the profile and the Page, and posts to the Page with its picture", async () => {
    const member = (await passMembership(store.slug, store.account.id))!;
    expect(await connectLinkedin(store.account.id, store.id, new URLSearchParams({ code: "abc" }), linkedin)).toEqual({
      choose: [
        { urn: "urn:li:person:782bbtaQ", name: "Kari Nordmann" },
        { urn: "urn:li:organization:2414183", name: "The Shop" },
      ],
    });
    const [row] = await db().execute<{ access: string }>(sql`select access_token_encrypted as access from commerce.linkedin_accounts where store_id = ${store.id}::uuid`);
    expect(row.access).not.toContain("AQX");
    expect(await chooseLinkedinPlace(store.account.id, store.id, "urn:li:organization:999")).toBe(false);
    expect(await chooseLinkedinPlace(store.account.id, store.id, "urn:li:organization:2414183")).toBe(true);
    expect(await linkedinView(store.id)).toMatchObject({ state: "ready", place: "The Shop", page: true, publish: true });
    expect((await publishTargets(member.store)).linkedin).toBe(true);

    const [post] = await db().execute<{ id: string }>(sql`
      insert into commerce.social_posts (store_id, channel, ref, topic, locale, title, caption, hashtags, link, approved_at)
      values (${store.id}::uuid, 'linkedin', 'linkedinpost', 'Bowls', 'en-GB', '', 'Glazed in small batches.', '{ceramics}', 'https://example.com/p', now()) returning id`);
    expect(await publishSocialPost(member, String(post.id), "https://example.com", deps)).toEqual({ ok: true, url: "https://www.linkedin.com/feed/update/urn:li:share:7300000000000000001/" });
    expect(uploads[0]).toMatchObject({ "Content-Type": "image/jpeg", Authorization: "Bearer AQX" });
    const made = calls.find((c) => c.url.endsWith("/rest/posts"))!;
    expect(made.headers["LinkedIn-Version"]).toMatch(/^[0-9]{6}$/);
    expect(JSON.parse(made.body)).toMatchObject({ author: "urn:li:organization:2414183", visibility: "PUBLIC", content: { media: { id: "urn:li:image:C4E10AQ" } } });
    expect(JSON.parse(made.body).commentary).toContain("Glazed in small batches.");
  });

  it("uses a token without a refresh token while it lasts, then asks to connect again", async () => {
    await db().execute(sql`update commerce.linkedin_accounts set token_expires_at = now() + interval '2 days' where store_id = ${store.id}::uuid`);
    expect(await linkedinTarget(store.id, new Date(), linkedin)).toEqual({ author: "urn:li:organization:2414183", token: "AQX" });
    expect((await linkedinView(store.id)).state === "ready" && (await linkedinView(store.id) as { endsAt: string | null }).endsAt).toBeTruthy();
    await db().execute(sql`update commerce.linkedin_accounts set token_expires_at = now() - interval '1 minute' where store_id = ${store.id}::uuid`);
    expect(await linkedinTarget(store.id, new Date(), linkedin)).toEqual({ problem: "The LinkedIn connection has run out. Connect it again." });
  });

  it("disconnects", async () => {
    await disconnectLinkedin(store.account.id, store.id);
    expect(await linkedinView(store.id)).toEqual({ state: "none" });
  });
});
