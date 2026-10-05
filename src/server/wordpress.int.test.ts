import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { challengeOf, CALLS_PER_HOUR, readApproval } from "@/lib/wordpress";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));

const wp = await import("./wordpress");
const stores = await import("./stores");
const { GET: storesRoute } = await import("@/app/api/wordpress/v1/stores/route");
const { GET: viewRoute } = await import("@/app/api/wordpress/v1/stores/[slug]/view/route");
const { GET: termsRoute } = await import("@/app/api/wordpress/v1/stores/[slug]/terms/route");
const { GET: pickRoute } = await import("@/app/api/wordpress/v1/stores/[slug]/products/route");
const { POST: tokenRoute } = await import("@/app/api/wordpress/v1/token/route");
const { GET: connectionRoute, DELETE: disconnectRoute } = await import("@/app/api/wordpress/v1/connection/route");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const SITE = "https://blog.example.com";
let accountId = "";
let otherAccountId = "";
let slug = "";
let otherSlug = "";

const secret = () => randomBytes(32).toString("base64url");

/** What a plugin does: asks, the owner approves, the plugin swaps the code. */
async function connect(account = accountId, site = SITE) {
  const verifier = secret();
  const read = readApproval({ site, return: `${site}/wp-admin/admin.php?page=kaizen`, state: secret(), challenge: challengeOf(verifier), name: "Blog" });
  if (!read.ok) throw new Error(read.reason);
  const code = await wp.startApproval(account, read.request);
  return { code, verifier, site };
}

async function tokenFor(account = accountId) {
  const { code, verifier, site } = await connect(account);
  const swapped = await wp.exchangeCode({ code, verifier, site });
  if (!swapped.ok) throw new Error("not swapped");
  return swapped;
}

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
const ask = (path: string, token: string) => new Request(`https://kaizen.test${path}`, bearer(token));

async function newStore(name: string) {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'Kari', 'Kaffe') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Kaffe', null)`);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  return { accountId: String(account.id), slug: name };
}

beforeAll(async () => {
  ({ accountId, slug } = await newStore(`wp-a-${run}`));
  ({ accountId: otherAccountId, slug: otherSlug } = await newStore(`wp-b-${run}`));
  await db().execute(sql`update commerce.stores set status = 'active' where slug in (${slug}, ${otherSlug})`);
});

afterAll(async () => {
  await closeDb();
});

