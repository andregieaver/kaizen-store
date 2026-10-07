import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { COPY_RULES } from "@/lib/store-copy-rules";
import { storeFileUrls } from "@/lib/store-copy-media";
import { noneOf, type StoreCopyOptions } from "@/lib/store-copy";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));
vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));

const copy = await import("./store-copy");
const orderAdmin = await import("./order-admin");
const orders = await import("./orders");
const customers = await import("./customers");
const customerAdmin = await import("./customer-admin");
const insights = await import("./owner-insights");
const center = await import("./control-center");
const discounts = await import("./discounts");
const stores = await import("./stores");
const emails = await import("./shopper-emails");
const cartReminders = await import("./cart-reminders");
const standing = await import("./standing-orders");
const hostPayments = await import("./host-payments");
const integrations = await import("./integrations");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const files = "https://files.example.com/storage/v1/object/public";
const rows = <T = Row>(query: ReturnType<typeof sql>) => db().execute<T & Row>(query);
const scalar = async <T>(query: ReturnType<typeof sql>) => Object.values((await rows(query))[0] ?? {})[0] as T;

let owner: Account;
let staff: Account;
let stranger: Account;
let admin: Account;
/** The store copied: `S`, its files and the ids the tests look at. */
let S: string;
let slug: string;
const ids: Record<string, string> = {};
const url = (bucket: string, name: string) => `${files}/${bucket}/${S}/${name}`;

const account = async (name: string, platformAdmin = false): Promise<Account> => {
  const email = `copy-${name}-${run}@example.com`;
  const [row] = await rows(
    sql`insert into commerce.accounts (email, name, platform_admin) values (${email}, ${name}, ${platformAdmin}) returning id`,
  );
  return { id: String(row.id), email, name, platformAdmin };
};

/** What Storage's copy would do: an address in the destination, unless the file is one that fails. */
const copied: { bucket: string; from: string; to: string }[] = [];
const fakeCopy = async (bucket: string, from: string, to: string) => {
  if (from.includes("broken")) return null;
  copied.push({ bucket, from, to });
  return `${files}/${bucket}/${to}`;
};

const ALL: StoreCopyOptions = {
  pages: { mode: "all" },
  products: { mode: "all" },
  posts: { mode: "all" },
  customers: true,
  orders: true,
  confirmDataUse: true,
};
const NOTHING: StoreCopyOptions = {
  pages: noneOf(),
  products: noneOf(),
  posts: noneOf(),
  customers: false,
  orders: false,
  confirmDataUse: false,
};

const noSchedule = { schedule: () => {} };

/** An owner may own ten stores; the copies of earlier tests are closed so later ones are not refused for the limit. */
const tidy = (who: Account) =>
  db().execute(
    sql`update commerce.stores set status = 'closed' where created_by = ${who.id}::uuid and id <> ${S}::uuid and status <> 'closed'`,
  );
const fastDeps = {
  copyFile: fakeCopy,
  rebuild: async () => {},
  invalidate: async () => {},
  schedule: () => {},
};

let counter = 0;
const nextSlug = (prefix: string) => `${prefix}-${run}-${++counter}`;

async function start(
  who: Account,
  options: StoreCopyOptions,
  over: { name?: string; slug?: string; source?: string } = {},
  deps = noSchedule,
) {
  const name = over.name ?? "Copy";
  return copy.startStoreCopy(
    who,
    { source: over.source ?? slug, name, slug: over.slug ?? nextSlug("cs"), options },
    deps,
  );
}

/** Runs a copy's job until it is done or failed (one run at a time, as the cron does). */
async function finish(id: string, deps: Parameters<typeof copy.runStoreCopy>[1] = fastDeps, max = 30) {
  let outcome = "paused";
  for (let i = 0; i < max && outcome !== "done" && outcome !== "failed"; i += 1)
    outcome = await copy.runStoreCopy(id, deps);
  return outcome;
}

const newStoreOf = async (copyId: string) =>
  String(await scalar(sql`select new_store_id from commerce.store_copies where id = ${copyId}::uuid`));
const count = (table: string, storeId: string) =>
  scalar<number>(sql`select count(*)::int from ${sql.raw(`commerce.${table}`)} where store_id = ${storeId}::uuid`);

