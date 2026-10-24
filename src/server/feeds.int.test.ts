import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { shown } from "@/lib/markets";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { NO, NO_EUR } = await import("./fulfilment-test-fixture");
const { storeFeed } = await import("./feeds");
const { feedSettingsOf, switchFeedsOff, switchFeedsOn } = await import("./feed-settings");
const { getStore } = await import("./stores");
const { GET } = await import("@/app/api/feeds/[token]/[file]/route");

/** Product feeds (wave 5 unit H, D302, `docs/wave-5-marketing.md` 13) against the template's demo catalogue. */

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const slug = `feeds-${run}`;
let storeId: string;
let accountId: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Kari', 'Feeds') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Feeds', null) as id`);
  storeId = String(store.id);
  const [member] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  accountId = String(member.account_id);
  await db().execute(sql`update commerce.stores set setup_completed_at = now() where id = ${storeId}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

const call = (token: string, file: string) => GET(new Request("http://localhost/x"), { params: Promise.resolve({ token, file }) } as never);

describe("storeFeed", () => {
  it("lists goods with the storefront's price, and leaves out what cannot be advertised with why", async () => {
    const store = (await getStore(slug))!;
    const feed = await storeFeed(store, NO);
    expect(feed.items.length).toBeGreaterThan(0);
    for (const item of feed.items) {
      expect(item.currency).toBe("NOK");
      expect(item.link).toContain("/p/");
      expect(item.images[0]).toMatch(/^https?:\/\//);
      expect(item.country).toBe("NO");
    }
    // A product with no picture is left out, and says so.
    const product = feed.items[0].groupId;
    await db().execute(sql`delete from commerce.product_media where product_id = ${product}::uuid`);
    await db().execute(sql`update commerce.product_variants set image_url = null, image_thumbnail_url = null where product_id = ${product}::uuid`);
    const after = await storeFeed(store, NO);
    expect(after.items.some((i) => i.groupId === product)).toBe(false);
    expect(after.leftOut.find((p) => p.productId === product)?.problems).toEqual(["no_picture"]);
  });

  it("prices a euro view as the storefront shows it", async () => {
    const store = (await getStore(slug))!;
    const nok = await storeFeed(store, NO);
    const eur = await storeFeed(store, NO_EUR);
    expect(eur.items.map((i) => i.id)).toEqual(nok.items.map((i) => i.id));
    eur.items.forEach((item, n) => {
      expect(item.currency).toBe("EUR");
      expect(item.priceMinor).toBe(shown(NO_EUR, nok.items[n].priceMinor));
    });
  });
});

describe("the feed address", () => {
  it("answers only to the store's token while feeds are on", async () => {
    expect(await feedSettingsOf(storeId)).toBeNull();
    expect((await switchFeedsOn(storeId, accountId)).ok).toBe(true);
    const { token } = (await feedSettingsOf(storeId))!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const google = await call(token!, "no-google.xml");
    expect(google.status).toBe(200);
    expect(google.headers.get("content-type")).toContain("xml");
    expect(await google.text()).toContain("<g:price>");
    const meta = await call(token!, "no-meta.csv");
    expect((await meta.text()).split("\n")[0]).toContain("id,title,description");

    expect((await call("x".repeat(32), "no-google.xml")).status).toBe(404);
    expect((await call(token!, "no-google.csv")).status).toBe(404);
    expect((await call(token!, "zz-google.xml")).status).toBe(404);

    // A new address stops the old one at once.
    await switchFeedsOn(storeId, accountId, { renew: true });
    expect((await call(token!, "no-google.xml")).status).toBe(404);
    const renewed = (await feedSettingsOf(storeId))!.token!;
    expect((await call(renewed, "no-google.xml")).status).toBe(200);

    await switchFeedsOff(storeId, accountId);
    expect((await call(renewed, "no-google.xml")).status).toBe(404);
  });
});
