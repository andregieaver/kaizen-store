import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));

const widgets = await import("./support-widgets");
const { systemDesk } = await import("./support-desk");
const { chatPlace } = await import("./chat-route");
type Staff = import("./support-desk").StaffDesk;
type CheckDeps = import("./support-widgets").CheckDeps;

/**
 * Chat widgets on the owner's own websites (D581): a desk has several widgets, each with its own look and any number of websites; a site
 * is looked for its widget's tag on its front page (or its TXT record), and only a found site's frame and routes give the desk, for its host
 * or its `www.` twin, with that widget's look.
 */

const run = Date.now().toString(36);
let storeId: string;
let owner: Staff;

/** A front page as the stand-in fetcher returns it: `html` at `url` (after its redirects). */
const page = (html: string, url: string): CheckDeps["fetchPage"] =>
  (async () => ({ ok: true, url, status: 200, contentType: "text/html", bytes: new TextEncoder().encode(html) })) as unknown as CheckDeps["fetchPage"];
const noDns = async () => [] as string[][];
const tag = (key: string) => `<script src="https://kaizenaflow.com/embed/chat.js" data-key="${key}" async></script>`;

beforeAll(async () => {
  const slug = `widgets-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'T', 'T') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Fjell', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${storeId}::uuid`);
  const [o] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${slug}@example.com`}`);
  owner = {
    desk: systemDesk(storeId),
    store: { id: storeId, slug, name: "Fjell" },
    account: { id: String(o.id), email: String(o.email), name: "Kari" } as unknown as Staff["account"],
    canWrite: true,
    holder: { role: "owner" },
  };
});

afterAll(async () => {
  await closeDb();
});

