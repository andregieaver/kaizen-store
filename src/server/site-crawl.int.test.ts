import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));

const crawl = await import("./site-crawl");
const widgets = await import("./support-widgets");
const { searchKnowledge } = await import("./knowledge");
const { systemDesk } = await import("./support-desk");
type Staff = import("./support-desk").StaffDesk;
type Deps = import("./site-crawl").CrawlDeps;

/**
 * Reading chat widgets' websites (D583): a found site is listed from its robots.txt and sitemap (or its links), its pages are read into the
 * knowledge base on the site's own host only and cut again only when they change, and a widget's chat finds its own sites' pages, never
 * another widget's, while the store's own chat finds none of them.
 */

const run = Date.now().toString(36);
let storeId: string;
let owner: Staff;

/** A small web: an address's answer, or a 404. `fetched` counts what was asked. */
function web(pages: Record<string, { body: string; type?: string; url?: string; status?: number }>) {
  const fetched: string[] = [];
  const fetchPage = (async (url: string) => {
    fetched.push(url);
    const page = pages[url];
    if (!page) return { ok: true, url, status: 404, contentType: "text/html", bytes: new TextEncoder().encode("Not found") };
    return { ok: true, url: page.url ?? url, status: page.status ?? 200, contentType: page.type ?? "text/html", bytes: new TextEncoder().encode(page.body) };
  }) as unknown as Deps["fetchPage"];
  return { fetchPage, fetched };
}

const html = (title: string, body: string, links = "") => `<html><head><title>${title}</title></head><body><nav><a href="/">Home</a>${links}</nav><main><h1>${title}</h1>${body}</main><footer>© Bakery</footer></body></html>`;

async function foundSite(name: string, host: string) {
  const made = await widgets.createWidget(owner, { name });
  if (!made.ok) throw new Error(made.problem);
  const added = await widgets.addSite(owner, made.widget.id, host, { fetchPage: web({}).fetchPage, txt: async () => [] });
  if (!added.ok) throw new Error(added.problem);
  await db().execute(sql`update commerce.support_widget_sites set verified_at = now(), verified_by = 'page' where id = ${added.site.id}::uuid`);
  return { widget: made.widget, siteId: added.site.id };
}

const pagesOf = (siteId: string) =>
  db().execute<Row>(sql`select path, title, problem, content_hash is not null as read from commerce.support_widget_site_pages where site_id = ${siteId}::uuid order by path`);

beforeAll(async () => {
  const slug = `crawl-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'T', 'T') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Bakeriet', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${storeId}::uuid`);
  const [o] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${slug}@example.com`}`);
  owner = {
    desk: systemDesk(storeId),
    store: { id: storeId, slug, name: "Bakeriet" },
    account: { id: String(o.id), email: String(o.email), name: "Kari" } as unknown as Staff["account"],
    canWrite: true,
    holder: { role: "owner" },
  };
  // Only this file's sites are due: earlier runs' sites in the same database are set as read.
  await db().execute(sql`update commerce.support_widget_sites set discovered_at = now() where discovered_at is null`);
  await db().execute(sql`update commerce.support_widget_site_pages set fetched_at = now() where fetched_at is null`);
});

afterAll(async () => {
  await closeDb();
});

