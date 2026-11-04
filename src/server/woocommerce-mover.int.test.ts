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
const data = depsWith(storage);
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
        return answer({ seo: query.ids?.split(",").includes("21") ? [{ id: 21, title: "Mover hat | Kari", description: "The warmest hat." }] : [] });
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
      return list(page === 1 ? [{ id: 21, type: "simple", slug: "mover-hat", name: "Mover hat", status: "publish", description: "<p>Warm</p>", price: "199.00", sku: "MOVER-HAT", manage_stock: false, virtual: false, weight: "", tags: [], categories: [], images: [], attributes: [] }] : []);
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
    expect(done).toEqual({ status: 200, back: expect.stringMatching(new RegExp(`/admin/${fx.slug}/settings/moving\\?mover=connected$`)) });
    const [row] = await db().execute<Row>(sql`select mover_secret from commerce.shop_moves where store_id = ${fx.storeId}::uuid and source = 'woocommerce'`);
    expect(String(row.mover_secret)).not.toContain(MOVER);
    expect(await connect.moverStatus(owner, { open })).toEqual({ connected: true, plugins: [{ slug: "woocommerce", name: "WooCommerce" }, { slug: "mailpoet", name: "MailPoet" }, { slug: "redirection", name: "Redirection" }] });
  });

  it("brings the redirects, MailPoet's subscribed list and the products' SEO words through their own writers", async () => {
    refused = 0;
    expect(await copy.startCopy(owner)).toEqual({ ok: true });
    await settle(owner);
    const view = (await copy.copyView(owner))!;
    expect([view.state.feeds.redirects.stage, view.state.feeds.redirects.count, view.state.feeds.subscribers.stage, view.state.feeds.subscribers.count]).toEqual(["checked", 1, "checked", 1]);
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
    const [words] = await db().execute<Row>(sql`
      select t.seo_title, t.seo_description from commerce.product_translations t join commerce.products p on p.id = t.product_id
       where p.store_id = ${fx.storeId}::uuid and p.handle = 'mover-hat' and t.seo_title <> ''`);
    expect([words?.seo_title, words?.seo_description]).toEqual(["Mover hat | Kari", "The warmest hat."]);
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
