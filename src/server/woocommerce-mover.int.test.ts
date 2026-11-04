import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { moverSignature } from "@/lib/woocommerce-mover";

import type { Membership } from "./auth";
import { depsWith, fakeStorage, membersOf, runToEnd } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";
import type { Fetched } from "./replicate-fetch";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const connect = await import("./woocommerce-connect");
const copy = await import("./shopify-copy");
const { copyDone } = await import("@/lib/shopify-copy");

type Row = Record<string, unknown>;

/**
 * Moving from WooCommerce, step 2 (D446) end to end: *Connect the plugin* sends the owner to our WordPress plugin's page with a sealed note;
 * the plugin posts its secret to `/api/woocommerce/mover` (`finishMoverConnect()`), which tries it with a signed call before keeping it; the
 * copy then reads the redirect plugins' redirects, MailPoet's subscribers and the products' SEO words through the plugin's signed routes,
 * and brings them over through the redirect import, the email list's writer and the product import. The stand-in site checks every
 * signature as the plugin does.
 */

let fx: Fixture;
let owner: Membership;
const storage = fakeStorage();
/** Pictures in pages: fetched from the stand-in site and kept in a stand-in library. */
const fetchedPictures: string[] = [];
let png = new Uint8Array();
const data = depsWith(storage, {
  fetchPicture: async (url) => {
    fetchedPictures.push(url);
    return url.includes("missing") ? { ok: false, problem: "The site answered 404." } : { ok: true, bytes: png, contentType: "image/png" };
  },
  storePicture: async (owner2, image) => ({ ok: true, url: `https://lib.test/${owner2.storeId}/${fetchedPictures.length}-${image.name}`, thumbnailUrl: `https://lib.test/t-${image.name}` }),
});
const KEY = `ck_${"3".repeat(40)}`;
const SECRET = `cs_${"4".repeat(40)}`;
const MOVER = "f".repeat(64);
let email = "";
/** Signed calls the stand-in refused. */
let refused = 0;

const answer = (body: unknown, headers: Record<string, string> = {}): Fetched => ({ ok: true, url: "https://mover.example/", status: 200, contentType: "application/json", bytes: new TextEncoder().encode(JSON.stringify(body)), headers });
const list = (items: unknown[]) => answer(items, { "x-wp-total": String(items.length), "x-wp-totalpages": "1" });

