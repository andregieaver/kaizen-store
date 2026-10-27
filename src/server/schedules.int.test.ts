import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, type PageContent, type PageType } from "@/lib/page-content";

import { makeStore, ownerOf, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { savePage, getPageForEdit } = await import("./pages");
const { runSchedules, scheduleOf, schedulePage, scheduleStates } = await import("./page-schedules");
const { scheduleTheme, themeScheduleOf, cancelThemeSchedule } = await import("./theme-schedules");
const { switchToInstall } = await import("./theme-installs");
const { preflightOwnerTool, runOwnerTool } = await import("./owner-tools");

type Row = Record<string, unknown>;

/**
 * Changes by the clock (wave 7 unit F, D340, `docs/wave-7-storefront.md` F): a page's, header's or footer's draft is published by the job at
 * its time and the version before put back at another, in the name of who scheduled it; a person's later publish is never undone by the
 * clock; a theme is made live and the theme before put back the same way, never one that costs money; a removed maker or another store's
 * theme fails or is refused; and the AI manager reads and proposes the same.
 */

let fx: Fixture;
let other: Fixture;
const run = Date.now().toString(36);
const HOUR = 3_600_000;

const content = (slug: string, title: string, o: Partial<PageContent> = {}): PageContent => ({ ...newPageContent(), title, slug: `${slug}-${run}`, ...o });

async function saved(fixture: Fixture, page: PageContent, publish: boolean, type: PageType = "page", id: string | null = null): Promise<string> {
  const { account } = await ownerOf(fixture);
  const result = await savePage(account, fixture.storeId, id, page, { publish, type });
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.id;
}

const published = async (fixture: Fixture, id: string, type: PageType = "page") => {
  const [row] = await db().execute<Row>(sql`select published ->> 'title' as title, draft ->> 'title' as draft from commerce.pages where id = ${id}::uuid`);
  return { live: (row?.title as string | null) ?? null, draft: (row?.draft as string | null) ?? null, state: (await getPageForEdit(fixture.storeId, id, type))?.state };
};

const actions = async (storeId: string, action: string) =>
  Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action = ${action}`))[0].n);

beforeAll(async () => {
  fx = await makeStore("sched");
  other = await makeStore("sched-other");
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("a page published at a time and put back at another", () => {
  it("publishes the draft, then puts the version before back and keeps the person's draft", async () => {
    const { account } = await ownerOf(fx);
    const id = await saved(fx, content("sale", "Before"), true);
    await saved(fx, content("sale", "Black Friday"), false, "page", id);
    const at = new Date(Date.now() + HOUR);
    const back = new Date(at.getTime() + 24 * HOUR);
    expect(await schedulePage(account, fx.storeId, id, "page", at, [], back)).toMatchObject({ ok: true });
    expect((await scheduleOf(fx.storeId, id)).waiting).toMatchObject({ at: at.toISOString(), revertAt: back.toISOString() });

    // Not before its time.
    await runSchedules(new Date(at.getTime() - 60_000));
    expect((await published(fx, id)).live).toBe("Before");

    const ran = await runSchedules(new Date(at.getTime() + 60_000));
    expect(ran.stores).toContain(fx.storeId);
    expect(await published(fx, id)).toMatchObject({ live: "Black Friday", state: "published" });
    expect((await scheduleOf(fx.storeId, id)).reverting?.at).toBe(back.toISOString());
    expect((await scheduleStates(fx.storeId, "page")).get(id)?.reverting).not.toBeNull();

    // The way back waits for its own time.
    await runSchedules(new Date(back.getTime() - 60_000));
    expect((await published(fx, id)).live).toBe("Black Friday");
    const reverted = await runSchedules(new Date(back.getTime() + 60_000));
    expect(reverted.reverted).toBeGreaterThanOrEqual(1);
    // The version before is live again; the scheduled words stay the draft, so nothing the person wrote is lost.
    expect(await published(fx, id)).toEqual({ live: "Before", draft: "Black Friday", state: "changed" });
    expect((await scheduleOf(fx.storeId, id)).reverting).toBeNull();
    expect(await actions(fx.storeId, "store.page_reverted")).toBeGreaterThanOrEqual(1);
    const [who] = await db().execute<Row>(sql`select updated_by from commerce.pages where id = ${id}::uuid`);
    expect(String(who.updated_by)).toBe(account.id);
  });

  it("takes a page that was not published off the site again", async () => {
    const { account } = await ownerOf(fx);
    const id = await saved(fx, content("pop-up", "Pop-up"), false);
    const at = new Date(Date.now() + 2 * HOUR);
    await schedulePage(account, fx.storeId, id, "page", at, [], new Date(at.getTime() + HOUR));
    await runSchedules(new Date(at.getTime() + 60_000));
    expect((await published(fx, id)).live).toBe("Pop-up");
    await runSchedules(new Date(at.getTime() + HOUR + 60_000));
    expect(await published(fx, id)).toMatchObject({ live: null, state: "draft" });
  });

  it("never undoes a person's later publish: the way back fails and says why", async () => {
    const { account } = await ownerOf(fx);
    const id = await saved(fx, content("news", "Old"), true);
    await saved(fx, content("news", "Scheduled"), false, "page", id);
    const at = new Date(Date.now() + 3 * HOUR);
    await schedulePage(account, fx.storeId, id, "page", at, [], new Date(at.getTime() + HOUR));
    await runSchedules(new Date(at.getTime() + 60_000));
    // Someone publishes again in between.
    await saved(fx, content("news", "By hand"), true, "page", id);
    await runSchedules(new Date(at.getTime() + HOUR + 60_000));
    expect((await published(fx, id)).live).toBe("By hand");
    const state = await scheduleOf(fx.storeId, id);
    expect(state.lastFailure).toMatchObject({ leg: "revert", problem: expect.stringMatching(/published or taken off the site by someone/) });
    expect(await actions(fx.storeId, "store.page_revert_failed")).toBeGreaterThanOrEqual(1);
  });

  it("is never published for a moment once its time to go back has passed", async () => {
    const { account } = await ownerOf(other);
    const id = await saved(other, content("late", "Late"), false);
    const at = new Date(Date.now() + HOUR);
    await schedulePage(account, other.storeId, id, "page", at, [], new Date(at.getTime() + HOUR));
    // The store was not open through both times; the publish runs only after.
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${other.storeId}::uuid`);
    try {
      await runSchedules(new Date(at.getTime() + 2 * HOUR));
      expect((await scheduleOf(other.storeId, id)).waiting).not.toBeNull();
    } finally {
      await db().execute(sql`update commerce.stores set status = 'active' where id = ${other.storeId}::uuid`);
    }
    await runSchedules(new Date(at.getTime() + 2 * HOUR));
    expect((await published(other, id)).live).toBeNull();
    expect((await scheduleOf(other.storeId, id)).lastFailure).toMatchObject({ leg: "publish", problem: expect.stringMatching(/had passed/) });
  });

  it("schedules a header the same way, and refuses another store's page", async () => {
    const { account } = await ownerOf(fx);
    const id = await saved(fx, content("top", "Top v1"), true, "header");
    await saved(fx, content("top", "Top v2"), false, "header", id);
    const at = new Date(Date.now() + 4 * HOUR);
    expect(await schedulePage(account, fx.storeId, id, "header", at, [], new Date(at.getTime() + HOUR))).toMatchObject({ ok: true });
    await runSchedules(new Date(at.getTime() + 60_000));
    expect((await published(fx, id, "header")).live).toBe("Top v2");
    await runSchedules(new Date(at.getTime() + HOUR + 60_000));
    expect((await published(fx, id, "header")).live).toBe("Top v1");
    expect(await schedulePage(account, other.storeId, id, "header", at)).toEqual({ ok: false, problem: "missing" });
  });
});

