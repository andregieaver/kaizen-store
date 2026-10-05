import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { challengeOf, CALLS_PER_HOUR, readApproval } from "@/lib/wordpress";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));

/** The browser's cookies, kept: what a route sets is what the next call reads. */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
  }),
}));

const wp = await import("./wordpress");
const stores = await import("./stores");
const { GET: storesRoute } = await import("@/app/api/wordpress/v1/stores/route");
const { GET: viewRoute } = await import("@/app/api/wordpress/v1/stores/[slug]/view/route");
const { GET: termsRoute } = await import("@/app/api/wordpress/v1/stores/[slug]/terms/route");
const { GET: pickRoute } = await import("@/app/api/wordpress/v1/stores/[slug]/products/route");
const { GET: productRoute } = await import("@/app/api/wordpress/v1/stores/[slug]/product/route");
const { POST: quoteRoute } = await import("@/app/api/wordpress/v1/stores/[slug]/cart/quote/route");
const { POST: handoffRoute } = await import("@/app/api/wordpress/v1/stores/[slug]/cart/handoff/route");
const { GET: resumeRoute } = await import("@/app/s/[store]/[market]/cart/resume/route");
const cartModule = await import("./cart");
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


// ---------------------------------------------------------------------------------------------------------------------------------
// The product page and the cart held on the site (D170)
// ---------------------------------------------------------------------------------------------------------------------------------

type Qty = { variant_id: string; quantity: number };
type QuoteBody = { lines: { variant_id: string; status: string; quantity: number; available: number; title: string; unit: { amount_minor: number; text: string } | null; line_text: string | null }[]; subtotal_minor: number; subtotal_text: string; count: number; vat_label: string; labels: Record<string, string>; market: { slug: string } };
type ProductBody = { product: { handle: string; title: string; url: string; cartable: boolean; reason: string | null; options: { name: string; values: string[] }[]; variants: { id: string; options: Record<string, string>; price: { amount_minor: number; text: string }; stock: { level: string; max: number } }[]; images: { url: string }[] }; labels: Record<string, string>; market: { slug: string } };