async function orderRow(number: string, status: string, customerId: string | null, extra = "") {
  const [row] = await rows(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, customer_id, email, status, subtotal_minor, shipping_minor,
      discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at, discount_code, member_discount_minor,
      member_label, member_percent, balance_minor)
    values (${S}::uuid, ${number}, 'DE', 'EUR', 'de-DE', ${customerId}::uuid, ${`buyer-${number}@copy.example`}, ${status}, 2000, 490, 100, 320, 2390,
      '{"name":"Buyer"}', '{"name":"Buyer","line1":"Street 1","country":"DE"}', now() - interval '3 days', 'ALL10', 100, 'VIP', 10, ${extra ? 100 : 0})
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor,
      tax_minor, tax_rate, tax_code, member_discount_minor)
    values (${S}::uuid, ${String(row.id)}::uuid, ${ids.variantA}::uuid, 'A1', 'Alpha', 2, 1000, 100, 1900, 320, 0.19, 'txcd_99999999', 100)
  `);
  return String(row.id);
}

beforeAll(async () => {
  // Copies left running by an earlier run of these tests would be picked up by the job under test.
  await db().execute(
    sql`update commerce.store_copies set status = 'failed', problem = 'left by an earlier test run', finished_at = now() where status = 'running'`,
  );
  owner = await account("owner");
  staff = await account("staff");
  stranger = await account("stranger");
  admin = await account("admin", true);
  slug = `cs-src-${run}`;
  const [store] = await rows(sql`
    insert into commerce.stores (slug, name, legal_name, organisation_number, modules, setup_completed_at, custom_css, created_by, navigation, locales, tracking, custom_code)
    values (${slug}, 'Original', 'Karis AS', '999888777', '{bookings,work}', now(), '', ${owner.id}::uuid, '{}', '{en-IE,nb-NO}', '{"ga4":"G-ORIGINAL1"}', '{"necessary":[{"name":"x"}]}') returning id
  `);
  S = String(store.id);
  const member = (who: Account, role: string) =>
    db().execute(
      sql`insert into commerce.store_members (store_id, account_id, role) values (${S}::uuid, ${who.id}::uuid, ${role})`,
    );
  await member(owner, "owner");
  await member(staff, "admin");
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
    select ${S}::uuid, code, currency, default_locale, locales, true from commerce.countries where code in ('DE', 'NO')
  `);
  await db().execute(
    sql`insert into commerce.shipping_rates (store_id, market_code, currency, amount_minor) values (${S}::uuid, 'DE', 'EUR', 490)`,
  );
  await db().execute(
    sql`insert into commerce.payment_methods (store_id, market_code, method, enabled) values (${S}::uuid, 'DE', 'card', true)`,
  );

  // The things that must never come along.
  await db().execute(
    sql`insert into commerce.payment_credentials (store_id, provider, mode, secret_key_ciphertext) values (${S}::uuid, 'stripe', 'test', 'sk-secret')`,
  );
  await db().execute(
    sql`insert into commerce.stripe_accounts (store_id, mode, account_id) values (${S}::uuid, 'test', ${`acct_original${run}`})`,
  );
  await db().execute(
    sql`insert into commerce.store_domains (store_id, hostname, token) values (${S}::uuid, ${`${run}.original.example`}, 'tok')`,
  );
  await db().execute(sql`
    insert into commerce.store_integrations (store_id, provider, enabled, webhook_url_encrypted, webhook_hint, events)
    values (${S}::uuid, 'slack', true, 'x', 'x', '{order.paid,customer.created}')
  `);
  await db().execute(
    sql`insert into commerce.ai_providers (store_id, provider, api_key_encrypted, api_key_hint) values (${S}::uuid, 'openai', 'x', 'x')`,
  );
  await db().execute(
    sql`insert into commerce.work_clients (store_id, name, currency) values (${S}::uuid, 'A client', 'EUR')`,
  );

  // Library files (with their alt texts) and files the library never registered.
  const media = (name: string, opts: { thumb?: boolean; bucket?: string; kind?: string; alt?: string } = {}) =>
    db().execute(sql`
      insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, size_bytes, alt, alt_source)
      values (${S}::uuid, ${opts.kind ?? "image"}, ${url(opts.bucket ?? "product-media", name)},
        ${opts.thumb ? url("product-media", name.replace(".webp", "-480.webp")) : null}, ${opts.bucket ?? "product-media"}, ${`${S}/${name}`},
        ${opts.thumb ? `${S}/${name.replace(".webp", "-480.webp")}` : null}, ${name}, ${opts.kind === "video" ? "video/mp4" : "image/webp"}, 1234,
        ${opts.alt ?? ""}, ${opts.alt ? "staff" : null})
    `);
  await media("a.webp", { thumb: true, alt: "A red shoe" });
  await media("b.webp");
  await media("broken.webp");
  await media("hero.mp4", { bucket: "page-videos", kind: "video" });

  // Products: a picture used twice, a broken picture, a variant picture.
  const [operator] = await rows(sql`
    insert into commerce.economic_operators (store_id, name, postal_address, electronic_address, country)
    values (${S}::uuid, 'Maker', 'Street 1', 'safety@maker.example', 'DE') returning id
  `);
  const product = async (handle: string, status: string) => {
    const [p] = await rows(
      sql`insert into commerce.products (store_id, handle, manufacturer_id, tax_code) values (${S}::uuid, ${handle}, ${String(operator.id)}::uuid, 'txcd_99999999') returning id`,
    );
    const id = String(p.id);
    await db().execute(
      sql`insert into commerce.product_translations (store_id, product_id, locale, title) values (${S}::uuid, ${id}::uuid, 'en-IE', ${`Title ${handle}`})`,
    );
    const [v] = await rows(
      sql`insert into commerce.product_variants (store_id, product_id, sku) values (${S}::uuid, ${id}::uuid, ${handle.slice(0, 1).toUpperCase() + "1"}) returning id`,
    );
    await db().execute(sql`select commerce.set_price(${String(v.id)}::uuid, 'DE', 1000)`);
    ids[handle] = id;
    ids[`variant${handle.slice(0, 1).toUpperCase()}`] = String(v.id);
    return { id, variant: String(v.id), status };
  };
  const alpha = await product("alpha", "active");
  const beta = await product("beta", "draft");
  const gamma = await product("gamma", "active");
  await db().execute(sql`
    insert into commerce.product_media (store_id, product_id, url, thumbnail_url, position, alt) values
      (${S}::uuid, ${alpha.id}::uuid, ${url("product-media", "a.webp")}, ${url("product-media", "a-480.webp")}, 0, '{}'),
      (${S}::uuid, ${alpha.id}::uuid, ${url("product-media", "broken.webp")}, null, 1, '{}'),
      (${S}::uuid, ${alpha.id}::uuid, 'https://example.com/other.jpg', null, 2, '{}'),
      (${S}::uuid, ${beta.id}::uuid, ${url("product-media", "a.webp")}, ${url("product-media", "a-480.webp")}, 0, '{}'),
      (${S}::uuid, ${gamma.id}::uuid, ${url("product-media", "broken.webp")}, null, 0, '{}')
  `);
  await db().execute(
    sql`update commerce.product_variants set image_url = ${url("product-media", "b.webp")}, image_thumbnail_url = ${url("product-media", "b.webp")} where id = ${alpha.variant}::uuid`,
  );
  await db().execute(
    sql`update commerce.products set status = 'active' where id in (${alpha.id}::uuid, ${gamma.id}::uuid)`,
  );
  const [location] = await rows(
    sql`insert into commerce.inventory_locations (store_id, name, country) values (${S}::uuid, 'Lager', 'NO') returning id`,
  );
  await db().execute(
    sql`insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values (${S}::uuid, ${alpha.variant}::uuid, ${String(location.id)}::uuid, 5)`,
  );
  // Stock settings (wave 3, D172): the rank of the location and the variant's selling policy and warning level are copied with the store.
  await db().execute(sql`update commerce.inventory_locations set priority = 3 where id = ${String(location.id)}::uuid`);
  await db().execute(
    sql`update commerce.product_variants set stock_policy = 'continue', backorder_days = 6, low_stock_threshold = 2 where id = ${alpha.variant}::uuid`,
  );
  ids.location = String(location.id);

  // Pages with pictures, a background, a video and a background that cannot be copied; a menu with a mega-menu picture; the logo.
  const row = (id: string, background: object | null, image: object | null) => ({
    id,
    type: "row",
    layout: "1",
    ...(background ? { background } : {}),
    columns: [
      {
        id: `${id}-c`,
        blocks: [image ? { id: `${id}-b`, type: "image", image, caption: "" } : { id: `${id}-b`, type: "richText" }],
      },
    ],
  });
  const pic = (name: string, bucket = "product-media") => ({ url: url(bucket, name), width: 10, height: 10 });
  const home = {
    title: "Home",
    rows: [
      row("r1", { type: "image", image: pic("a.webp"), color: "#000000" }, pic("a.webp")),
      row("r2", { type: "video", video: { url: url("page-videos", "hero.mp4") }, poster: pic("a.webp") }, null),
      row("r3", { type: "image", image: pic("broken.webp") }, pic("b.webp")),
    ],
    css: `.x{background:url(${url("product-media", "b.webp")})}`,
  };
  const [page] = await rows(sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at) values (${S}::uuid, 'page', 'home', ${JSON.stringify(home)}::jsonb, ${JSON.stringify(home)}::jsonb, now()) returning id
  `);
  ids.home = String(page.id);
  await db().execute(sql`
    insert into commerce.pages (store_id, type, slug, draft) values (${S}::uuid, 'page', 'draft-page', ${JSON.stringify({ title: "Draft", rows: [] })}::jsonb)
  `);
  const [post] = await rows(sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at)
    values (${S}::uuid, 'article', 'hello', ${JSON.stringify({ title: "Hello", rows: [] })}::jsonb, ${JSON.stringify({ title: "Hello", rows: [] })}::jsonb, now(), '2026-01-02') returning id
  `);
  ids.post = String(post.id);
  await db().execute(sql`update commerce.stores set front_page_id = ${ids.home}::uuid where id = ${S}::uuid`);
  await db().execute(sql`
    insert into commerce.menus (store_id, name, items) values (${S}::uuid, 'Main', ${JSON.stringify([
      { label: {}, link: { kind: "home" }, depth: 0 },
      { label: {}, link: { kind: "product", handle: "beta" }, depth: 0 },
      { label: {}, link: { kind: "products" }, depth: 0, mega: true, image: pic("b.webp") },
    ])}::jsonb)
  `);
  await db().execute(sql`
    update commerce.stores set navigation = ${JSON.stringify({ logo: pic("logo.webp"), favicon: { url: url("product-media", "fav.png"), smallUrl: url("product-media", "fav-64.png") } })}::jsonb,
      custom_css = ${`.y{background:url(${url("product-media", "b.webp")})}`} where id = ${S}::uuid
  `);
  await db().execute(sql`
    insert into commerce.field_groups (store_id, name, slug, entities, fields)
    values (${S}::uuid, 'Extras', 'extras', '["product"]',
      '[{"id":"f_file0000001","name":"sheet","label":"Sheet","type":"file","access":"public"}]')
  `);
  await db().execute(sql`
    insert into commerce.field_values (store_id, entity, entity_id, locale, values)
    values (${S}::uuid, 'product', ${alpha.id}::uuid, '', ${JSON.stringify({ f_file0000001: { url: url("field-files", "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f-price-list.pdf"), name: "price-list.pdf" } })}::jsonb)
  `);

  // Codes, campaigns, groups; shoppers and their history.
  await db().execute(
    sql`insert into commerce.discount_codes (store_id, code, kind, percent) values (${S}::uuid, 'ALL10', 'percent', 10)`,
  );
  await db().execute(sql`insert into commerce.customer_tiers (store_id, name, percent) values (${S}::uuid, 'VIP', 10)`);
  ids.customerVip = String(
    (
      await rows(sql`
      insert into commerce.customers (store_id, email, name, phone, password_hash, auth_user_id, email_verified_at, last_sign_in_at, avatar_path)
      values (${S}::uuid, 'vip@copy.example', 'Vip', '+4712345678', 'scrypt$secret', gen_random_uuid(), now(), now(), 'a/b.webp') returning id
    `)
    )[0].id,
  );
  ids.customerPlain = String(
    (
      await rows(
        sql`insert into commerce.customers (store_id, email, name) values (${S}::uuid, 'plain@copy.example', 'Plain') returning id`,
      )
    )[0].id,
  );
  await db().execute(
    sql`insert into commerce.customer_sessions (store_id, customer_id, token_hash, expires_at) values (${S}::uuid, ${ids.customerVip}::uuid, ${`h-${run}`}, now() + interval '1 day')`,
  );
  await db().execute(
    sql`insert into commerce.wishlists (store_id, customer_id, name) values (${S}::uuid, ${ids.customerVip}::uuid, 'Mine')`,
  );
  await db().execute(
    sql`insert into commerce.email_opt_outs (store_id, email, source) values (${S}::uuid, 'gone@copy.example', 'unsubscribe')`,
  );
  ids.paid = await orderRow("1001", "paid", ids.customerVip);
  ids.fulfilled = await orderRow("1002", "fulfilled", null);
  ids.cancelled = await orderRow("1003", "cancelled", ids.customerPlain);
  ids.pending = await orderRow("1004", "pending_payment", null);
  ids.venue = await orderRow("1005", "paid", null, "balance");
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
    values (${S}::uuid, ${ids.paid}::uuid, 'stripe', 'pi_1', 2390, 'EUR', 'captured')
  `);
  // A parcel as markSent() writes it: the shipment and its lines in one transaction (D174).
  await db().transaction(async (t) => {
    const [shipment] = await t.execute<Row>(
      sql`insert into commerce.shipments (store_id, order_id, carrier, tracking_number) values (${S}::uuid, ${ids.fulfilled}::uuid, 'DHL', '123') returning id`,
    );
    await t.execute(sql`
      insert into commerce.shipment_lines (store_id, shipment_id, order_line_id, quantity)
      select store_id, ${String(shipment.id)}::uuid, id, quantity from commerce.order_lines where store_id = ${S}::uuid and order_id = ${ids.fulfilled}::uuid
    `);
  });
  await db().execute(sql`
    insert into commerce.subscriptions (store_id, number, market_code, currency, locale, interval, interval_count, subtotal_minor, total_minor, tax_minor, first_order_id, manage_token, customer_id)
    values (${S}::uuid, 'SUB-1', 'DE', 'EUR', 'de-DE', 'month', 1, 1000, 1000, 160, ${ids.paid}::uuid, ${`tok-${run}`}, ${ids.customerVip}::uuid)
  `);
  await db().execute(sql`
    insert into commerce.delivery_schedules (store_id, market_code, currency, name, delivery_weekday) values (${S}::uuid, 'DE', 'EUR', 'Fridays', 5)
  `);
  // The referral program (D131): its rules, a customer's link, a friend who came through it and an order that did.
  await db().execute(sql`
    insert into commerce.affiliate_settings (store_id, enabled, reward_bps, reward_orders, friend_percent, friend_max_minor, monthly_cap_minor, cookie_days)
    values (${S}::uuid, true, 700, 3, 12, 5000, 90000, 45)
  `);
  await db().execute(sql`insert into commerce.affiliates (store_id, customer_id, code) values (${S}::uuid, ${ids.customerVip}::uuid, ${`vip${run}`.slice(0, 16).padEnd(6, "x")})`);
  await db().execute(sql`update commerce.customers set referred_by_customer_id = ${ids.customerVip}::uuid where id = ${ids.customerPlain}::uuid`);
  await db().execute(sql`update commerce.orders set referral_discount_minor = 50 where id = ${ids.paid}::uuid`);
  await db().execute(sql`
    insert into commerce.affiliate_attributions (store_id, order_id, affiliate_customer_id, friend_customer_id, code) 
    select ${S}::uuid, ${ids.cancelled}::uuid, ${ids.customerVip}::uuid, ${ids.customerPlain}::uuid, code from commerce.affiliates where customer_id = ${ids.customerVip}::uuid
  `);
});

afterAll(async () => {
  await closeDb();
});

describe("what an owner can choose from", () => {
  it("lists the pages, posts, products, shoppers and orders of a store they own, and refuses anyone else", async () => {
    const result = await copy.copyChoices(owner, slug);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { choices } = result;
    expect(choices.source).toEqual({ slug, name: "Original" });
    expect(choices.pages.map((p) => [p.slug, p.state]).sort()).toEqual([
      ["draft-page", "draft"],
      ["home", "published"],
    ]);
    expect(choices.posts.map((p) => p.slug)).toEqual(["hello"]);
    expect(choices.products.map((p) => p.handle).sort()).toEqual(["alpha", "beta", "gamma"]);
    expect(choices.products.find((p) => p.handle === "alpha")?.image).toBe(url("product-media", "a-480.webp"));
    expect(choices.customers).toBe(2);
    // Orders still waiting for payment are not history.
    expect(choices.orders).toBe(4);
    expect(choices.settings.map((s) => s.label)).toEqual(
      expect.arrayContaining(["Markets", "Menus", "Customer groups"]),
    );
    // Staff, strangers and unknown stores all get the same answer; a platform admin may copy any store.
    for (const who of [staff, stranger])
      expect(await copy.copyChoices(who, slug)).toEqual({ ok: false, problems: [copy.NOT_COPYABLE] });
    expect(await copy.copyChoices(owner, "no-such-store")).toEqual({ ok: false, problems: [copy.NOT_COPYABLE] });
    expect((await copy.copyChoices(admin, slug)).ok).toBe(true);
  });
});

describe("starting a copy", () => {
  it("makes the new store at once, closed and without payments, and records the copy", async () => {
    const started = await start(owner, ALL, { name: "Second shop" });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const newId = await newStoreOf(started.id);
    // The settings, pages and products are there before the job has run.
    expect(await count("products", newId)).toBe(3);
    expect(await count("pages", newId)).toBe(3);
    expect(await count("markets", newId)).toBe(2);
    const [store] = await rows(sql`select * from commerce.stores where id = ${newId}::uuid`);
    expect(store).toMatchObject({
      name: "Second shop",
      legal_name: "Karis AS",
      created_by: owner.id,
      setup_completed_at: null,
      is_template: false,
    });
    expect(store.modules).toEqual(["bookings"]);
    // The original's analytics ids and own code stay with the original's site.
    expect(store.tracking).toEqual({});
    expect(store.custom_code).toEqual({});
    // Closed until set up, and no way to take a payment until the owner connects Stripe.
    expect(await count("stripe_accounts", newId)).toBe(0);
    expect(await count("payment_credentials", newId)).toBe(0);
    expect(await count("store_domains", newId)).toBe(0);
    const loaded = await stores.getStore(String(store.slug));
    expect(loaded).toMatchObject({ paymentsOn: false, setupCompletedAt: null });
    // Only the owner; not the original's staff.
    expect(await rows(sql`select account_id from commerce.store_members where store_id = ${newId}::uuid`)).toEqual([
      { account_id: owner.id },
    ]);
    const progress = await copy.copyProgress(owner, started.id);
    expect(progress).toMatchObject({
      ok: true,
      progress: {
        status: "running",
        phase: "media",
        sourceName: "Original",
        sourceSlug: slug,
        newName: "Second shop",
        mediaLeftOut: 0,
        problem: null,
      },
    });
    if (progress.ok) {
      expect(progress.progress.counts).toMatchObject({
        pages: { done: 2, total: 2 },
        posts: { done: 1, total: 1 },
        products: { done: 3, total: 3 },
        customers: { done: 0, total: 2 },
        orders: { done: 0, total: 4 },
      });
    }
    // Both stores' audit trails say so, without anything about customers.
    const [from] = await rows(
      sql`select details from commerce.audit_log where action = 'store.copied' and store_id = ${S}::uuid order by id desc limit 1`,
    );
    expect(from.details).toMatchObject({ direction: "from", customers: true, orders: true });
    expect(
      await scalar<number>(
        sql`select count(*)::int from commerce.audit_log where action = 'store.copied' and store_id = ${newId}::uuid`,
      ),
    ).toBe(1);
    expect(JSON.stringify(from.details)).not.toContain("copy.example");
    expect(await finish(started.id)).toBe("done");
  });

  it("makes the address from the name when none is given, and finds a free one", async () => {
    const name = `Karis Kopper ${run}`;
    const first = await copy.startStoreCopy(owner, { source: slug, name, slug: "", options: NOTHING }, noSchedule);
    expect(first.ok).toBe(true);
    const second = await copy.startStoreCopy(owner, { source: slug, name, slug: "", options: NOTHING }, noSchedule);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      const [a] = await rows(
        sql`select s.slug from commerce.store_copies c join commerce.stores s on s.id = c.new_store_id where c.id = ${first.id}::uuid`,
      );
      const [b] = await rows(
        sql`select s.slug from commerce.store_copies c join commerce.stores s on s.id = c.new_store_id where c.id = ${second.id}::uuid`,
      );
      expect(String(a.slug)).toMatch(/^karis-kopper-/);
      expect(b.slug).toBe(`${String(a.slug)}-2`);
      expect(await finish(first.id)).toBe("done");
      expect(await finish(second.id)).toBe("done");
    }
  });

  it("copies none, some or all of each kind", async () => {
    const none = await start(owner, NOTHING);
    if (!none.ok) throw new Error("no copy");
    const noneStore = await newStoreOf(none.id);
    expect(await count("products", noneStore)).toBe(0);
    expect(
      await scalar<number>(
        sql`select count(*)::int from commerce.pages where store_id = ${noneStore}::uuid and type in ('page', 'article')`,
      ),
    ).toBe(0);
    expect(await count("markets", noneStore)).toBe(2);
    expect(await finish(none.id)).toBe("done");

    const some = await start(owner, {
      ...NOTHING,
      products: { mode: "selected", ids: [ids.alpha] },
      posts: { mode: "all" },
      pages: { mode: "selected", ids: [ids.home] },
    });
    if (!some.ok) throw new Error("no copy");
    const someStore = await newStoreOf(some.id);
    expect(await rows(sql`select handle from commerce.products where store_id = ${someStore}::uuid`)).toEqual([
      { handle: "alpha" },
    ]);
    expect(
      await scalar<number>(sql`select count(*)::int from commerce.pages where store_id = ${someStore}::uuid`),
    ).toBe(2);
    // Nothing more to do for a copy of settings alone: no pictures, customers or orders.
    expect(await finish(some.id)).toBe("done");
  });

  it("refuses what it should, with plain reasons and nothing made", async () => {
    const stores = () => scalar<number>(sql`select count(*)::int from commerce.stores`);
    const before = await stores();
    expect(await start(staff, ALL)).toEqual({ ok: false, problems: [copy.NOT_COPYABLE] });
    expect(await start(stranger, ALL)).toEqual({ ok: false, problems: [copy.NOT_COPYABLE] });
    expect(await start(owner, ALL, { source: "no-such-store" })).toEqual({ ok: false, problems: [copy.NOT_COPYABLE] });
    // A taken or reserved address, a name that is empty, customers without the say-so.
    expect(await start(owner, ALL, { slug })).toEqual({
      ok: false,
      problems: [`The address ${slug} is taken. Choose another.`],
    });
    expect(await start(owner, ALL, { slug: "stores" })).toMatchObject({ ok: false });
    expect(await start(owner, ALL, { slug: "ab" })).toMatchObject({ ok: false });
    expect(
      await copy.startStoreCopy(owner, { source: slug, name: "  ", slug: "x-y-z", options: ALL }, noSchedule),
    ).toMatchObject({ ok: false });
    expect(await start(owner, { ...ALL, confirmDataUse: false })).toEqual({
      ok: false,
      problems: ["Confirm that you may use this customer data in the new store."],
    });
    // Chosen ids that are not the store's.
    const foreign = "00000000-0000-4000-8000-000000000001";
    expect(await start(owner, { ...ALL, products: { mode: "selected", ids: [foreign] } })).toMatchObject({ ok: false });
    expect(await start(owner, { ...ALL, pages: { mode: "selected", ids: [ids.post] } })).toMatchObject({ ok: false });
    expect(await copy.startStoreCopy(owner, "not an object", noSchedule)).toMatchObject({ ok: false });
    expect(await stores()).toBe(before);
  });

  it("keeps to the owner's limit of stores and of copies running at once", async () => {
    const limited = await account("limited");
    // Owns ten stores already.
    for (let i = 0; i < 10; i += 1) {
      const [s] = await rows(
        sql`insert into commerce.stores (slug, name) values (${nextSlug("lim")}, 'Limit') returning id`,
      );
      await db().execute(
        sql`insert into commerce.store_members (store_id, account_id, role) values (${String(s.id)}::uuid, ${limited.id}::uuid, 'owner')`,
      );
    }
    const [own] = await rows(
      sql`select s.slug from commerce.stores s join commerce.store_members m on m.store_id = s.id where m.account_id = ${limited.id}::uuid limit 1`,
    );
    expect(await start(limited, NOTHING, { source: String(own.slug) })).toEqual({
      ok: false,
      problems: [`You can own up to ${10} stores. Contact Kaizen for more.`],
    });
    // A platform admin has no limit, but no more than three copies at once either.
    const busy = await account("busy", true);
    const running: string[] = [];
    for (let i = 0; i < copy.COPIES_RUNNING_MAX; i += 1) {
      const result = await start(busy, NOTHING);
      expect(result.ok).toBe(true);
      if (result.ok) running.push(result.id);
    }
    expect(await start(busy, NOTHING)).toEqual({
      ok: false,
      problems: ["You already have stores being copied. Wait for one to finish, then try again."],
    });
    for (const id of running) expect(await finish(id)).toBe("done");
    // Once they are done, another can start.
    const another = await start(busy, NOTHING);
    expect(another.ok).toBe(true);
    if (another.ok) expect(await finish(another.id)).toBe("done");
  });

  it("shows a copy's progress to the account that started it, and to nobody else", async () => {
    const started = await start(owner, NOTHING);
    if (!started.ok) throw new Error(started.problems.join(" "));
    const same = { ok: false, problems: ["This copy could not be found."] };
    expect(await copy.copyProgress(staff, started.id)).toEqual(same);
    expect(await copy.copyProgress(admin, started.id)).toEqual(same);
    expect(await copy.copyProgress(owner, "not-an-id")).toEqual(same);
    expect(await copy.copyProgress(owner, "00000000-0000-4000-8000-000000000009")).toEqual(same);
    const list = await copy.listStoreCopies(owner);
    expect(list[0]).toMatchObject({ id: started.id, status: "running", sourceSlug: slug });
    expect(list.length).toBeLessThanOrEqual(20);
    expect((await copy.listStoreCopies(stranger)).length).toBe(0);
    expect(await finish(started.id)).toBe("done");
  });
});

describe("a whole copy, run to the end", () => {
  let copyId: string;
  let N: string;
  let newSlug: string;

  beforeAll(async () => {
    await tidy(owner);
    copied.length = 0;
    const started = await start(owner, ALL, { name: "Whole copy" });
    if (!started.ok) throw new Error(started.problems.join());
    copyId = started.id;
    N = await newStoreOf(copyId);
    [{ slug: newSlug }] = (await rows(sql`select slug from commerce.stores where id = ${N}::uuid`)) as {
      slug: string;
    }[];
    // A first run that stops on its time budget, then the rest.
    await copy.runStoreCopy(copyId, { ...fastDeps, budgetMs: 0 });
    expect(await finish(copyId)).toBe("done");
  });

  it("goes through the phases to done, with what was asked for done", async () => {
    const result = await copy.copyProgress(owner, copyId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.progress).toMatchObject({ status: "done", phase: "done", problem: null });
    expect(result.progress.finishedAt).not.toBeNull();
    expect(result.progress.counts).toMatchObject({
      customers: { done: 2, total: 2 },
      orders: { done: 4, total: 4 },
      products: { done: 3, total: 3 },
    });
    // Nothing more to do: another run finds it done and copies nothing.
    const filesBefore = copied.length;
    expect(await copy.runStoreCopy(copyId, fastDeps)).toBe("done");
    expect(copied.length).toBe(filesBefore);
  });

  it("copies each file once into the new store's folder and library, with its alt text, however often it is used", async () => {
    const own = copied.filter((c) => c.to.startsWith(`${N}/`));
    // a (with its small copy), b, the video, the logo, the favicon (two), the field file; not the broken picture.
    expect(copied.map((c) => c.from).sort()).toEqual(
      [
        `${S}/a.webp`,
        `${S}/a-480.webp`,
        `${S}/b.webp`,
        `${S}/hero.mp4`,
        `${S}/logo.webp`,
        `${S}/fav.png`,
        `${S}/fav-64.png`,
        `${S}/0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f-price-list.pdf`,
      ].sort(),
    );
    expect(own.length).toBe(copied.length);
    expect(new Set(copied.map((c) => c.to)).size).toBe(copied.length);
    // The library of the new store holds them; the shoe's alt text came along.
    const library = await rows(
      sql`select file_name, alt, alt_source, bucket, path from commerce.media where store_id = ${N}::uuid order by created_at, file_name`,
    );
    expect(library.filter((m) => m.file_name === "a.webp")).toMatchObject([
      { alt: "A red shoe", alt_source: "staff", bucket: "product-media" },
    ]);
    expect(library.every((m) => String(m.path).startsWith(`${N}/`))).toBe(true);
    expect(library.some((m) => m.file_name === "broken.webp")).toBe(false);
    // The original's library is as it was.
    expect(await count("media", S)).toBe(4);
  });

  it("points nothing of the new store at the original's files, and leaves out what could not be copied", async () => {
    expect(await copy.copyProgress(owner, copyId)).toMatchObject({ progress: { mediaLeftOut: 1 } });
    const nothingLeft = await rows<{ t: string }>(sql`
      select relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'commerce' and c.relkind = 'r' and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'store_id' and not a.attisdropped)
    `);
    for (const { t } of nothingLeft) {
      if (["orders", "order_events", "customers", "order_lines"].includes(t) || COPY_RULES[t]?.group === "never")
        continue;
      const hits = await scalar<number>(
        sql`select count(*)::int from ${sql.raw(`commerce.${t}`)} x where x.store_id = ${N}::uuid and to_jsonb(x)::text like ${`%/storage/v1/object/public/%/${S}/%`}`,
      );
      expect([t, hits]).toEqual([t, 0]);
    }
    // Products: the shared picture is the new store's; the broken one and gamma's only picture are gone (gamma is off sale).
    const pictures = (handle: string) =>
      rows(
        sql`select m.url, m.thumbnail_url from commerce.product_media m join commerce.products p on p.id = m.product_id where p.store_id = ${N}::uuid and p.handle = ${handle} order by m.position`,
      );
    const alpha = await pictures("alpha");
    expect(alpha.map((p) => p.url)).toEqual([
      expect.stringContaining(`/product-media/${N}/`),
      "https://example.com/other.jpg",
    ]);
    expect(String(alpha[0].thumbnail_url)).toContain(`/${N}/`);
    expect(await pictures("gamma")).toEqual([]);
    expect(
      await scalar(sql`select status from commerce.products where store_id = ${N}::uuid and handle = 'gamma'`),
    ).toBe("draft");
    expect(
      await scalar(sql`select status from commerce.products where store_id = ${N}::uuid and handle = 'alpha'`),
    ).toBe("active");
    // beta has the same picture as alpha: one copy.
    const betaPicture = (await pictures("beta"))[0];
    expect(betaPicture.url).toBe(alpha[0].url);
    expect(
      await scalar(sql`select image_url from commerce.product_variants where store_id = ${N}::uuid and sku = 'A1'`),
    ).toContain(`/${N}/`);
    // The page: pictures replaced, the background that failed dropped, the video and its still, the CSS.
    const home = await scalar<{
      rows: {
        id: string;
        background?: { type: string; image?: { url: string }; video?: { url: string }; poster?: { url: string } };
        columns: { blocks: { image?: { url: string } | null }[] }[];
      }[];
      css: string;
    }>(sql`select draft from commerce.pages where store_id = ${N}::uuid and slug = 'home'`);
    expect(storeFileUrls(home, S)).toEqual([]);
    expect(home.rows[0].background?.image?.url).toContain(`/${N}/`);
    expect(home.rows[0].columns[0].blocks[0].image?.url).toContain(`/${N}/`);
    expect(home.rows[1].background?.video?.url).toContain(`/page-videos/${N}/`);
    expect(home.rows[1].background?.poster?.url).toContain(`/${N}/`);
    expect(home.rows[2].background).toBeUndefined();
    expect(home.rows[2].columns[0].blocks[0].image?.url).toContain(`/${N}/`);
    expect(home.css).toContain(`/${N}/`);
    expect(
      await scalar(sql`select published = draft from commerce.pages where store_id = ${N}::uuid and slug = 'home'`),
    ).toBe(true);
    // Menu picture, logo, favicon, custom CSS and the field's file are the copies'; the field file stays one level under the folder.
    expect(
      await scalar<{ image: { url: string } }[]>(sql`select items from commerce.menus where store_id = ${N}::uuid`),
    ).toSatisfy(
      (items: { image?: { url: string } }[]) =>
        items.some((i) => i.image?.url.includes(`/${N}/`)) && items.length === 3,
    );
    const [store] = await rows(sql`select navigation, custom_css from commerce.stores where id = ${N}::uuid`);
    const nav = store.navigation as { logo: { url: string }; favicon: { url: string; smallUrl: string } };
    expect([nav.logo.url, nav.favicon.url, nav.favicon.smallUrl].every((u) => u.includes(`/${N}/`))).toBe(true);
    expect(String(store.custom_css)).toContain(`/${N}/`);
    const value = await scalar<{ f_file0000001: { url: string } }>(
      sql`select values from commerce.field_values where store_id = ${N}::uuid and entity = 'product'`,
    );
    expect(value.f_file0000001.url).toMatch(new RegExp(`/field-files/${N}/[^/]+$`));
  });

  it("copies shoppers without anything that lets them sign in, and keeps who unsubscribed", async () => {
    const [vip] = await rows(
      sql`select * from commerce.customers where store_id = ${N}::uuid and lower(email) = 'vip@copy.example'`,
    );
    expect(vip).toMatchObject({
      name: "Vip",
      phone: "+4712345678",
      password_hash: null,
      auth_user_id: null,
      email_verified_at: null,
      last_sign_in_at: null,
      avatar_path: null,
    });
    expect(await count("customers", N)).toBe(2);
    for (const table of [
      "customer_sessions",
      "customer_codes",
      "customer_sign_in_links",
      "wishlists",
      "wishlist_items",
      "consents",
      "carts",
      "checkout_accounts",
    ]) {
      expect([table, await count(table, N)]).toEqual([table, 0]);
    }
    expect(await rows(sql`select email from commerce.email_opt_outs where store_id = ${N}::uuid`)).toEqual([
      { email: "gone@copy.example" },
    ]);
    expect(await count("integration_deliveries", N)).toBe(0);
  });

  it("copies order history as read-only C- orders, with nothing that acts on an order", async () => {
    expect(
      await rows(sql`select number, status from commerce.orders where store_id = ${N}::uuid order by number`),
    ).toEqual([
      { number: "C-1001", status: "paid" },
      { number: "C-1002", status: "fulfilled" },
      { number: "C-1003", status: "cancelled" },
      { number: "C-1005", status: "paid" },
    ]);
    // A balance to collect at the venue is not carried.
    expect(
      await scalar(
        sql`select balance_minor::int from commerce.orders where store_id = ${N}::uuid and number = 'C-1005'`,
      ),
    ).toBe(0);
    for (const table of [
      "payments",
      "refunds",
      "invoices",
      "credit_notes",
      "shipments",
      "order_downloads",
      "inventory_reservations",
      "email_messages",
      "bookings",
      "returns",
      "subscriptions",
      "standing_orders",
      "integration_deliveries",
    ]) {
      expect([table, await count(table, N)]).toEqual([table, 0]);
    }
    expect(
      await scalar<number>(
        sql`select count(*)::int from commerce.order_events where store_id = ${N}::uuid and type <> 'copied'`,
      ),
    ).toBe(0);
    // Stock is untouched, and the new store's own numbers start fresh.
    expect(
      await rows(sql`select on_hand::int, available::int from commerce.available_stock where store_id = ${N}::uuid`),
    ).toEqual([{ on_hand: 5, available: 5 }]);
    expect(
      await scalar(
        sql`select next_number::int from commerce.document_series where store_id = ${N}::uuid and series = 'order'`,
      ),
    ).toBe(1001);
    // The original's orders are as they were.
    expect(
      await scalar<number>(
        sql`select count(*)::int from commerce.orders where store_id = ${S}::uuid and copied_from is not null`,
      ),
    ).toBe(0);
    expect(await count("payments", S)).toBe(1);
  });

  it("copies the stock settings (rank, policy, backorder days, warning level), and writes the copy's own opening movements, never the original's", async () => {
    expect(await rows(sql`select name, priority from commerce.inventory_locations where store_id = ${N}::uuid`)).toEqual([{ name: "Lager", priority: 3 }]);
    expect(
      await rows(sql`select stock_policy, backorder_days, low_stock_threshold from commerce.product_variants where store_id = ${N}::uuid and sku = 'A1'`),
    ).toEqual([{ stock_policy: "continue", backorder_days: 6, low_stock_threshold: 2 }]);
    // The other variants keep the defaults.
    expect(
      await scalar<number>(sql`select count(*)::int from commerce.product_variants where store_id = ${N}::uuid and sku <> 'A1' and (stock_policy <> 'deny' or low_stock_threshold is not null)`),
    ).toBe(0);
    // The history is the copy's own: one opening movement for the level it was given, none of the original's sales or adjustments.
    expect(
      await rows(sql`select delta::int, on_hand_after::int, reason, source, order_id from commerce.inventory_movements where store_id = ${N}::uuid`),
    ).toEqual([{ delta: 5, on_hand_after: 5, reason: "opening", source: "copy", order_id: null }]);
    // The original's history is untouched by the copy.
    expect(await count("inventory_movements", S)).toBeGreaterThanOrEqual(1);
    // The warning state is worked out again from the copied figures (5 on hand, level 2: fine), never copied: nothing is pending to tell.
    expect(await rows(sql`select state, crossed_at from commerce.stock_alerts where store_id = ${N}::uuid`)).toEqual([{ state: "ok", crossed_at: null }]);
  });

  it("lets a copied order reserve, back-order and write no movement", async () => {
    const [line] = await rows(sql`
      select ol.id, ol.order_id, ol.variant_id, ol.backorder_quantity::int as backorder from commerce.order_lines ol
      join commerce.orders o on o.id = ol.order_id where o.store_id = ${N}::uuid and o.number = 'C-1001' limit 1
    `);
    // A copied order's lines never carry a backorder, and the database refuses a movement or a hold written for it.
    expect(line?.backorder ?? 0).toBe(0);
    expect(await count("inventory_reservations", N)).toBe(0);
    const levelBefore = await scalar<number>(sql`select coalesce(sum(on_hand), 0)::int from commerce.inventory_levels where store_id = ${N}::uuid`);
    expect(levelBefore).toBe(5);
    await expect(
      rows(sql`
        insert into commerce.inventory_movements (store_id, variant_id, location_id, delta, on_hand_after, reason, source, order_id)
        values (${N}::uuid, ${String(line.variant_id)}::uuid, (select id from commerce.inventory_locations where store_id = ${N}::uuid limit 1), -1, 4, 'sale', 'order', ${String(line.order_id)}::uuid)
      `),
    ).rejects.toThrow();
    expect(await scalar<number>(sql`select coalesce(sum(on_hand), 0)::int from commerce.inventory_levels where store_id = ${N}::uuid`)).toBe(5);
  });

  it("copies the referral program's rules and nothing of its links, who came through them or what they were given", async () => {
    expect(await rows(sql`
      select enabled, reward_bps, reward_orders, friend_percent, friend_max_minor, monthly_cap_minor, cookie_days
      from commerce.affiliate_settings where store_id = ${N}::uuid
    `)).toEqual([
      { enabled: true, reward_bps: 700, reward_orders: 3, friend_percent: 12, friend_max_minor: "5000", monthly_cap_minor: "90000", cookie_days: 45 },
    ]);
    expect(await count("affiliates", N)).toBe(0);
    expect(await count("affiliate_attributions", N)).toBe(0);
    // A copied shopper is nobody's friend, and a copied order carries no referral discount.
    expect(await scalar<number>(sql`select count(*)::int from commerce.customers where store_id = ${N}::uuid and referred_by_customer_id is not null`)).toBe(0);
    expect(await scalar<number>(sql`select coalesce(sum(referral_discount_minor), 0)::int from commerce.orders where store_id = ${N}::uuid`)).toBe(0);
    expect(await scalar<number>(sql`select coalesce(sum(referral_discount_minor), 0)::int from commerce.order_lines where store_id = ${N}::uuid`)).toBe(0);
    // The original keeps all of it.
    expect(await count("affiliate_attributions", S)).toBe(1);
  });

  it("copies nothing that belongs to the original alone", async () => {
    const tables = await rows<{ relname: string }>(sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'commerce' and c.relkind = 'r'
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'store_id' and not a.attisdropped)
    `);
    // The level inserts write the copy's own opening movements (wave 3, D172): one for each level that holds stock.
    const [openings] = await rows<{ n: number }>(sql`select count(*)::int as n from commerce.inventory_levels where store_id = ${N}::uuid and on_hand <> 0`);
    const made = new Map([
      ["document_series", 5],
      ["payment_providers", 1],
      ["store_members", 1],
      ["audit_log", 2],
      ["inventory_movements", Number(openings.n)],
      // The warning state of each variant that has a level is worked out again from the copied figures (D172).
      ["stock_alerts", 1],
    ]);
    for (const { relname } of tables) {
      if (COPY_RULES[relname].group !== "never") continue;
      expect([relname, await count(relname, N)]).toEqual([relname, made.get(relname) ?? 0]);
    }
    expect(newSlug.startsWith("cs-")).toBe(true);
  });

  it("keeps copied orders out of every figure, list and job", async () => {
    const store = await stores.getStore(newSlug);
    if (!store) throw new Error("no store");
    const ctx = { store };
    const funnel = await insights.salesFunnel(ctx, { days: 60 });
    expect(funnel).toMatchObject({ orders_placed: 0, orders_paid: 0 });
    const trend = await insights.salesTrend(ctx, { period: "month", count: 3 });
    expect(JSON.stringify(trend)).not.toMatch(/2390|23\.90/);
    expect(await insights.customerInsights(ctx, { days: 90 })).toMatchObject({});
    const board = await center.controlCenter(owner, newSlug);
    const figures = board.stores[0];
    expect(board.latest).toEqual([]);
    expect(JSON.stringify(figures.sales)).not.toContain("2390");
    expect(JSON.stringify(figures)).not.toMatch(/"toSend":[1-9]/);
    // The order list shows them as history, and never as something to send or collect.
    const all = await orders.listOrders(N);
    expect(all.map((o) => [o.number, o.copied])).toEqual(
      expect.arrayContaining([
        ["C-1001", true],
        ["C-1002", true],
        ["C-1003", true],
      ]),
    );
    expect(await orders.listOrders(N, { toSend: true })).toEqual([]);
    expect(await orders.listOrders(N, { unpaid: true })).toEqual([]);
    // Codes and campaigns count no use from copied orders.
    const codes = await discounts.listDiscounts(N);
    expect(codes.map((c) => [c.code, c.used, c.given])).toEqual([["ALL10", 0, {}]]);
    // A shopper who signs up with the same email is not handed the history.
    const [vip] = await rows(
      sql`select id from commerce.customers where store_id = ${N}::uuid and lower(email) = 'vip@copy.example'`,
    );
    await customers.claimOrders(N, String(vip.id), "buyer-1001@copy.example");
    expect(await customers.listCustomerOrders(N, String(vip.id))).toEqual([]);
    const paid = String(
      await scalar(sql`select id from commerce.orders where store_id = ${N}::uuid and number = 'C-1001'`),
    );
    expect(await customers.ownsOrder(N, String(vip.id), paid)).toBe(false);
    // The customer page counts what they bought, not what was copied, but lists it.
    const summary = await customerAdmin.customerSummary(N, String(vip.id));
    expect(summary).toMatchObject({ orders: 0, spentMinor: {} });
    const ref = await customerAdmin.findCustomer(N, String(vip.id));
    const detail = ref ? await customerAdmin.getCustomerDetail(N, ref) : null;
    expect(detail?.orderList.map((o) => [o.number, o.copied])).toEqual([["C-1001", true]]);
    // No job or action finds a copied order to mail, ship, refund or charge.
    const [row] = await rows(sql`select count(*)::int as n from commerce.email_messages where store_id = ${N}::uuid`);
    for (const job of [
      () => cartReminders.sendDueCartReminders(),
      () => emails.sendDueBookingReminders(),
      () => standing.prepareDueDeliveries(),
      () => hostPayments.payHostCommissions(),
      () => integrations.deliverDue(),
    ]) {
      await job();
    }
    expect(
      await scalar<number>(sql`select count(*)::int from commerce.email_messages where store_id = ${N}::uuid`),
    ).toBe(Number(row.n));
    expect(await count("payments", N)).toBe(0);
    expect(await count("integration_deliveries", N)).toBe(0);
    expect(await emails.sendOrderConfirmation(N, paid)).toBeNull();
    expect(
      await emails.sendShipped(N, paid, { id: "x", carrier: "DHL", trackingNumber: "1", trackingUrl: null }),
    ).toBeNull();
    // Nothing can be changed on one: a plain reason, and the database says no as well.
    expect(
      await orderAdmin.markSent(N, paid, { carrier: "posten", trackingNumber: "1", trackingUrl: null }, null),
    ).toEqual({ ok: false, reason: "copied" });
    expect(await orderAdmin.refundOrder(N, paid, { amountMinor: 0, reason: "x", restock: [] }, null)).toEqual({
      ok: false,
      problem: orderAdmin.COPIED_ORDER_MESSAGE,
    });
    expect(await orderAdmin.cancelOrder(N, paid, "x", null)).toEqual({
      ok: false,
      problem: orderAdmin.COPIED_ORDER_MESSAGE,
    });
    expect(await orderAdmin.updateOrderContact(N, paid, { email: "x@example.com", shippingAddress: {} })).toBe(false);
    expect(await orderAdmin.markBalancePaid(N, paid, "card", null)).toBe(false);
    await expect(orderAdmin.addOrderNote(N, paid, "hello", "me")).rejects.toThrow(/read-only/);
    await expect(
      db().execute(sql`update commerce.orders set status = 'cancelled' where id = ${paid}::uuid`),
    ).rejects.toThrow();
    const view = await orderAdmin.getOrderAdmin(N, paid);
    expect(view).toMatchObject({ copied: true, canRefund: false, refundableMinor: 0 });
  });
});