describe("a theme made live at a time and put back at another", () => {
  const install = async (fixture: Fixture, title: string, preset: string | null = null) =>
    String(
      (
        await db().execute<Row>(sql`
          insert into commerce.store_theme_installs (store_id, title, look, preset_id) values (${fixture.storeId}::uuid, ${title}, '{}'::jsonb, ${preset}::uuid) returning id
        `)
      )[0].id,
    );
  const live = async (fixture: Fixture) => String((await db().execute<Row>(sql`select id from commerce.store_theme_installs where store_id = ${fixture.storeId}::uuid and live`))[0].id);

  it("switches by itself and back, in the name of who planned it", async () => {
    const { account } = await ownerOf(fx);
    const before = await live(fx);
    const calm = await install(fx, "Calm");
    const at = new Date(Date.now() + HOUR);
    expect(await scheduleTheme(account, fx.storeId, calm, at, new Date(at.getTime() + 2 * HOUR))).toMatchObject({ ok: true });
    expect((await themeScheduleOf(fx.storeId)).waiting).toMatchObject({ installId: calm });
    await runSchedules(new Date(at.getTime() - 60_000));
    expect(await live(fx)).toBe(before);
    const ran = await runSchedules(new Date(at.getTime() + 60_000));
    expect(ran.themeStores.map((s) => s.id)).toContain(fx.storeId);
    expect(await live(fx)).toBe(calm);
    await runSchedules(new Date(at.getTime() + 2 * HOUR + 60_000));
    expect(await live(fx)).toBe(before);
    expect(await actions(fx.storeId, "store.theme_reverted")).toBeGreaterThanOrEqual(1);
  });

  it("leaves a theme someone switched to since, and says why", async () => {
    const { account } = await ownerOf(fx);
    const bold = await install(fx, "Bold");
    const third = await install(fx, "Third");
    const at = new Date(Date.now() + 5 * HOUR);
    await scheduleTheme(account, fx.storeId, bold, at, new Date(at.getTime() + HOUR));
    await runSchedules(new Date(at.getTime() + 60_000));
    expect(await live(fx)).toBe(bold);
    expect((await switchToInstall(fx.storeId, third, account.id)).ok).toBe(true);
    await runSchedules(new Date(at.getTime() + HOUR + 60_000));
    expect(await live(fx)).toBe(third);
    expect((await themeScheduleOf(fx.storeId)).lastFailure).toMatchObject({ leg: "revert", problem: expect.stringMatching(/switched the store to another theme/) });
  });

  it("never plans a theme that costs money, another store's, or the live one", async () => {
    const { account } = await ownerOf(fx);
    const [preset] = await db().execute<Row>(sql`insert into commerce.design_presets (title, snapshot) values (${`Premium ${run}`}, '{}'::jsonb) returning id`);
    await db().execute(sql`insert into commerce.theme_prices (preset_id, currency, amount_minor) values (${String(preset.id)}::uuid, 'NOK', 49000)`);
    const premium = await install(fx, "Premium", String(preset.id));
    const at = new Date(Date.now() + HOUR);
    expect(await scheduleTheme(account, fx.storeId, premium, at)).toEqual({ ok: false, problem: "costs" });
    expect(await scheduleTheme(account, fx.storeId, await live(other), at)).toEqual({ ok: false, problem: "missing" });
    expect(await scheduleTheme(account, fx.storeId, await live(fx), at)).toEqual({ ok: false, problem: "live" });
  });

  it("fails a plan whose maker may no longer change the look, and is cancelled on asking", async () => {
    const { account } = await ownerOf(other);
    const [staff] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`theme-staff-${run}@example.com`}, 'Staff') returning id`);
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${other.storeId}::uuid, ${String(staff.id)}::uuid, 'admin')`);
    const gone = await install(other, "Gone");
    const at = new Date(Date.now() + HOUR);
    await scheduleTheme({ ...account, id: String(staff.id) }, other.storeId, gone, at);
    await db().execute(sql`delete from commerce.store_members where store_id = ${other.storeId}::uuid and account_id = ${String(staff.id)}::uuid`);
    const before = await live(other);
    await runSchedules(new Date(at.getTime() + 60_000));
    expect(await live(other)).toBe(before);
    expect((await themeScheduleOf(other.storeId)).lastFailure).toMatchObject({ leg: "publish", problem: expect.stringMatching(/may no longer change/) });
    expect(await actions(other.storeId, "store.theme_schedule_failed")).toBeGreaterThanOrEqual(1);

    await scheduleTheme(account, other.storeId, gone, new Date(Date.now() + 2 * HOUR));
    expect(await cancelThemeSchedule(account, other.storeId)).toBe(true);
    expect((await themeScheduleOf(other.storeId)).waiting).toBeNull();
  });
});

