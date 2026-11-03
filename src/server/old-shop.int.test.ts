import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { auditActions, redirectFixture, type RedirectFixture } from "./redirect-test-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.REPLICATE_ALLOW_PRIVATE = "1";

const old = await import("./old-shop");
const nf = await import("./not-found");

type Row = Record<string, unknown>;

/**
 * The old shop's address check (D445 step 1, `docs/moving-from-shopify.md` 8.2): an old shop on this machine answers its sitemap (an index
 * with a gzipped child, a language folder, another host's address); the check keeps its addresses, says where each leads, fixes the sure ones
 * in one press, takes a suggestion through the 404 report's door, and forgets. A shop without `/sitemap.xml` is read from its robots.txt; a
 * shop with neither says so. Only `website:write` reads and fixes; `website:read` sees.
 */

let f: RedirectFixture;
const servers: http.Server[] = [];
let shop = "";
let robotsOnly = "";
let nothing = "";

const urlset = (origin: string, paths: string[]) =>
  `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${p.startsWith("http") ? p : origin + p}</loc></url>`).join("")}</urlset>`;

async function serve(answer: (path: string, origin: string) => { type: string; body: string | Buffer } | null): Promise<string> {
  let origin = "";
  const server = http.createServer((request, response) => {
    const found = answer(request.url ?? "/", origin);
    if (!found) {
      response.writeHead(404, { "content-type": "text/html" }).end("<html>Not found</html>");
      return;
    }
    response.writeHead(200, { "content-type": found.type }).end(found.body);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  servers.push(server);
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return origin;
}

beforeAll(async () => {
  f = await redirectFixture("oldshop");
  const handle = f.product.handle;
  shop = await serve((path, origin) => {
    if (path === "/sitemap.xml")
      return {
        type: "application/xml",
        body: `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${origin}/sitemap_products_1.xml.gz</loc></sitemap><sitemap><loc>${origin}/sitemap_pages_1.xml</loc></sitemap><sitemap><loc>https://elsewhere.example/sitemap.xml</loc></sitemap></sitemapindex>`,
      };
    if (path === "/sitemap_products_1.xml.gz")
      return { type: "application/gzip", body: gzipSync(urlset(origin, [`/products/${handle}`, `/en/products/${handle}`, "/products/missing-thing", `/collections/${f.category.slug}`, "https://cdn.example/products/x"])) };
    if (path === "/sitemap_pages_1.xml") return { type: "application/xml", body: urlset(origin, ["/", "/pages/about", "/blogs/news/winter"]) };
    return null;
  });
  robotsOnly = await serve((path, origin) => {
    if (path === "/robots.txt") return { type: "text/plain", body: `User-agent: *\nDisallow: /cart\nSitemap: ${origin}/maps/main.xml\n` };
    if (path === "/maps/main.xml") return { type: "application/xml", body: urlset(origin, ["/pages/contact"]) };
    return null;
  });
  nothing = await serve(() => null);
});

afterAll(async () => {
  for (const server of servers) server.close();
  await closeDb();
});

const kept = async (): Promise<Row | undefined> => (await db().execute<Row>(sql`select origin, paths, files, truncated, read_by from commerce.old_shops where store_id = ${f.fx.storeId}::uuid`))[0];

describe("reading the old shop", () => {
  it("is refused without the right to change the website, and for an address that is not one", async () => {
    expect(await old.readOldShop(f.reader, shop)).toEqual({ ok: false, problem: "forbidden" });
    expect(await old.readOldShop(f.owner, "not an address at all")).toEqual({ ok: false, problem: "address" });
    expect(await kept()).toBeUndefined();
  });

  it("keeps the shop's own addresses from the index and its files, a gzipped one too, once each, without the front page or another host's", async () => {
    const read = await old.readOldShop(f.owner, shop);
    expect(read).toEqual({ ok: true, addresses: 5, files: 3, truncated: false });
    const row = (await kept())!;
    expect(row.origin).toBe(shop);
    expect([...(row.paths as string[])].sort()).toEqual(["/blogs/news/winter", `/collections/${f.category.slug}`, "/pages/about", `/products/${f.product.handle}`, "/products/missing-thing"].sort());
    expect(row.read_by).toBe(f.owner.account.id);
    expect((await auditActions(f.fx.storeId, "redirects.old_shop")).map((r) => [r.action, r.area, (r.details as Row).addresses])).toEqual([["redirects.old_shop_read", "website", 5]]);
  });

  it("finds the sitemap robots.txt names, and says when there is none", async () => {
    const other = await redirectFixture("oldshop-robots");
    expect(await old.readOldShop(other.owner, robotsOnly)).toEqual({ ok: true, addresses: 1, files: 1, truncated: false });
    expect(await old.readOldShop(other.owner, nothing)).toEqual({ ok: false, problem: "no_sitemap" });
    expect(await old.readOldShop(other.owner, "http://127.0.0.1:1")).toEqual({ ok: false, problem: "unreachable" });
  });
});