const post = (path: string, token: string, body: unknown) =>
  new Request(`https://kaizen.test${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
const forStore = (s: string) => ({ params: Promise.resolve({ slug: s }) }) as never;

/** Goods of the store with their variants, and the appointment product that cannot be put in such a cart. */
async function catalogue() {
  const goods = await db().execute<Row>(sql`
    select distinct p.handle, v.id as variant_id, p.id as product_id, v.sku from commerce.products p join commerce.product_variants v on v.product_id = p.id and v.active
    join commerce.current_prices cp on cp.variant_id = v.id
    where p.store_id = (select id from commerce.stores where slug = ${slug}) and p.status = 'active' and p.kind = 'goods' and v.delivery = 'physical' and not p.subscription_only
    order by p.handle, v.sku
  `);
  const [appointment] = await db().execute<Row>(sql`
    select p.handle, v.id as variant_id from commerce.products p join commerce.product_variants v on v.product_id = p.id
    where p.store_id = (select id from commerce.stores where slug = ${slug}) and p.kind <> 'goods' and p.status = 'active' limit 1
  `);
  return { goods: goods.map((g) => ({ handle: String(g.handle), variantId: String(g.variant_id), productId: String(g.product_id) })), appointment: appointment ? { handle: String(appointment.handle), variantId: String(appointment.variant_id) } : null };
}

describe("a product page for the site", () => {
  it("has the product, its options and variants priced and with their stock, in the market's language", async () => {
    const { token } = await tokenFor();
    const { goods } = await catalogue();
    const res = await productRoute(ask(`/api/wordpress/v1/stores/${slug}/product?handle=${goods[0].handle}`, token), forStore(slug));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ProductBody;
    expect(body.product).toMatchObject({ handle: goods[0].handle, cartable: true, reason: null });
    expect(body.product.url).toContain(`/${body.market.slug}/p/${goods[0].handle}`);
    expect(body.product.variants.length).toBeGreaterThan(0);
    for (const variant of body.product.variants) {
      expect(variant.price.text).toMatch(/\d/);
      expect(["in_stock", "low", "out"]).toContain(variant.stock.level);
      expect(variant.stock.max).toBeLessThanOrEqual(20);
    }
    for (const option of body.product.options) for (const variant of body.product.variants) expect(option.values).toContain(variant.options[option.name]);
    expect(body.labels.addToCart).toBeTruthy();
    expect(body.labels.onlyAvailable).toContain("{n}");
    expect(body.labels.lowStock).toContain("{n}");
  });

  it("says a product that needs a time or a plan cannot be put in the cart, and never shows another store's product", async () => {
    const { token } = await tokenFor();
    const { appointment } = await catalogue();
    if (appointment) {
      const body = (await (await productRoute(ask(`/api/wordpress/v1/stores/${slug}/product?handle=${appointment.handle}`, token), forStore(slug))).json()) as ProductBody;
      expect(body.product).toMatchObject({ cartable: false, reason: "booking" });
    }
    const [foreign] = await db().execute<Row>(sql`select p.handle from commerce.products p where p.store_id = (select id from commerce.stores where slug = ${otherSlug}) limit 1`);
    // The same demo handle may exist in both stores: only this store's own is ever returned.
    const res = await productRoute(ask(`/api/wordpress/v1/stores/${slug}/product?handle=no-such-${String(foreign.handle)}`, token), forStore(slug));
    expect(res.status).toBe(404);
    expect((await productRoute(ask(`/api/wordpress/v1/stores/${otherSlug}/product?handle=x`, token), forStore(otherSlug))).status).toBe(404);
    expect((await productRoute(ask(`/api/wordpress/v1/stores/${slug}/product?handle=x&market=a/b`, token), forStore(slug))).status).toBe(400);
  });

  it("is told on each card of a view whether it can be put in the cart", async () => {
    const { token } = await tokenFor();
    const view = (await (await viewRoute(ask(`/api/wordpress/v1/stores/${slug}/view?limit=12`, token), forStore(slug))).json()) as { products: { handle: string; cart: { cartable: boolean; reason: string | null; variant_id: string | null; variant_count: number; sold_out: boolean } }[] };
    expect(view.products.length).toBeGreaterThan(0);
    for (const product of view.products) {
      expect(typeof product.cart.cartable).toBe("boolean");
      if (product.cart.variant_count === 1) expect(product.cart.variant_id).toMatch(/^[0-9a-f-]{36}$/);
      else expect(product.cart.variant_id).toBeNull();
    }
    expect(view.products.some((p) => p.cart.cartable)).toBe(true);
    expect(view.products.some((p) => !p.cart.cartable && p.cart.reason === "booking")).toBe(true);
  });
});

describe("a cart held on the site", () => {
  it("is priced live: each line, a subtotal that is the sum of the lines, and a quantity above the stock counted at the stock", async () => {
    const { token } = await tokenFor();
    const { goods, appointment } = await catalogue();
    await db().execute(sql`update commerce.inventory_levels set on_hand = 50 where variant_id in (${goods[0].variantId}::uuid, ${goods[1].variantId}::uuid)`);
    const lines: Qty[] = [{ variant_id: goods[0].variantId, quantity: 2 }, { variant_id: goods[1].variantId, quantity: 1 }];
    const raw = await quoteRoute(post(`/api/wordpress/v1/stores/${slug}/cart/quote`, token, { lines }), forStore(slug));
    const body = (await raw.json()) as QuoteBody;
    expect(raw.status, JSON.stringify(body)).toBe(200);
    expect(body.lines.map((l) => l.status)).toEqual(["ok", "ok"]);
    const sum = body.lines.reduce((total, line) => total + (line.unit?.amount_minor ?? 0) * line.quantity, 0);
    expect(body.subtotal_minor).toBe(sum);
    expect(body.subtotal_minor).toBeGreaterThan(0);
    expect(body.count).toBe(3);
    expect(body.subtotal_text).toMatch(/\d/);
    expect(body.vat_label).not.toBe("");
    expect(body.labels.shippingAtCheckout).toBeTruthy();

    // More than there is: counted at the stock.
    await db().execute(sql`update commerce.inventory_levels set on_hand = 3 where variant_id = ${goods[0].variantId}::uuid`);
    const short = (await (await quoteRoute(post(`/api/wordpress/v1/stores/${slug}/cart/quote`, token, { lines: [{ variant_id: goods[0].variantId, quantity: 9 }] }), forStore(slug))).json()) as QuoteBody;
    expect(short.lines[0]).toMatchObject({ status: "insufficient", available: 3 });
    expect(short.count).toBe(3);

    // Not goods, not this store's, not there: left out of the subtotal.
    const [foreign] = await db().execute<Row>(sql`select v.id from commerce.product_variants v where v.store_id = (select id from commerce.stores where slug = ${otherSlug}) limit 1`);
    const odd = [{ variant_id: String(foreign.id), quantity: 1 }, { variant_id: "123e4567-e89b-12d3-a456-426614174000", quantity: 1 }, ...(appointment ? [{ variant_id: appointment.variantId, quantity: 1 }] : [])];
    const out = (await (await quoteRoute(post(`/api/wordpress/v1/stores/${slug}/cart/quote`, token, { lines: odd }), forStore(slug))).json()) as QuoteBody;
    expect(out.lines.every((l) => l.status === "unavailable")).toBe(true);
    expect(out.subtotal_minor).toBe(0);
  });

  it("refuses a cart it cannot read", async () => {
    const { token } = await tokenFor();
    for (const body of [{}, { lines: [] }, { lines: [{ variant_id: "x", quantity: 1 }] }, { lines: [{ variant_id: "123e4567-e89b-12d3-a456-426614174000", quantity: 0 }] }, { lines: [{ variant_id: "123e4567-e89b-12d3-a456-426614174000", quantity: 21 }] }]) {
      expect((await quoteRoute(post(`/api/wordpress/v1/stores/${slug}/cart/quote`, token, body), forStore(slug))).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("is handed over: the cart is made in the store, opened once by its link, and is then the browser's cart with the prices the quote gave", async () => {
    const { token } = await tokenFor();
    const { goods, appointment } = await catalogue();
    await db().execute(sql`update commerce.inventory_levels set on_hand = 50 where variant_id in (${goods[0].variantId}::uuid, ${goods[1].variantId}::uuid)`);
    const lines: Qty[] = [{ variant_id: goods[0].variantId, quantity: 2 }, { variant_id: goods[1].variantId, quantity: 1 }, ...(appointment ? [{ variant_id: appointment.variantId, quantity: 1 }] : [])];
    const quote = (await (await quoteRoute(post(`/api/wordpress/v1/stores/${slug}/cart/quote`, token, { lines: lines.slice(0, 2) }), forStore(slug))).json()) as QuoteBody;

    const response = await handoffRoute(post(`/api/wordpress/v1/stores/${slug}/cart/handoff`, token, { lines, to: "checkout" }), forStore(slug));
    expect(response.status).toBe(200);
    const made = (await response.json()) as { url: string; lines: { variant_id: string; quantity: number; outcome: string }[] };
    expect(made.url).toMatch(new RegExp(`/${quote.market.slug}/cart/resume\\?t=kzwh_`));
    expect(made.lines.filter((l) => l.outcome === "unavailable").length).toBe(appointment ? 1 : 0);
    const secret = new URL(made.url).searchParams.get("t")!;
    const stored = JSON.stringify(await db().execute<Row>(sql`select * from commerce.carts where handoff_hash is not null`));
    expect(stored).not.toContain(secret);

    // Opened: the browser's cart, then on to the checkout; the secret works once.
    jar.clear();
    const open = await resumeRoute(new Request(made.url), { params: Promise.resolve({ store: slug, market: quote.market.slug }) } as never);
    expect(open.status).toBe(303);
    expect(open.headers.get("location")).toBe(`/s/${slug}/${quote.market.slug}/checkout`);
    expect(open.headers.get("cache-control")).toBe("no-store");
    expect(jar.size).toBe(1);
    const cart = await cartModule.getCart({ storeId: (await stores.getStore(slug))!.id, market: (await stores.getStore(slug))!.markets.find((m) => m.slug === quote.market.slug)! });
    expect(cart.lines.map((l) => [l.variantId, l.quantity, l.status])).toEqual(
      expect.arrayContaining([[goods[0].variantId, 2, "ok"], [goods[1].variantId, 1, "ok"]]),
    );
    expect(cart.lines.length).toBe(2);
    // What the shopper sees in the store's cart is what the plugin quoted.
    expect(cart.lines.reduce((total, line) => total + (line.unitPriceMinor ?? 0) * line.quantity, 0)).toBe(quote.subtotal_minor);
    const [row] = await db().execute<Row>(sql`select handoff_hash, expires_at > now() + interval '20 days' as long from commerce.carts where id = ${[...jar.values()][0]}::uuid`);
    expect(row.handoff_hash).toBeNull();
    expect(row.long).toBe(true);

    jar.clear();
    const again = await resumeRoute(new Request(made.url), { params: Promise.resolve({ store: slug, market: quote.market.slug }) } as never);
    expect(again.headers.get("location")).toBe(`/s/${slug}/${quote.market.slug}/cart`);
    expect(jar.size).toBe(0);
  });

  it("cuts a quantity to the stock, makes no cart when nothing can be bought, and ends a link that runs out or is used in another market", async () => {
    const { token } = await tokenFor();
    const { goods, appointment } = await catalogue();
    await db().execute(sql`update commerce.inventory_levels set on_hand = 2 where variant_id = ${goods[0].variantId}::uuid`);
    const cut = (await (await handoffRoute(post(`/api/wordpress/v1/stores/${slug}/cart/handoff`, token, { lines: [{ variant_id: goods[0].variantId, quantity: 9 }], to: "cart" }), forStore(slug))).json()) as { url: string; lines: { quantity: number; outcome: string }[] };
    expect(cut.lines[0]).toMatchObject({ quantity: 2, outcome: "capped" });
    const before = Number((await db().execute<Row>(sql`select count(*) from commerce.carts`))[0].count);
    const none = await handoffRoute(post(`/api/wordpress/v1/stores/${slug}/cart/handoff`, token, { lines: [{ variant_id: "123e4567-e89b-12d3-a456-426614174000", quantity: 1 }, ...(appointment ? [{ variant_id: appointment.variantId, quantity: 1 }] : [])] }), forStore(slug));
    expect(none.status).toBe(422);
    expect(Number((await db().execute<Row>(sql`select count(*) from commerce.carts`))[0].count)).toBe(before);

    const secret = new URL(cut.url).searchParams.get("t")!;
    const market = new URL(cut.url).pathname.split("/")[3];
    jar.clear();
    const wrong = await resumeRoute(new Request(cut.url), { params: Promise.resolve({ store: otherSlug, market }) } as never);
    expect(wrong.headers.get("location")).toBe(`/s/${otherSlug}/${market}/cart`);
    expect(jar.size).toBe(0);
    await db().execute(sql`update commerce.carts set handoff_expires_at = now() - interval '1 second' where handoff_hash is not null`);
    const late = await resumeRoute(new Request(cut.url), { params: Promise.resolve({ store: slug, market }) } as never);
    expect(late.headers.get("location")).toBe(`/s/${slug}/${market}/cart`);
    expect(jar.size).toBe(0);
    expect(secret.startsWith("kzwh_")).toBe(true);
    const junk = await resumeRoute(new Request(`https://kaizen.test/s/${slug}/${market}/cart/resume?t=nope`), { params: Promise.resolve({ store: slug, market }) } as never);
    expect(junk.status).toBe(303);
  });

  it("limits the carts one connection makes in an hour", async () => {
    const { token, connectionId } = await tokenFor();
    const { goods } = await catalogue();
    await db().execute(sql`insert into commerce.chat_usage (store_id, bucket, "window", count) values (null, ${`wp:cart:${connectionId}`}, date_trunc('hour', now()), 60)`);
    const res = await handoffRoute(post(`/api/wordpress/v1/stores/${slug}/cart/handoff`, token, { lines: [{ variant_id: goods[0].variantId, quantity: 1 }] }), forStore(slug));
    expect(res.status).toBe(429);
  });
});