describe("reading chat widgets' websites (D583)", () => {
  it("lists a site from its sitemap, minus what robots.txt keeps from us, and reads its pages into the knowledge base", async () => {
    const { widget, siteId } = await foundSite(`Bakery ${run}`, `bakery-${run}.com`);
    const host = `bakery-${run}.com`;
    const site = web({
      [`https://${host}/`]: { body: html("Bakeriet", "<p>Fresh sourdough every morning.</p>") },
      [`https://${host}/robots.txt`]: { type: "text/plain", body: `User-agent: *\nDisallow: /private\nSitemap: https://${host}/sitemap-pages.xml` },
      [`https://${host}/sitemap-pages.xml`]: {
        type: "application/xml",
        body: `<urlset><url><loc>https://${host}/opening-hours</loc></url><url><loc>https://www.${host}/delivery/</loc></url><url><loc>https://${host}/private/staff</loc></url><url><loc>https://elsewhere.net/x</loc></url><url><loc>https://${host}/menu.pdf</loc></url></urlset>`,
      },
      [`https://${host}/opening-hours`]: { body: html("Opening hours", "<p>We are open Tuesday to Saturday, 7 to 15. Closed on Mondays.</p>") },
      [`https://${host}/delivery`]: { body: html("Delivery", "<p>We deliver cakes in Oslo on Fridays.</p>") },
    });
    expect(await crawl.discoverSite(siteId, { fetchPage: site.fetchPage })).toEqual({ pages: 3, problem: null });
    expect((await pagesOf(siteId)).map((p) => p.path)).toEqual(["/", "/delivery", "/opening-hours"]);
    expect(site.fetched).not.toContain(`https://${host}/private/staff`);

    const result = await crawl.crawlWidgetSites({ fetchPage: site.fetchPage });
    expect(result).toMatchObject({ read: 3, failed: 0 });
    expect((await pagesOf(siteId)).map((p) => [p.path, p.title, p.read])).toEqual([
      ["/", "Bakeriet", true],
      ["/delivery", "Delivery", true],
      ["/opening-hours", "Opening hours", true],
    ]);

    // The widget's chat finds the page, at its full address; the store's own chat does not.
    const [found] = await searchKnowledge(storeId, "Mondays", "nb-NO", 5, { widget: widget.id });
    expect(found).toMatchObject({ title: "Opening hours", url: `https://${host}/opening-hours` });
    expect(found.body).toContain("Closed on Mondays");
    expect(found.body).not.toContain("© Bakery");
    expect(await searchKnowledge(storeId, "Mondays", "nb-NO")).toEqual([]);
    const listed = (await widgets.getWidget(owner.desk, widget.id))!.sites[0];
    expect(listed).toMatchObject({ pagesRead: 3, crawlProblem: null });
  });

  it("cuts a page again only when its words change, drops a page no longer listed, and never reads past the site's own host", async () => {
    const host = `bakery-${run}.com`;
    const [{ id: siteId }] = await db().execute<Row>(sql`select id from commerce.support_widget_sites where host = ${host}`);
    const passages = async (path: string) =>
      (await db().execute<Row>(sql`select c.id, c.body from commerce.knowledge_chunks c join commerce.support_widget_site_pages p on p.id = c.site_page_id where p.site_id = ${String(siteId)}::uuid and p.path = ${path}`));
    const before = await passages("/opening-hours");
    const page = (await db().execute<Row>(sql`select p.id, p.path, p.content_hash, s.host, ${storeId}::uuid as store_id from commerce.support_widget_site_pages p join commerce.support_widget_sites s on s.id = p.site_id where p.site_id = ${String(siteId)}::uuid and p.path = '/opening-hours'`))[0];
    const same = web({ [`https://${host}/opening-hours`]: { body: html("Opening hours", "<p>We are open Tuesday to Saturday, 7 to 15. Closed on Mondays.</p>") } });
    const pageRow = { id: String(page.id), path: String(page.path), content_hash: String(page.content_hash), host: String(page.host), store_id: storeId };
    expect(await crawl.readSitePage(pageRow, { fetchPage: same.fetchPage })).toBeNull();
    expect((await passages("/opening-hours")).map((p) => p.id)).toEqual(before.map((p) => p.id));

    const changed = web({ [`https://${host}/opening-hours`]: { body: html("Opening hours", "<p>From December we are also open on Mondays.</p>") } });
    expect(await crawl.readSitePage(pageRow, { fetchPage: changed.fetchPage })).toBeNull();
    expect((await passages("/opening-hours"))[0].body).toContain("also open on Mondays");

    const moved = web({ [`https://${host}/opening-hours`]: { body: html("Elsewhere", "<p>Another site.</p>"), url: "https://elsewhere.net/" } });
    expect(await crawl.readSitePage(pageRow, { fetchPage: moved.fetchPage })).toBe("moved");
    expect(await passages("/opening-hours")).toEqual([]);

    // Read again: the sitemap lists /delivery only now; the front page always.
    expect(await crawl.requestCrawl(owner, String(siteId))).toBe(true);
    expect(await crawl.requestCrawl({ ...owner, desk: systemDesk(null) }, String(siteId))).toBe(false);
    const fewer = web({
      [`https://${host}/`]: { body: html("Bakeriet", "<p>Fresh sourdough.</p>") },
      [`https://${host}/sitemap.xml`]: { type: "application/xml", body: `<urlset><url><loc>https://${host}/delivery</loc></url></urlset>` },
      [`https://${host}/delivery`]: { body: html("Delivery", "<p>We deliver cakes in Oslo on Fridays.</p>") },
    });
    await crawl.discoverSite(String(siteId), { fetchPage: fewer.fetchPage });
    expect((await pagesOf(String(siteId))).map((p) => [p.path, p.read])).toEqual([
      ["/", true],
      ["/delivery", true],
    ]);
    const due = await db().execute<Row>(sql`select count(*)::int as n from commerce.support_widget_site_pages where site_id = ${String(siteId)}::uuid and fetched_at is null`);
    expect(Number(due[0].n)).toBe(2);
  });

  it("follows a site's links when it has no sitemap, and says why it read nothing", async () => {
    const { siteId } = await foundSite(`Links ${run}`, `links-${run}.org`);
    const host = `links-${run}.org`;
    const site = web({
      [`https://${host}/`]: { body: html("Home", "<p>Welcome.</p>", `<a href="/about">About</a><a href="/shop/">Shop</a><a href="https://other.net/">Out</a>`) },
      [`https://${host}/about`]: { body: html("About", "<p>Since 1952.</p>", `<a href="/about/team">Team</a>`) },
      [`https://${host}/shop`]: { body: html("Shop", "<p>Buy.</p>") },
    });
    expect(await crawl.discoverSite(siteId, { fetchPage: site.fetchPage })).toEqual({ pages: 4, problem: null });
    expect((await pagesOf(siteId)).map((p) => p.path)).toEqual(["/", "/about", "/about/team", "/shop"]);

    const { siteId: closed } = await foundSite(`Closed ${run}`, `closed-${run}.org`);
    const robots = web({ [`https://closed-${run}.org/`]: { body: html("Home", "<p>Hi</p>") }, [`https://closed-${run}.org/robots.txt`]: { type: "text/plain", body: "User-agent: *\nDisallow: /" } });
    expect(await crawl.discoverSite(closed, { fetchPage: robots.fetchPage })).toEqual({ pages: 0, problem: "robots" });
    const ours = web({ [`https://closed-${run}.org/`]: { body: html("Home", "<p>Hi</p>") }, [`https://closed-${run}.org/robots.txt`]: { type: "text/plain", body: "User-agent: *\nDisallow: /\n\nUser-agent: KaizenaFlowBot\nAllow: /" } });
    expect((await crawl.discoverSite(closed, { fetchPage: ours.fetchPage })).problem).toBeNull();
  });

  it("keeps a widget to its own sites' pages: another widget of the store never finds them", async () => {
    const host = `bakery-${run}.com`;
    const [{ widget_id: bakery }] = await db().execute<Row>(sql`select widget_id from commerce.support_widget_sites where host = ${host}`);
    const [{ widget_id: links }] = await db().execute<Row>(sql`select widget_id from commerce.support_widget_sites where host = ${`links-${run}.org`}`);
    expect((await searchKnowledge(storeId, "cakes Fridays", "nb-NO", 5, { widget: String(bakery) })).map((p) => p.title)).toContain("Delivery");
    expect(await searchKnowledge(storeId, "cakes Fridays", "nb-NO", 5, { widget: String(links) })).toEqual([]);
    // Taking the site off its widget takes its pages and their passages with it.
    const [{ id: siteId }] = await db().execute<Row>(sql`select id from commerce.support_widget_sites where host = ${host}`);
    expect(await widgets.removeSite(owner, String(siteId))).toBe(true);
    expect(await searchKnowledge(storeId, "cakes Fridays", "nb-NO", 5, { widget: String(bakery) })).toEqual([]);
  });
});