async function open(raw: string, headers?: Record<string, string>): Promise<Fetched> {
  const url = new URL(raw);
  if (url.host !== "mover.example") return { ok: false, problem: "unreachable" };
  const route = url.pathname.replace(/^\/wp-json\//, "").replace(/\/$/, "");
  if (url.pathname === "/wp-json/") return answer({ name: "Mover Woo", url: "https://mover.example", namespaces: ["wp/v2", "wc/v3", "kaizena-mover/v1"] });
  const query = Object.fromEntries(url.searchParams);
  if (route.startsWith("kaizena-mover/v1/")) {
    // As the plugin does: the signature over the time, the method, the route and the sorted query, within five minutes.
    const time = Number(headers?.["X-Kaizena-Mover-Time"]);
    const good = headers?.["X-Kaizena-Mover-Signature"] === moverSignature(MOVER, time, "GET", `/${route}`, query) && Math.abs(Date.now() / 1000 - time) <= 300;
    if (!good) {
      refused += 1;
      return { ok: false, problem: "The site answered 401.", status: 401 };
    }
    switch (route) {
      case "kaizena-mover/v1/plugins":
        return answer({ plugins: [{ slug: "woocommerce", name: "WooCommerce" }, { slug: "mailpoet", name: "MailPoet" }, { slug: "redirection", name: "Redirection" }] });
      case "kaizena-mover/v1/redirects":
        return answer({ redirects: query.page === "1" ? [{ source: "redirection", from: "/old-hat/", to: "/product/mover-hat/", regex: false }, { source: "redirection", from: "/sale/(.*)", to: "/", regex: true }] : [], more: false });
      case "kaizena-mover/v1/subscribers":
        return answer({
          subscribers:
            query.page === "1"
              ? [
                  { email, first_name: "Kari", last_name: "N", status: "subscribed", subscribed_at: "2025-03-02 10:00:00", created_at: "2025-03-01 09:00:00", confirmed_at: "2025-03-02 10:05:00" },
                  { email: `gone-${email}`, status: "unsubscribed", created_at: "2025-03-01 09:00:00" },
                ]
              : [],
          more: false,
        });
      case "kaizena-mover/v1/seo":
        return answer({
          seo: query.ids?.split(",").includes("21")
            ? [{ id: 21, plugin: "yoast", title: "Mover hat | Kari", description: "The warmest hat.", fields: { title: "%%title%% | %%sitename%%", description: "The warmest hat.", focus_keyword: "wool hat", canonical: "https://mover.example/product/mover-hat/", robots: "noindex", og_title: "Look at this hat", primary_category: "Hats" } }]
            : [],
        });
      case "kaizena-mover/v1/gift_cards":
        return answer({ currency: "NOK", cards: query.page === "1" ? [{ source: "woocommerce-gift-cards", id: 7, last4: "AB12", balance: "250.00", expires: "2030-01-31", email }] : [], more: false });
      case "kaizena-mover/v1/content":
        if (query.page !== "1") return answer({ items: [], more: false });
        return answer({
          items:
            query.type === "page"
              ? [
                  { id: 5, slug: "our-story", title: "Our story", html: `<p>We knit.</p><figure><img src="https://mover.example/wp-content/uploads/knit.jpg" alt="Knitting"></figure><p>By hand.</p><img src="https://mover.example/missing.jpg">`, published: true, author: "Kari", shortcodes: ["contact-form-7"] },
                  { id: 6, slug: "coming-soon", title: "Coming soon", html: "<p>Soon.</p>", published: false, author: "Kari", shortcodes: [] },
                ]
              : [{ id: 9, slug: "winter-is-here", title: "Winter is here", html: "<p>Time for hats.</p>", published: true, author: "Ola", shortcodes: [] }],
          more: false,
        });
      case "kaizena-mover/v1/menus":
        return answer({
          menus: [
            {
              handle: "main",
              title: "Woo main menu",
              items: [
                { title: "Home", type: "FRONTPAGE", url: "/", items: [] },
                { title: "Shop", type: "CATALOG", url: "/shop/", items: [{ title: "Hats", type: "COLLECTION", url: "/collections/hats", items: [] }] },
                { title: "Our story", type: "PAGE", url: "/pages/our-story", items: [] },
                { title: "Mover hat", type: "PRODUCT", url: "/products/mover-hat", items: [] },
              ],
            },
          ],
        });
      case "kaizena-mover/v1/seo_terms":
        return answer({ terms: query.page === "1" ? [{ name: "Hats", slug: "hats", plugin: "yoast", title: "Warm hats", description: "Every hat we knit.", fields: { title: "Warm hats", description: "Every hat we knit.", focus_keyword: "hats" } }] : [], more: false });
      default:
        return { ok: false, problem: "404", status: 404 };
    }
  }
  const key = headers?.Authorization === `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString("base64")}`;
  if (!key) return { ok: false, problem: "401", status: 401 };
  const page = Number(url.searchParams.get("page") ?? "1");
  switch (route) {
    case "wc/v3/settings/general/woocommerce_currency":
      return answer({ value: "NOK" });
    case "wc/v3/settings/tax/woocommerce_prices_include_tax":
      return answer({ value: "yes" });
    case "wc/v3/settings/products/woocommerce_weight_unit":
      return answer({ value: "kg" });
    case "wc/v3/products":
      return list(page === 1 ? [{ id: 21, type: "simple", slug: "mover-hat", name: "Mover hat", status: "publish", description: "<p>Warm</p>", price: "199.00", sku: "MOVER-HAT", manage_stock: false, virtual: false, weight: "", tags: [], categories: [{ id: 5, name: "Hats", slug: "hats" }], images: [], attributes: [] }] : []);
    default:
      return list([]);
  }
}

const deps = { open, data };

async function settle(member: Membership, max = 20): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    const state = await copy.advanceCopy(member, deps);
    for (const f of Object.values(state?.feeds ?? {})) if (f.job && (f.stage === "checking" || f.stage === "applying")) await runToEnd(f.job, data);
    const after = await copy.advanceCopy(member, deps);
    if (after && Object.values(after.feeds).every((f) => !["waiting", "reading", "checking", "applying"].includes(f.stage)) && (!after.apply || copyDone(after))) return;
  }
}

