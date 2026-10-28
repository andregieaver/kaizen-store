import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, parsePageContent, type PageContent } from "@/lib/page-content";
import { templateSettings } from "@/lib/theme";

import type { Membership } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const staging = await import("./site-staging");
const { passMembership } = await import("./auth");
const pages = await import("./pages");
const installs = await import("./theme-installs");
const { listStoreMenus } = await import("./menus");

/**
 * A staging set (D358) against a real database: page drafts chosen, a theme waiting and a menu change kept, compared with what visitors see,
 * then made live together through the builder's Publish, the theme switch and the menu saver; only the store's own pages are taken, one set is
 * open at a time, and a member who may not write a kind of page is refused that page at publishing while the rest goes live.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let owner: Membership;
let other: Membership;

async function memberOf(email: string, slug: string): Promise<Membership> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Owner', ${slug}) returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${slug}, null)`);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where lower(email) = lower(${email})`);
  const member = await passMembership(slug, String(account.id));
  if (!member) throw new Error("no membership");
  return member;
}

const content = (slug: string, heading: string): PageContent => ({
  ...newPageContent(),
  title: `Page ${slug}`,
  slug,
  rows: [{ id: "row-1", type: "row", layout: "1", columns: [{ id: "column-1", blocks: [{ id: "heading-1", type: "heading", text: heading, level: 2 }] }] }],
});

async function save(member: Membership, id: string | null, body: PageContent, publish: boolean): Promise<string> {
  const result = await pages.savePage(member.account, member.store.id, id, body, { publish });
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.id;
}

const publishedOf = async (id: string) => {
  const [row] = await db().execute<Row>(sql`select published from commerce.pages where id = ${id}::uuid`);
  return parsePageContent(row.published);
};

beforeAll(async () => {
  owner = await memberOf(`staging-${run}@example.com`, `staging-${run}`);
  other = await memberOf(`staging-other-${run}@example.com`, `staging-other-${run}`);
});

afterAll(async () => {
  await closeDb();
});

describe("a staging set of a store's site (D358)", () => {
  it("holds one set at a time and only the store's own pages", async () => {
    expect(await staging.stagePage(owner, "00000000-0000-0000-0000-000000000000", true)).toEqual({ ok: false, problem: "none" });
    expect(await staging.startStaging(owner, "  ")).toEqual({ ok: false, problem: "name" });
    expect(await staging.startStaging(owner, "Autumn")).toEqual({ ok: true });
    expect(await staging.startStaging(owner, "Another")).toEqual({ ok: false, problem: "open" });
    const foreign = await save(other, null, content(`foreign-${run}`, "Not yours"), false);
    expect(await staging.stagePage(owner, foreign, true)).toEqual({ ok: false, problem: "page" });
    expect(await staging.discardStaging(owner)).toEqual({ ok: true });
    expect(await staging.openStagingOf(owner.store.id)).toBeNull();
    expect(await staging.lastStaging(owner.store.id)).toMatchObject({ name: "Autumn", status: "discarded" });
  });

  it("compares drafts with what visitors see and makes pages, a theme and a menu live together", async () => {
    const changed = await save(owner, null, content(`changed-${run}`, "Old words"), true);
    await save(owner, changed, content(`changed-${run}`, "New words"), false);
    const fresh = await save(owner, null, content(`fresh-${run}`, "Never shown"), false);
    const same = await save(owner, null, content(`same-${run}`, "Same"), true);

    const added = await installs.addOwnLook(owner.store.id, owner.account.id, "Calm", { base: "minimal", savedId: null, settings: { ...templateSettings("minimal"), corners: { cards: "none", fields: "large" } } });
    if (!added.ok) throw new Error(added.problems.join(" "));
    const [menu] = await listStoreMenus(owner.store.id);

    expect(await staging.startStaging(owner, "Launch")).toEqual({ ok: true });
    for (const id of [changed, fresh]) expect(await staging.stagePage(owner, id, true)).toEqual({ ok: true });
    expect(await staging.stageTheme(owner, added.id)).toEqual({ ok: true });
    const live = (await installs.listInstalls(owner.store.id)).find((i) => i.live)!;
    expect(await staging.stageTheme(owner, live.id)).toEqual({ ok: false, problem: "theme" });
    if (menu) expect(await staging.stageMenu(owner, menu.id, { name: `${menu.name} new`, items: [] })).toEqual({ ok: true });

    const view = await staging.stagingOverview(owner.store.id);
    const shown = new Map(view.pages.map((p) => [p.id, p]));
    expect(shown.get(changed)).toMatchObject({ staged: true, isNew: false });
    expect(shown.get(changed)!.differences).toContainEqual(expect.objectContaining({ kind: "text", before: "Old words", after: "New words" }));
    expect(shown.get(fresh)).toMatchObject({ staged: true, isNew: true });
    expect(shown.has(same)).toBe(false);
    expect(view.themes.find((t) => t.id === added.id)?.areas).toContain("corners");
    if (menu) expect(view.menus.find((m) => m.id === menu.id)?.staged).toMatchObject({ after: 0, renamed: true });

    // Nothing is live before the press.
    expect((await publishedOf(changed))?.rows[0].columns[0].blocks[0]).toMatchObject({ text: "Old words" });
    expect(await publishedOf(fresh)).toBeNull();

    const published = await staging.publishStaging(owner);
    if (!published.ok) throw new Error(published.problem);
    expect(published.outcome.pages.every((p) => p.ok)).toBe(true);
    expect(published.outcome.theme).toMatchObject({ title: "Calm", ok: true });
    expect((await publishedOf(changed))?.rows[0].columns[0].blocks[0]).toMatchObject({ text: "New words" });
    expect(await publishedOf(fresh)).not.toBeNull();
    expect((await installs.listInstalls(owner.store.id)).find((i) => i.live)?.id).toBe(added.id);
    if (menu) expect((await listStoreMenus(owner.store.id)).find((m) => m.id === menu.id)?.name).toBe(`${menu.name} new`);
    expect(await staging.openStagingOf(owner.store.id)).toBeNull();
    expect(await staging.lastStaging(owner.store.id)).toMatchObject({ name: "Launch", status: "published" });
    expect(await staging.publishStaging(owner)).toEqual({ ok: false, problem: "none" });
  });

  it("refuses at publishing a page the member may not write, and makes the rest live", async () => {
    const page = await save(owner, null, content(`kept-${run}`, "Kept"), false);
    const layout = await save(owner, null, content(`refused-${run}`, "Refused"), false);
    await db().execute(sql`update commerce.pages set type = 'product_layout' where id = ${layout}::uuid`);
    expect(await staging.startStaging(owner, "Partly")).toEqual({ ok: true });
    for (const id of [page, layout]) expect(await staging.stagePage(owner, id, true)).toEqual({ ok: true });
    const websiteOnly = { ...owner, role: "admin", permissions: ["website:read", "website:write"] } as Membership;
    const published = await staging.publishStaging(websiteOnly);
    if (!published.ok) throw new Error(published.problem);
    const byId = new Map(published.outcome.pages.map((p) => [p.id, p]));
    expect(byId.get(page)).toMatchObject({ ok: true });
    expect(byId.get(layout)).toMatchObject({ ok: false, problem: "access" });
    expect(await publishedOf(layout)).toBeNull();
  });
});