describe("the AI manager's schedules", () => {
  it("lists what is scheduled and refuses before a yes what the editor refuses", async () => {
    const c = { ...(await ownerOf(fx)), invalidate: () => {} };
    const id = await saved(fx, content("ai-later", "AI later"), false);
    await expect(preflightOwnerTool(c, "schedule_site_change", { kind: "page", target: id, at: "2020-01-01 09:00" })).rejects.toThrow(/minutes from now/);
    const when = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await expect(preflightOwnerTool(c, "schedule_site_change", { kind: "page", target: id, at: `${when} 09:00`, back_at: `${when} 09:05` })).rejects.toThrow(/10 minutes/);
    await expect(preflightOwnerTool(c, "schedule_site_change", { kind: "page", target: id, at: `${when} 09:00`, back_at: `${when} 18:00` })).resolves.toBeUndefined();
    const done = (await runOwnerTool(c, "schedule_site_change", { kind: "page", target: id, at: `${when} 09:00`, back_at: `${when} 18:00` })) as { publishes_at: string; goes_back_at: string };
    expect(done.publishes_at).toBe(`${when} 09:00`);
    expect(done.goes_back_at).toBe(`${when} 18:00`);
    const listed = (await runOwnerTool(c, "list_scheduled_changes", {})) as { pages: { id: string; publishes_at: string | null }[] };
    expect(listed.pages.find((p) => p.id === id)?.publishes_at).toBe(`${when} 09:00`);
    await expect(preflightOwnerTool(c, "schedule_site_change", { kind: "theme", target: "No such theme", at: `${when} 09:00` })).rejects.toThrow(/No installed theme/);
    expect((await runOwnerTool(c, "schedule_site_change", { kind: "page", target: id, at: null })) as { done: string }).toMatchObject({ done: expect.stringMatching(/cancelled/) });
  });
});