beforeAll(async () => {
  png = new Uint8Array(await (await import("sharp")).default({ create: { width: 40, height: 30, channels: 3, background: "#cc0000" } }).png().toBuffer());
  fx = await makeStore("woo-mover");
  ({ owner } = await membersOf(fx));
  email = `kari-${fx.slug}@example.com`;
  await db().execute(sql`update commerce.markets set active = (code = 'NO') where store_id = ${fx.storeId}::uuid`);
  ({ owner } = await membersOf(fx));
  const started = await connect.startWooConnect(owner, "mover.example", { open });
  if (!started.ok) throw new Error(started.problem);
  const note = new URL(started.url).searchParams.get("user_id");
  expect(await connect.finishWooConnect({ consumer_key: KEY, consumer_secret: SECRET, key_permissions: "read", user_id: note }, { open })).toBe(200);
});

afterAll(async () => {
  await closeDb();
});

describe("moving from WooCommerce, step 2: our plugin reads what WooCommerce's key cannot", () => {
  it("keeps the plugin's secret only for this owner's note, and only once a signed call works", async () => {
    expect(await connect.moverStatus(owner, { open })).toEqual({ connected: false });
    const started = await connect.startMoverConnect(owner);
    if (!started.ok) throw new Error(started.problem);
    const url = new URL(started.url);
    expect(url.origin + url.pathname).toBe("https://mover.example/wp-admin/admin.php");
    expect(url.searchParams.get("page")).toBe("kaizen-store-mover");
    const note = url.searchParams.get("note");
    // An altered note, a secret not in the plugin's shape, or one the site does not sign with: nothing kept.
    expect((await connect.finishMoverConnect({ note: `${note}x`, secret: MOVER, site: "https://mover.example" }, { open })).status).toBe(400);
    expect((await connect.finishMoverConnect({ note, secret: "short", site: "https://mover.example" }, { open })).status).toBe(400);
    expect((await connect.finishMoverConnect({ note, secret: "e".repeat(64), site: "https://mover.example" }, { open })).status).toBe(400);
    expect(await connect.hasMover(fx.storeId)).toBe(false);
    const done = await connect.finishMoverConnect({ note, secret: MOVER, site: "https://mover.example" }, { open });
    // With the new shop's own address, for the plugin's *Send shoppers to the new shop* (step 4).
    expect(done).toEqual({ status: 200, back: expect.stringMatching(new RegExp(`/admin/${fx.slug}/settings/moving\\?mover=connected$`)), shop: expect.stringMatching(/^https?:\/\//) });
    const [row] = await db().execute<Row>(sql`select mover_secret from commerce.shop_moves where store_id = ${fx.storeId}::uuid and source = 'woocommerce'`);
    expect(String(row.mover_secret)).not.toContain(MOVER);
    expect(await connect.moverStatus(owner, { open })).toEqual({ connected: true, plugins: [{ slug: "woocommerce", name: "WooCommerce" }, { slug: "mailpoet", name: "MailPoet" }, { slug: "redirection", name: "Redirection" }] });
  });

  it("brings the redirects, MailPoet's subscribed list and the products' SEO words through their own writers", async () => {
    refused = 0;
    // Only the shop: WordPress keeps its pages, posts and menus, and none of them is read.
    expect(await copy.startCopy(owner, { wordpress: "keep" })).toEqual({ ok: true });
    const shopOnly = (await copy.copyView(owner))!.state;
    expect([shopOnly.feeds.pages.stage, shopOnly.feeds.articles.stage, shopOnly.feeds.menus.stage, shopOnly.options?.wordpress]).toEqual(["empty", "empty", "empty", "keep"]);
    // Everything: they come too.
    expect(await copy.startCopy(owner, { wordpress: "move" })).toEqual({ ok: true });
    await settle(owner);
    const view = (await copy.copyView(owner))!;
    expect([view.state.feeds.redirects.stage, view.state.feeds.redirects.count, view.state.feeds.subscribers.stage, view.state.feeds.subscribers.count]).toEqual(["checked", 1, "checked", 1]);
    // The gift card plugins' cards are read now and made on move day (step 2b): none here before.
    expect([view.state.feeds.gift_cards.stage, view.state.feeds.gift_cards.count]).toEqual(["checked", 1]);
    expect(await copy.bringItOver(owner)).toEqual({ ok: true });
    await settle(owner);
    expect(copyDone((await copy.copyView(owner))!.state)).toBe(true);
    expect(refused).toBe(0);
    const [redirect] = await db().execute<Row>(sql`select target from commerce.redirects where store_id = ${fx.storeId}::uuid and source = '/old-hat'`);
    expect(redirect?.target).toBe("/product/mover-hat");
    const [sub] = await db().execute<Row>(sql`select source, status, confirmed_at, consent_text from commerce.marketing_subscribers where store_id = ${fx.storeId}::uuid and email = ${email}`);
    expect([sub?.source, sub?.status, sub?.confirmed_at !== null]).toEqual(["woocommerce", "subscribed", true]);
    expect(String(sub?.consent_text)).toMatch(/while it was on WooCommerce, as MailPoet recorded it: SUBSCRIBED, CONFIRMED_OPT_IN/);
    const [{ gone }] = await db().execute<Row>(sql`select count(*)::int as gone from commerce.marketing_subscribers where store_id = ${fx.storeId}::uuid and email = ${`gone-${email}`}`);
    expect(gone).toBe(0);
    const [{ cards }] = await db().execute<Row>(sql`select count(*)::int as cards from commerce.gift_cards where store_id = ${fx.storeId}::uuid`);
    expect(cards).toBe(0);
    const [words] = await db().execute<Row>(sql`
      select t.seo_title, t.seo_description from commerce.product_translations t join commerce.products p on p.id = t.product_id
       where p.store_id = ${fx.storeId}::uuid and p.handle = 'mover-hat' and t.seo_title <> ''`);
    expect([words?.seo_title, words?.seo_description]).toEqual(["Mover hat | Kari", "The warmest hat."]);
    // Every Yoast field as written, in the group the move made (private), on the product and on its category.
    const [group] = await db().execute<Row>(sql`select id, name, entities, fields from commerce.field_groups where store_id = ${fx.storeId}::uuid and slug = 'seo-from-wordpress'`);
    expect([group?.name, group?.entities]).toEqual(["SEO from Yoast / Rank Math", ["product", "term"]]);
    const ids = Object.fromEntries((group!.fields as { id: string; name: string; access: string }[]).map((f) => [f.name, f.id]));
    expect((group!.fields as { access: string }[]).every((f) => f.access === "private")).toBe(true);
    const [values] = await db().execute<Row>(sql`
      select v.values from commerce.field_values v join commerce.products p on p.id = v.entity_id
       where v.store_id = ${fx.storeId}::uuid and v.entity = 'product' and p.handle = 'mover-hat' and v.locale <> ''`);
    const kept = values!.values as Record<string, string>;
    expect([kept[ids.title], kept[ids.focus_keyword], kept[ids.canonical], kept[ids.robots], kept[ids.og_title], kept[ids.primary_category], kept[ids.plugin]]).toEqual([
      "%%title%% | %%sitename%%",
      "wool hat",
      "https://mover.example/product/mover-hat/",
      "noindex",
      "Look at this hat",
      "Hats",
      "Yoast SEO",
    ]);
    // The category's own words through the taxonomy's writer, and its fields beside them.
    const [hats] = await db().execute<Row>(sql`select id, seo from commerce.terms where store_id = ${fx.storeId}::uuid and kind = 'category' and name = 'Hats'`);
    expect(Object.values(hats!.seo as Record<string, unknown>)[0]).toEqual({ title: "Warm hats", description: "Every hat we knit." });
    const [termValues] = await db().execute<Row>(sql`select values from commerce.field_values where store_id = ${fx.storeId}::uuid and entity = 'term' and entity_id = ${hats!.id}::uuid and locale <> ''`);
    expect((termValues!.values as Record<string, string>)[ids.focus_keyword]).toBe("hats");
    expect((await copy.copyView(owner))!.state.feeds.seo).toMatchObject({ stage: "done", made: 2, refused: 0 });
    // WordPress's pages and posts through the page editor's writer (step 3): words as text, each picture fetched into the library as an image
    // block where it stood; a picture that cannot be fetched is left; a draft stays a draft; the post in the main blog with its author.
    const [story] = await db().execute<Row>(sql`select published -> 'rows' as rows from commerce.pages where store_id = ${fx.storeId}::uuid and type = 'page' and slug = 'our-story'`);
    const blocks = ((story!.rows as Row[])[0] as { columns: { blocks: Row[] }[] }).columns[0].blocks;
    expect(blocks.map((b) => b.type)).toEqual(["richText", "image", "richText"]);
    expect(blocks[1]).toMatchObject({ image: { width: 40, height: 30, alt: "Knitting" }, caption: "" });
    expect(String((blocks[1].image as Row).url)).toMatch(/^https:\/\/lib\.test\//);
    expect(fetchedPictures).toEqual(["https://mover.example/wp-content/uploads/knit.jpg", "https://mover.example/missing.jpg"]);
    const [soon] = await db().execute<Row>(sql`select published_at, draft is not null as drafted from commerce.pages where store_id = ${fx.storeId}::uuid and type = 'page' and slug = 'coming-soon'`);
    expect([soon?.published_at ?? null, soon?.drafted]).toEqual([null, true]);
    const [post] = await db().execute<Row>(sql`select published ->> 'author' as author from commerce.pages where store_id = ${fx.storeId}::uuid and type = 'article' and slug = 'winter-is-here'`);
    expect(post?.author).toBe("Ola");
    // The menu through the menu editor's writer, its links to the new shop's own things.
    const [menu] = await db().execute<Row>(sql`select items from commerce.menus where store_id = ${fx.storeId}::uuid and name = 'Woo main menu'`);
    expect((menu!.items as Row[]).map((i) => [i.depth, i.link])).toEqual([
      [0, { kind: "home" }],
      [0, { kind: "products" }],
      [1, { kind: "category", slug: "hats" }],
      [0, { kind: "page", slug: "our-story" }],
      [0, { kind: "product", handle: "mover-hat" }],
    ]);
  });

  it("brings a Mailchimp export's subscribed people with their moment, and nobody else (Decision 2)", async () => {
    const list = await import("./woocommerce-list");
    const csv = [
      "Email Address,First Name,Last Name,OPTIN_TIME,CONFIRM_TIME",
      `mc-${email},Mia,C,2024-03-01 10:00:00,2024-03-01 10:05:00`,
      `nodate-${email},No,Date,,`,
      // Already on the list from MailPoet: left as it is.
      `${email},Kari,N,2024-03-01 10:00:00,`,
    ].join("\n");
    expect(await list.importListExport(owner, new TextEncoder().encode(csv))).toEqual({ ok: true, source: "mailchimp", added: 1, already: 1, skipped: 1 });
    const [sub] = await db().execute<Row>(sql`select source, confirmed_at, consent_text from commerce.marketing_subscribers where store_id = ${fx.storeId}::uuid and email = ${`mc-${email}`}`);
    expect([sub?.source, sub?.confirmed_at !== null]).toEqual(["woocommerce", true]);
    expect(String(sub?.consent_text)).toMatch(/while it was on WooCommerce, as Mailchimp recorded it: SUBSCRIBED, CONFIRMED_OPT_IN/);
    expect(await list.importListExport(owner, new TextEncoder().encode("Email Address,OPTIN_TIME,UNSUB_TIME\na@example.com,2024-01-01 00:00:00,2024-02-01 00:00:00"))).toEqual({ ok: false, problem: "not_subscribed_file" });
  });

  it("takes the field group back with Undo this copy", async () => {
    const undo = await import("./shopify-undo");
    expect(await undo.undoCopy(owner)).toMatchObject({ ok: true });
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.field_groups where store_id = ${fx.storeId}::uuid and slug = 'seo-from-wordpress'`);
    expect(n).toBe(0);
    // The pages, the post and the menu the copy made go too.
    const [{ pages }] = await db().execute<Row>(sql`select count(*)::int as pages from commerce.pages where store_id = ${fx.storeId}::uuid and slug in ('our-story', 'coming-soon', 'winter-is-here')`);
    expect(pages).toBe(0);
    // The list's subscribers, MailPoet's and Mailchimp's, go too.
    const [{ subs }] = await db().execute<Row>(sql`select count(*)::int as subs from commerce.marketing_subscribers where store_id = ${fx.storeId}::uuid and source = 'woocommerce'`);
    expect(subs).toBe(0);
  });

  it("stops reading when the owner says so, and on Disconnect", async () => {
    expect(await connect.disconnectMover(owner)).toEqual({ ok: true });
    expect(await connect.hasMover(fx.storeId)).toBe(false);
    expect(await connect.moverGet(fx.storeId, "plugins", {}, { open })).toEqual({ ok: false, problem: "none" });
    expect(await connect.disconnectWoo(owner)).toEqual({ ok: true });
    const [row] = await db().execute<Row>(sql`select status, mover_secret from commerce.shop_moves where store_id = ${fx.storeId}::uuid and source = 'woocommerce'`);
    expect([row.status, row.mover_secret]).toEqual(["disconnected", null]);
  });
});
