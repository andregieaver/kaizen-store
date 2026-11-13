import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));

const embeds = await import("./support-embeds");
const { systemDesk } = await import("./support-desk");
const { chatPlace } = await import("./chat-route");
type Staff = import("./support-desk").StaffDesk;
type CheckDeps = import("./support-embeds").CheckDeps;

/**
 * The chat on an owner's own website (D581, step 1): a site is added from what the owner typed, its tag is looked for on its front page (or
 * its TXT record), and only a found site's frame and routes give the desk, for its host or its `www.` twin.
 */

const run = Date.now().toString(36);
let storeId: string;
let slug: string;
let owner: Staff;

/** A front page as the stand-in fetcher returns it: `html` at `url` (after its redirects). */
const page = (html: string, url = "https://www.example-shop.test/"): CheckDeps["fetchPage"] =>
  (async () => ({ ok: true, url, status: 200, contentType: "text/html", bytes: new TextEncoder().encode(html) })) as unknown as CheckDeps["fetchPage"];
const noDns = async () => [] as string[][];

beforeAll(async () => {
  slug = `embeds-${run}`;
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

describe("the chat on an owner's own website (D581)", () => {
  it("adds a site from what was typed, waits for its tag, and goes live once the tag is on its front page", async () => {
    const added = await embeds.addEmbed(owner, { host: "https://Example-Shop.com/contact", privacy: "/privacy" }, ["no"], { fetchPage: page("<html></html>", "https://example-shop.com/"), txt: noDns });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.embed).toMatchObject({ host: "example-shop.com", privacyUrl: "https://example-shop.com/privacy", verifiedAt: null, checkProblem: "not_found" });
    expect(added.embed.key).toMatch(/^[a-z0-9]{20}$/);

    // Not found: the frame and the chat's routes give nothing.
    expect((await embeds.embedForFrame(added.embed.key, "example-shop.com"))?.verified).toBe(false);
    const refused = await chatPlace({ embed: added.embed.key, host: "example-shop.com" });
    expect(refused).toBeInstanceOf(Response);
    expect((refused as Response).status).toBe(404);

    const tag = `<script src="https://kaizenaflow.com/embed/chat.js" data-key="${added.embed.key}" async></script>`;
    const checked = await embeds.checkEmbed(owner.desk, added.embed.id, { fetchPage: page(`<body>${tag}</body>`, "https://www.example-shop.com/"), txt: noDns });
    expect(checked).toMatchObject({ verifiedBy: "page", checkProblem: null });

    // The www twin may show it too; another host, or another site's key, may not.
    expect((await embeds.embedForFrame(added.embed.key, "www.example-shop.com"))?.verified).toBe(true);
    expect(await embeds.embedForFrame(added.embed.key, "evil.example.net")).toBeNull();
    expect(await embeds.embedForFrame("z".repeat(20), "example-shop.com")).toBeNull();

    const place = await chatPlace({ embed: added.embed.key, host: "www.example-shop.com" });
    expect(place).not.toBeInstanceOf(Response);
    if (place instanceof Response) return;
    expect(place.storeId).toBe(storeId);
    expect(place.site.kind).toBe("store");
    expect(place.site.embed).toEqual({ id: added.embed.id, host: "example-shop.com", privacyUrl: "https://example-shop.com/privacy" });

    // A site found stays found: a later check that cannot open the page does not switch the chat off.
    const offline = (async () => ({ ok: false, problem: "timeout" })) as unknown as CheckDeps["fetchPage"];
    expect(await embeds.checkEmbed(owner.desk, added.embed.id, { fetchPage: offline, txt: noDns })).toMatchObject({ verifiedBy: "page", checkProblem: "unreachable" });
  });

  it("finds a tag manager's site by its TXT record, and never follows its front page to another site", async () => {
    const added = await embeds.addEmbed(owner, { host: "blog.example-shop.com" }, null, { fetchPage: page("<html></html>", "https://elsewhere.example.net/"), txt: noDns });
    if (!added.ok) throw new Error(added.problem);
    expect(added.embed.checkProblem).toBe("moved");
    const tag = `<script src="https://kaizenaflow.com/embed/chat.js" data-key="${added.embed.key}"></script>`;
    // The tag on the page it was sent to is no proof: that page is another site's.
    expect(await embeds.checkEmbed(owner.desk, added.embed.id, { fetchPage: page(tag, "https://elsewhere.example.net/"), txt: noDns })).toMatchObject({ verifiedAt: null, checkProblem: "moved" });
    const dns = async () => [["v=spf1 -all"], [`kaizena-flow-chat=${added.embed.key}`]];
    expect(await embeds.checkEmbed(owner.desk, added.embed.id, { fetchPage: page("<html></html>", "https://blog.example-shop.com/"), txt: dns })).toMatchObject({ verifiedBy: "dns" });
  });

  it("refuses a host it cannot read, the same site twice, a privacy page elsewhere, another store's market and a reader", async () => {
    const deps = { fetchPage: page(""), txt: noDns };
    expect(await embeds.addEmbed(owner, { host: "localhost" }, null, deps)).toEqual({ ok: false, problem: "host" });
    expect(await embeds.addEmbed(owner, { host: "www.example-shop.com" }, null, deps)).toEqual({ ok: false, problem: "taken" });
    expect(await embeds.addEmbed(owner, { host: "third.example-shop.com", privacy: "https://other.example.net/p" }, null, deps)).toEqual({ ok: false, problem: "privacy" });
    expect(await embeds.addEmbed(owner, { host: "third.example-shop.com", market: "xx" }, ["no"], deps)).toEqual({ ok: false, problem: "market" });
    expect(await embeds.addEmbed({ ...owner, canWrite: false }, { host: "third.example-shop.com" }, null, deps)).toEqual({ ok: false, problem: "noAccess" });
  });

  it("lists only the desk's own sites, and a removed site's tag shows nothing", async () => {
    const listed = await embeds.listEmbeds(owner.desk);
    expect(listed.map((embed) => embed.host)).toEqual(["example-shop.com", "blog.example-shop.com"]);
    expect(await embeds.listEmbeds(systemDesk(null))).not.toContainEqual(expect.objectContaining({ host: "example-shop.com" }));
    const [first] = listed;
    expect(await embeds.removeEmbed({ ...owner, desk: systemDesk(null) }, first.id)).toBe(false);
    expect(await embeds.removeEmbed(owner, first.id)).toBe(true);
    expect(await embeds.embedForFrame(first.key, "example-shop.com")).toBeNull();
    const [audit] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action in ('support.embed_added', 'support.embed_removed')`);
    expect(Number(audit.n)).toBe(3);
  });

  it("checks a site not yet found again from its frame at most every ten minutes", async () => {
    const added = await embeds.addEmbed(owner, { host: "fourth.example-shop.com" }, null, { fetchPage: page(""), txt: noDns });
    if (!added.ok) throw new Error(added.problem);
    const frame = (await embeds.embedForFrame(added.embed.key, "fourth.example-shop.com"))!;
    const tag = `<script src="https://kaizenaflow.com/embed/chat.js" data-key="${added.embed.key}"></script>`;
    const fetchPage = vi.fn(page(tag, "https://fourth.example-shop.com/"));
    // Checked a moment ago when it was added: not again yet.
    expect(await embeds.recheckFromFrame(frame, { fetchPage, txt: noDns })).toBe(false);
    expect(fetchPage).not.toHaveBeenCalled();
    await db().execute(sql`update commerce.support_embeds set checked_at = now() - interval '11 minutes' where id = ${added.embed.id}::uuid`);
    const stale = (await embeds.embedForFrame(added.embed.key, "fourth.example-shop.com"))!;
    expect(await embeds.recheckFromFrame(stale, { fetchPage, txt: noDns })).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