describe("chat widgets on the owner's own websites (D581)", () => {
  it("makes several widgets, each named once, with its first website checked at once", async () => {
    const shop = await widgets.createWidget(owner, { name: "Company site", host: "https://www.Fjell-Shop.com/kontakt" }, { fetchPage: page("<html></html>", "https://www.fjell-shop.com/"), txt: noDns });
    if (!shop.ok) throw new Error(shop.problem);
    expect(shop.widget).toMatchObject({ name: "Company site", sites: [{ host: "www.fjell-shop.com", verifiedAt: null, checkProblem: "not_found" }] });
    expect(shop.widget.key).toMatch(/^[a-z0-9]{20}$/);
    const blog = await widgets.createWidget(owner, { name: "Blog" });
    if (!blog.ok) throw new Error(blog.problem);
    expect(blog.widget.sites).toEqual([]);
    expect(blog.widget.key).not.toBe(shop.widget.key);
    expect(await widgets.createWidget(owner, { name: "company SITE" })).toEqual({ ok: false, problem: "nameTaken" });
    expect(await widgets.createWidget(owner, { name: "   " })).toEqual({ ok: false, problem: "name" });
    expect(await widgets.createWidget(owner, { name: "Third", host: "localhost" })).toEqual({ ok: false, problem: "host" });
    expect(await widgets.createWidget({ ...owner, canWrite: false }, { name: "Third" })).toEqual({ ok: false, problem: "noAccess" });
    expect((await widgets.listWidgets(owner.desk)).map((widget) => widget.name)).toEqual(["Company site", "Blog"]);
  });

  it("puts one widget on several websites, a site on only one of the desk's widgets, each found on its own", async () => {
    const [shop, blog] = await widgets.listWidgets(owner.desk);
    const deps = (html: string, url: string) => ({ fetchPage: page(html, url), txt: noDns });
    const second = await widgets.addSite(owner, shop.id, "fjell-outlet.no", deps(tag(shop.key), "https://fjell-outlet.no/"));
    expect(second).toMatchObject({ ok: true, site: { host: "fjell-outlet.no", verifiedBy: "page" } });
    // The www twin of a site already on a widget is the same site, whichever widget it is asked for.
    expect(await widgets.addSite(owner, blog.id, "fjell-shop.com", deps("", "https://fjell-shop.com/"))).toEqual({ ok: false, problem: "taken" });
    expect(await widgets.addSite(owner, shop.id, "www.fjell-outlet.no", deps("", "https://fjell-outlet.no/"))).toEqual({ ok: false, problem: "taken" });
    expect(await widgets.addSite({ ...owner, desk: systemDesk(null) }, shop.id, "other.example.com", deps("", "https://other.example.com/"))).toEqual({ ok: false, problem: "gone" });

    // The tag on the page a redirect sent the check to is no proof: that page is another site's. The TXT record is.
    const sent = await widgets.addSite(owner, blog.id, "blog.fjell-shop.com", deps(tag(blog.key), "https://elsewhere.example.net/"));
    expect(sent).toMatchObject({ ok: true, site: { verifiedAt: null, checkProblem: "moved" } });
    if (!sent.ok) return;
    const dns = async () => [["v=spf1 -all"], [`kaizena-flow-chat=${blog.key}`]];
    expect(await widgets.checkSite(owner.desk, sent.site.id, { fetchPage: page("", "https://blog.fjell-shop.com/"), txt: dns })).toMatchObject({ verifiedBy: "dns" });

    // Another widget's key on the page is not this widget's tag.
    const shopSite = (await widgets.getWidget(owner.desk, shop.id))!.sites.find((site) => site.host === "www.fjell-shop.com")!;
    expect(await widgets.checkSite(owner.desk, shopSite.id, deps(tag(blog.key), "https://www.fjell-shop.com/"))).toMatchObject({ verifiedAt: null, checkProblem: "not_found" });
    expect(await widgets.checkSite(owner.desk, shopSite.id, deps(tag(shop.key), "https://www.fjell-shop.com/"))).toMatchObject({ verifiedBy: "page", checkProblem: null });
    // Found stays found: a later check that cannot open the page does not switch the chat off.
    const offline = (async () => ({ ok: false, problem: "timeout" })) as unknown as CheckDeps["fetchPage"];
    expect(await widgets.checkSite(owner.desk, shopSite.id, { fetchPage: offline, txt: noDns })).toMatchObject({ verifiedBy: "page", checkProblem: "unreachable" });
  });

  it("gives the frame and the chat's routes the widget, its look and the desk, only on its own found websites", async () => {
    const [shop, blog] = await widgets.listWidgets(owner.desk);
    const frame = await widgets.frameWidget(shop.key, "fjell-shop.com");
    expect(frame).toMatchObject({ id: shop.id, storeId, host: "www.fjell-shop.com", verified: true });
    expect((await widgets.frameWidget(shop.key, "fjell-outlet.no"))?.host).toBe("fjell-outlet.no");
    // A widget's key on another widget's site, or on a site of nobody's, gives nothing.
    expect(await widgets.frameWidget(shop.key, "blog.fjell-shop.com")).toBeNull();
    expect(await widgets.frameWidget(blog.key, "www.fjell-shop.com")).toBeNull();
    expect(await widgets.frameWidget(shop.key, "copycat.example.net")).toBeNull();

    const place = await chatPlace({ embed: shop.key, host: "fjell-outlet.no" });
    if (place instanceof Response) throw new Error(`refused ${place.status}`);
    expect(place.storeId).toBe(storeId);
    expect(place.site.embed).toEqual({ id: shop.id, host: "fjell-outlet.no", privacyUrl: null });
    expect(await chatPlace({ embed: shop.key, host: "copycat.example.net" })).toBeInstanceOf(Response);
  });

  it("saves a widget's look, checked, and its name, language and privacy page", async () => {
    const [shop] = await widgets.listWidgets(owner.desk);
    const style = { accent: "#FFCC00", background: "#101820", text: "", corners: "round", side: "left", offsetX: "24", offsetY: "40", launcher: "label", label: "Spør oss", width: "wide", font: null, greeting: "Hei! Hva lurer du på?", css: "[data-chat-launcher] { letter-spacing: .02em; }" };
    const saved = await widgets.saveWidget(owner, shop.id, { name: "Fjell Shop", privacy: "https://www.fjell-shop.com/personvern", market: null, style }, ["no"]);
    expect(saved).toMatchObject({
      ok: true,
      widget: { name: "Fjell Shop", privacyUrl: "https://www.fjell-shop.com/personvern", style: { accent: "#ffcc00", background: "#101820", text: null, corners: "round", side: "left", offsetX: 24, offsetY: 40, launcher: "label", label: "Spør oss", width: "wide", greeting: "Hei! Hva lurer du på?" } },
    });
    expect((await widgets.frameWidget(shop.key, "fjell-outlet.no"))?.style).toMatchObject({ accent: "#ffcc00", side: "left" });
    expect(await widgets.saveWidget(owner, shop.id, { name: "Fjell Shop", style: { accent: "yellow" } }, ["no"])).toEqual({ ok: false, problem: "colour" });
    expect(await widgets.saveWidget(owner, shop.id, { name: "Fjell Shop", style: { css: "a { color: red" } }, ["no"])).toEqual({ ok: false, problem: "css" });
    expect(await widgets.saveWidget(owner, shop.id, { name: "Fjell Shop", privacy: "http://x.com", style: {} }, ["no"])).toEqual({ ok: false, problem: "privacy" });
    expect(await widgets.saveWidget(owner, shop.id, { name: "Fjell Shop", market: "se", style: {} }, ["no"])).toEqual({ ok: false, problem: "market" });
    expect(await widgets.saveWidget(owner, shop.id, { name: "Blog", style: {} }, ["no"])).toEqual({ ok: false, problem: "nameTaken" });
    expect(await widgets.saveWidget(owner, shop.id, { name: "Fjell Shop", style: { font: "Not A Real Font" } }, ["no"], { installFont: async () => ({ ok: true }) })).toEqual({ ok: false, problem: "font" });
    const font = await widgets.saveWidget(owner, shop.id, { name: "Fjell Shop", style: { font: "Inter" } }, ["no"], { installFont: async () => ({ ok: true }) });
    expect(font).toMatchObject({ ok: true, widget: { style: { font: "Inter" } } });
  });

  it("checks a site not yet found again from its frame at most every ten minutes", async () => {
    const [, blog] = await widgets.listWidgets(owner.desk);
    const added = await widgets.addSite(owner, blog.id, "news.fjell-shop.com", { fetchPage: page("", "https://news.fjell-shop.com/"), txt: noDns });
    if (!added.ok) throw new Error(added.problem);
    const fetchPage = vi.fn(page(tag(blog.key), "https://news.fjell-shop.com/"));
    const frame = (await widgets.frameWidget(blog.key, "news.fjell-shop.com"))!;
    expect(await widgets.recheckFromFrame(frame, { fetchPage, txt: noDns })).toBe(false);
    expect(fetchPage).not.toHaveBeenCalled();
    await db().execute(sql`update commerce.support_widget_sites set checked_at = now() - interval '11 minutes' where id = ${added.site.id}::uuid`);
    const stale = (await widgets.frameWidget(blog.key, "news.fjell-shop.com"))!;
    expect(await widgets.recheckFromFrame(stale, { fetchPage, txt: noDns })).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("takes a site off, and deletes a widget with all its sites, each only on its own desk, with an audit entry", async () => {
    const [shop, blog] = await widgets.listWidgets(owner.desk);
    const outlet = shop.sites.find((site) => site.host === "fjell-outlet.no")!;
    expect(await widgets.removeSite({ ...owner, desk: systemDesk(null) }, outlet.id)).toBe(false);
    expect(await widgets.removeSite(owner, outlet.id)).toBe(true);
    expect(await widgets.frameWidget(shop.key, "fjell-outlet.no")).toBeNull();
    expect(await widgets.deleteWidget({ ...owner, desk: systemDesk(null) }, blog.id)).toBe(false);
    expect(await widgets.deleteWidget(owner, blog.id)).toBe(true);
    expect(await widgets.frameWidget(blog.key, "blog.fjell-shop.com")).toBeNull();
    const [audit] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action like 'support.widget%'`);
    expect(Number(audit.n)).toBeGreaterThanOrEqual(8);
  });
});