describe("a copy that stops", () => {
  beforeAll(async () => {
    await tidy(owner);
  });

  it("is taken up again where it stopped, by one run at a time", async () => {
    const started = await start(owner, { ...NOTHING, products: { mode: "selected", ids: [ids.alpha] } });
    if (!started.ok) throw new Error(started.problems.join(" "));
    copied.length = 0;
    // A run that holds the claim keeps others out.
    await db().execute(
      sql`update commerce.store_copies set claimed_until = now() + interval '1 hour' where id = ${started.id}::uuid`,
    );
    expect(await copy.runStoreCopy(started.id, fastDeps)).toBe("busy");
    expect(copied).toEqual([]);
    // A claim that ran out is taken up by the job, which finishes the copy.
    await db().execute(
      sql`update commerce.store_copies set claimed_until = now() - interval '1 minute' where id = ${started.id}::uuid`,
    );
    for (let i = 0; i < 10; i += 1) {
      const outcome = await copy.runStoreCopies(fastDeps);
      if (outcome.ran === 0) break;
    }
    expect(await copy.copyProgress(owner, started.id)).toMatchObject({ progress: { status: "done" } });
  });

  it("goes on with the files it has not copied, never copying one twice", async () => {
    const started = await start(owner, {
      ...NOTHING,
      products: { mode: "selected", ids: [ids.alpha] },
      pages: { mode: "all" },
    });
    if (!started.ok) throw new Error(started.problems.join(" "));
    copied.length = 0;
    // Storage is slow: each run gets a few files done, and the next takes up from there.
    const slow = async (bucket: string, from: string, to: string) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return fakeCopy(bucket, from, to);
    };
    let runs = 0;
    let outcome = "paused";
    while (outcome === "paused" && runs < 40) {
      outcome = await copy.runStoreCopy(started.id, { ...fastDeps, copyFile: slow, budgetMs: 20 });
      runs += 1;
    }
    expect(outcome).toBe("done");
    expect(runs).toBeGreaterThan(1);
    expect(new Set(copied.map((c) => c.from)).size).toBe(copied.length);
  });

  it("stops with a plain reason when its steps keep failing", async () => {
    const started = await start(owner, NOTHING);
    if (!started.ok) throw new Error(started.problems.join(" "));
    const outcomes: string[] = [];
    for (let i = 0; i < copy.COPY_MAX_ATTEMPTS + 2 && outcomes.at(-1) !== "failed"; i += 1) {
      outcomes.push(
        await copy.runStoreCopy(started.id, {
          ...fastDeps,
          rebuild: async () => {
            throw new Error("boom");
          },
        }),
      );
    }
    expect(outcomes.at(-1)).toBe("failed");
    const progress = await copy.copyProgress(owner, started.id);
    expect(progress).toMatchObject({ ok: true, progress: { status: "failed" } });
    if (progress.ok) expect(progress.progress.problem).toMatch(/copy stopped/i);
    // Nothing runs a failed copy again.
    expect(await copy.runStoreCopy(started.id, fastDeps)).toBe("failed");
  });

  it("refuses to finish a copy that still names the original's files", async () => {
    const started = await start(owner, NOTHING);
    if (!started.ok) throw new Error(started.problems.join(" "));
    const newId = await newStoreOf(started.id);
    const outcome = await copy.runStoreCopy(started.id, {
      ...fastDeps,
      rebuild: async () => {
        await db().execute(sql`
          insert into commerce.pages (store_id, type, slug, draft) values (${newId}::uuid, 'page', 'leak', ${JSON.stringify({ title: "x", picture: url("product-media", "a.webp") })}::jsonb)
        `);
      },
    });
    expect(outcome).toBe("failed");
    const progress = await copy.copyProgress(owner, started.id);
    if (progress.ok) expect(progress.progress.problem).toMatch(/could not be separated/);
  });
});