describe("the check", () => {
  it("says where each old link leads, which are sure, and counts both shops", async () => {
    expect(await old.oldShopCheck(f.outsider)).toBeNull();
    const check = (await old.oldShopCheck(f.reader))!;
    expect(check.total).toBe(5);
    expect(check.working).toBe(0);
    expect(check.sure).toBe(2);
    expect(check.needing.slice(0, 2).map((r) => [r.path, r.sure])).toEqual(
      [
        [`/collections/${f.category.slug}`, `/category/${f.category.slug}`],
        [`/products/${f.product.handle}`, `/p/${f.product.handle}`],
      ].sort((a, b) => a[0].localeCompare(b[0])),
    );
    expect(check.byKind.map((k) => [k.kind, k.total, k.working])).toEqual([
      ["product", 2, 0],
      ["category", 1, 0],
      ["page", 1, 0],
      ["article", 1, 0],
    ]);
    expect(check.here.product).toBeGreaterThanOrEqual(1);
    expect(check.here.category).toBeGreaterThanOrEqual(1);
  });

  it("fixes the sure ones in one press, only for a member who may, and leaves the rest", async () => {
    expect(await old.fixOldShop(f.reader)).toEqual({ ok: false, problem: "forbidden" });
    expect(await old.fixOldShop(f.owner)).toEqual({ ok: true, written: 2, refused: 0 });
    const rows = await db().execute<Row>(sql`select source, target, origin from commerce.redirects where store_id = ${f.fx.storeId}::uuid and kind = 'manual' order by source`);
    expect(rows.map((r) => [r.source, r.target, r.origin])).toEqual([
      [`/collections/${f.category.slug}`, `/category/${f.category.slug}`, "import"],
      [`/products/${f.product.handle}`, `/p/${f.product.handle}`, "import"],
    ]);
    const check = (await old.oldShopCheck(f.owner))!;
    expect([check.working, check.sure, check.needing.map((r) => r.path).sort()]).toEqual([2, 0, ["/blogs/news/winter", "/pages/about", "/products/missing-thing"]]);
    expect((await auditActions(f.fx.storeId, "redirects.old_shop_fixed")).map((r) => (r.details as Row).written)).toEqual([2]);
    // A second press has nothing left to do.
    expect(await old.fixOldShop(f.owner)).toEqual({ ok: true, written: 0, refused: 0 });
  });

  it("takes a chosen target through the 404 report's door, and the link then leads somewhere", async () => {
    const made = await nf.redirectFromReport(f.owner, { path: "/pages/about", to: `/p/${f.product.handle}` });
    expect(made.ok).toBe(true);
    const check = (await old.oldShopCheck(f.owner))!;
    expect(check.working).toBe(3);
    expect(check.byKind.find((k) => k.kind === "page")).toEqual({ kind: "page", total: 1, working: 1 });
  });

  it("is forgotten on request, and the redirects stay", async () => {
    expect(await old.forgetOldShop(f.reader)).toEqual({ ok: false });
    expect(await old.forgetOldShop(f.owner)).toEqual({ ok: true });
    expect(await kept()).toBeUndefined();
    expect(await old.oldShopCheck(f.owner)).toBeNull();
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.redirects where store_id = ${f.fx.storeId}::uuid and kind = 'manual'`);
    expect(n).toBe(3);
  });
});