describe("connecting a site", () => {
  it("swaps an approval's code for a token, once, for the verifier's holder and the approved site", async () => {
    const { code, verifier, site } = await connect();
    expect(await wp.exchangeCode({ code, verifier: secret(), site })).toEqual({ ok: false, reason: "invalid" });
    expect(await wp.exchangeCode({ code, verifier, site: "https://evil.example.com" })).toEqual({ ok: false, reason: "invalid" });
    const swapped = await wp.exchangeCode({ code, verifier, site });
    expect(swapped).toMatchObject({ ok: true, account: { email: `wp-a-${run}@example.com` } });
    expect(await wp.exchangeCode({ code, verifier, site })).toEqual({ ok: false, reason: "invalid" });
  });

  it("keeps only hashes: neither the code nor the token is in the table", async () => {
    const { code, verifier, site } = await connect();
    const swapped = await wp.exchangeCode({ code, verifier, site });
    if (!swapped.ok) throw new Error("not swapped");
    const rows = await db().execute<Row>(sql`select * from commerce.wordpress_connections where account_id = ${accountId}::uuid`);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(code);
    expect(stored).not.toContain(swapped.token);
    expect(stored).not.toContain(verifier);
  });

  it("refuses a code after its five minutes, and one that is not ours", async () => {
    const { code, verifier, site } = await connect();
    await db().execute(sql`update commerce.wordpress_connections set code_expires_at = now() - interval '1 second' where account_id = ${accountId}::uuid and code_challenge = ${challengeOf(verifier)}`);
    expect(await wp.exchangeCode({ code, verifier, site })).toEqual({ ok: false, reason: "invalid" });
    expect(await wp.exchangeCode({ code: "kzwc_nope", verifier, site })).toEqual({ ok: false, reason: "invalid" });
    expect(await wp.exchangeCode({ code: 5, verifier: null, site: undefined })).toEqual({ ok: false, reason: "invalid" });
  });

  it("limits the swaps in an hour", async () => {
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count) values (null, 'wp:exchange', date_trunc('hour', now()), 1000)
      on conflict (store_id, bucket, "window") do update set count = 1000
    `);
    const { code, verifier, site } = await connect();
    expect(await wp.exchangeCode({ code, verifier, site })).toEqual({ ok: false, reason: "limited" });
    await db().execute(sql`update commerce.chat_usage set count = 0 where bucket = 'wp:exchange'`);
  });
});

describe("a token", () => {
  it("is known while the connection stands, and not after it is revoked or the account is disabled", async () => {
    const { token, connectionId } = await tokenFor();
    expect(await wp.authenticate(`Bearer ${token}`)).toMatchObject({ ok: true, caller: { accountId, connectionId } });
    expect(await wp.authenticate(`Bearer ${token}x`)).toEqual({ ok: false, reason: "unauthorized" });
    expect(await wp.authenticate(null)).toEqual({ ok: false, reason: "unauthorized" });
    expect(await wp.authenticate(token)).toEqual({ ok: false, reason: "unauthorized" });
    expect(await wp.revokeConnection(otherAccountId, connectionId)).toBe(false);
    expect(await wp.revokeConnection(accountId, connectionId)).toBe(true);
    expect(await wp.authenticate(`Bearer ${token}`)).toEqual({ ok: false, reason: "unauthorized" });
    const second = await tokenFor();
    await db().execute(sql`update commerce.accounts set disabled_at = now() where id = ${accountId}::uuid`);
    expect(await wp.authenticate(`Bearer ${second.token}`)).toEqual({ ok: false, reason: "unauthorized" });
    await db().execute(sql`update commerce.accounts set disabled_at = null where id = ${accountId}::uuid`);
    expect(await wp.authenticate(`Bearer ${second.token}`)).toMatchObject({ ok: true });
  });

  it("counts its calls in the hour and is refused over the limit", async () => {
    const { token, connectionId } = await tokenFor();
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count) values (null, ${`wp:${connectionId}`}, date_trunc('hour', now()), ${CALLS_PER_HOUR})
    `);
    expect(await wp.authenticate(`Bearer ${token}`)).toEqual({ ok: false, reason: "limited" });
    const response = await storesRoute(ask("/api/wordpress/v1/stores", token));
    expect(response.status).toBe(429);
  });

  it("notes when it was last used, and the owner sees the connection listed", async () => {
    const { token, connectionId } = await tokenFor();
    await wp.authenticate(`Bearer ${token}`);
    const listed = (await wp.connectionsOf(accountId)).find((c) => c.id === connectionId);
    expect(listed).toMatchObject({ siteUrl: SITE, siteName: "Blog" });
    expect(listed?.lastUsedAt).not.toBeNull();
    expect((await wp.connectionsOf(otherAccountId)).some((c) => c.id === connectionId)).toBe(false);
  });
});

describe("the stores a token reaches", () => {
  it("are the account's own, with their markets, and never another account's", async () => {
    const { token } = await tokenFor();
    const body = (await (await storesRoute(ask("/api/wordpress/v1/stores", token))).json()) as { stores: { slug: string; role: string; open: boolean; markets: { slug: string }[] }[] };
    expect(body.stores.map((s) => s.slug)).toContain(slug);
    expect(body.stores.map((s) => s.slug)).not.toContain(otherSlug);
    const own = body.stores.find((s) => s.slug === slug)!;
    expect(own).toMatchObject({ role: "owner", open: true });
    expect(own.markets.length).toBeGreaterThan(0);
  });

  it("stop being reachable when the account leaves the store", async () => {
    // Staff of the first store: the second store's owner, added as an admin and then taken out again.
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) select id, ${otherAccountId}::uuid, 'admin' from commerce.stores where slug = ${slug}`);
    const { token } = await tokenFor(otherAccountId);
    const view = () => viewRoute(ask(`/api/wordpress/v1/stores/${slug}/view`, token), { params: Promise.resolve({ slug }) });
    expect((await view()).status).toBe(200);
    const stores = (await (await storesRoute(ask("/api/wordpress/v1/stores", token))).json()) as { stores: { slug: string; role: string }[] };
    expect(stores.stores.find((s) => s.slug === slug)?.role).toBe("admin");
    await db().execute(sql`update commerce.store_members m set disabled_at = now() from commerce.stores s where s.id = m.store_id and s.slug = ${slug} and m.account_id = ${otherAccountId}::uuid`);
    expect((await view()).status).toBe(404);
    await db().execute(sql`delete from commerce.store_members m using commerce.stores s where s.id = m.store_id and s.slug = ${slug} and m.account_id = ${otherAccountId}::uuid`);
  });

  it("answer a store that is not theirs as if it did not exist", async () => {
    const { token } = await tokenFor();
    for (const route of [viewRoute, termsRoute, pickRoute]) {
      const response = await route(ask(`/api/wordpress/v1/stores/${otherSlug}/x`, token), { params: Promise.resolve({ slug: otherSlug }) } as never);
      expect(response.status).toBe(404);
      expect(JSON.stringify(await response.json())).not.toContain(otherSlug);
    }
  });
});

describe("a view of products", () => {
  it("lists the store's products as the storefront does, with absolute addresses and the price written out", async () => {
    const { token } = await tokenFor();
    const response = await viewRoute(ask(`/api/wordpress/v1/stores/${slug}/view?limit=6`, token), { params: Promise.resolve({ slug }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const view = (await response.json()) as { store: { slug: string }; market: { slug: string; currency: string }; open: boolean; shop_url: string; products: { id: string; handle: string; url: string; title: string; price: { text: string; vat_label: string; amount_minor: number; currency: string } }[] };
    expect(view.open).toBe(true);
    expect(view.store.slug).toBe(slug);
    expect(view.products.length).toBeGreaterThan(0);
    expect(view.products.length).toBeLessThanOrEqual(6);
    for (const product of view.products) {
      expect(product.url).toMatch(/^https?:\/\/.+\/p\/.+/);
      expect(product.url).toContain(`/${view.market.slug}/p/${product.handle}`);
      expect(product.price.text).toMatch(/\d/);
      expect(product.price.vat_label).not.toBe("");
      expect(product.price.currency).toBe(view.market.currency);
      expect(Number.isInteger(product.price.amount_minor)).toBe(true);
    }
  });

  it("keeps hand-picked products in the order picked and never shows another store's", async () => {
    const { token } = await tokenFor();
    const all = (await (await viewRoute(ask(`/api/wordpress/v1/stores/${slug}/view?limit=10`, token), { params: Promise.resolve({ slug }) })).json()) as { products: { id: string }[] };
    expect(all.products.length).toBeGreaterThan(1);
    const [a, b] = [all.products[0].id, all.products[1].id];
    const picked = (await (await viewRoute(ask(`/api/wordpress/v1/stores/${slug}/view?source=products&ids=${b},${a}`, token), { params: Promise.resolve({ slug }) })).json()) as { products: { id: string }[] };
    expect(picked.products.map((p) => p.id)).toEqual([b, a]);
    const [foreign] = await db().execute<Row>(sql`select p.id from commerce.products p join commerce.stores s on s.id = p.store_id where s.slug = ${otherSlug} limit 1`);
    const none = (await (await viewRoute(ask(`/api/wordpress/v1/stores/${slug}/view?source=products&ids=${String(foreign.id)}`, token), { params: Promise.resolve({ slug }) })).json()) as { products: unknown[] };
    expect(none.products).toEqual([]);
  });

  it("shows nothing, not everything, for a category that is gone or a choice left empty", async () => {
    const { token } = await tokenFor();
    const gone = "123e4567-e89b-12d3-a456-426614174000";
    for (const query of [`source=category&categories=${gone}`, "source=category", "source=tag", "source=products"]) {
      const view = (await (await viewRoute(ask(`/api/wordpress/v1/stores/${slug}/view?${query}`, token), { params: Promise.resolve({ slug }) })).json()) as { products: unknown[] };
      expect(view.products, query).toEqual([]);
    }
  });

  it("refuses what it cannot read, and a market the store does not have", async () => {
    const { token } = await tokenFor();
    expect((await viewRoute(ask(`/api/wordpress/v1/stores/${slug}/view?limit=500`, token), { params: Promise.resolve({ slug }) })).status).toBe(400);
    expect((await viewRoute(ask(`/api/wordpress/v1/stores/${slug}/view?market=zz`, token), { params: Promise.resolve({ slug }) })).status).toBe(404);
  });

  it("is empty for a store that is suspended, and says so", async () => {
    const { token } = await tokenFor();
    await db().execute(sql`update commerce.stores set status = 'suspended' where slug = ${slug}`);
    const view = (await (await viewRoute(ask(`/api/wordpress/v1/stores/${slug}/view`, token), { params: Promise.resolve({ slug }) })).json()) as { open: boolean; products: unknown[] };
    expect(view).toMatchObject({ open: false, products: [] });
    await db().execute(sql`update commerce.stores set status = 'active' where slug = ${slug}`);
  });

  it("offers a store's categories, tags and products to choose from", async () => {
    const { token } = await tokenFor();
    const terms = (await (await termsRoute(ask(`/api/wordpress/v1/stores/${slug}/terms`, token), { params: Promise.resolve({ slug }) })).json()) as { categories: unknown[]; tags: unknown[] };
    expect(Array.isArray(terms.categories) && Array.isArray(terms.tags)).toBe(true);
    const picks = (await (await pickRoute(ask(`/api/wordpress/v1/stores/${slug}/products?limit=3`, token), { params: Promise.resolve({ slug }) })).json()) as { products: { id: string; title: string }[] };
    expect(picks.products.length).toBeGreaterThan(0);
    expect(picks.products.length).toBeLessThanOrEqual(3);
    const word = picks.products[0].title.split(" ")[0];
    const found = (await (await pickRoute(ask(`/api/wordpress/v1/stores/${slug}/products?q=${encodeURIComponent(word)}`, token), { params: Promise.resolve({ slug }) })).json()) as { products: { title: string }[] };
    expect(found.products.length).toBeGreaterThan(0);
    const wild = (await (await pickRoute(ask(`/api/wordpress/v1/stores/${slug}/products?q=%25`, token), { params: Promise.resolve({ slug }) })).json()) as { products: unknown[] };
    expect(wild.products).toEqual([]);
  });
});

describe("the plugin's own routes", () => {
  it("swap a code over HTTP and refuse every bad try with one answer", async () => {
    const { code, verifier, site } = await connect();
    const post = (body: unknown) => tokenRoute(new Request("https://kaizen.test/api/wordpress/v1/token", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
    const bad = await post({ code, verifier: secret(), site });
    expect(bad.status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post("[]")).status).toBe(400);
    expect((await post("x".repeat(3000))).status).toBe(413);
    const good = await post({ code, verifier, site });
    expect(good.status).toBe(200);
    const body = (await good.json()) as { token: string };
    expect(body.token).toMatch(/^kzwp_/);
    expect((await post({ code, verifier, site })).status).toBe(400);
    const me = await connectionRoute(ask("/api/wordpress/v1/connection", body.token));
    expect(await me.json()).toMatchObject({ account: { email: `wp-a-${run}@example.com` } });
  });

  it("disconnect from the plugin's side", async () => {
    const { token } = await tokenFor();
    expect((await disconnectRoute(new Request("https://kaizen.test/api/wordpress/v1/connection", { method: "DELETE", ...bearer(token) }))).status).toBe(200);
    expect((await connectionRoute(ask("/api/wordpress/v1/connection", token))).status).toBe(401);
  });

  it("refuse a call with no token", async () => {
    const response = await storesRoute(new Request("https://kaizen.test/api/wordpress/v1/stores"));
    expect(response.status).toBe(401);
  });
});

describe("stores and accounts that do not belong to it", () => {
  it("never see the template store", async () => {
    const template = await stores.templateStoreSlug();
    const { token } = await tokenFor();
    const body = (await (await storesRoute(ask("/api/wordpress/v1/stores", token))).json()) as { stores: { slug: string }[] };
    if (template) expect(body.stores.map((s) => s.slug)).not.toContain(template);
  });
});
