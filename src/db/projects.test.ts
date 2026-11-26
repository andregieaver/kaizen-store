import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * Projects and checklists (D903, docs/projects.md 4.3): the rules the database holds, run against real Postgres (PGlite) with every
 * migration applied. Every row is its store's; a list's statuses are its own when it has any, else the store's defaults; a new item gets the
 * default status; the tick and the status agree whichever is changed; an item moved to another list keeps its status by name; a status and a
 * stage belong where they are used; the home project is always a member; the feature needs nothing.
 */

let db: PGlite;
let shop: string;
let other: string;
let account: string;
let counter = 0;

type Row = Record<string, unknown>;

async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
const id = async (sql: string, params: unknown[]) => (await one<{ id: string }>(sql, params)).id;

async function store(slug: string): Promise<string> {
  return id("insert into commerce.stores (slug, name, country) values ($1, $1, 'NO') returning id", [slug]);
}

/** The store's default statuses (Life's template): Backlog and To do active, Done, Archived. */
async function defaults(storeId: string, checklistId: string | null = null) {
  const make = (name: string, slug: string, bucket: string, sort: number) =>
    id("insert into commerce.checklist_statuses (store_id, checklist_id, name, slug, bucket, sort_order) values ($1, $2, $3, $4, $5, $6) returning id", [
      storeId,
      checklistId,
      name,
      slug,
      bucket,
      sort,
    ]);
  return { backlog: await make("Backlog", "backlog", "active", 0), todo: await make("To do", "todo", "active", 1), done: await make("Done", "done", "done", 2), archived: await make("Archived", "archived", "archived", 3) };
}

async function checklist(storeId: string, over: { project?: string } = {}): Promise<string> {
  counter += 1;
  return id("insert into commerce.checklists (store_id, title, primary_project_id, created_by) values ($1, $2, $3, $4) returning id", [storeId, `List ${counter}`, over.project ?? null, account]);
}

async function project(storeId: string): Promise<string> {
  counter += 1;
  return id("insert into commerce.projects (store_id, name, created_by) values ($1, $2, $3) returning id", [storeId, `Project ${counter}`, account]);
}

async function item(storeId: string, checklistId: string, over: { status?: string; done?: boolean } = {}): Promise<string> {
  counter += 1;
  return id(
    `insert into commerce.checklist_items (store_id, checklist_id, title, status_id, done_at)
     values ($1, $2, $3, $4, case when $5 then now() end) returning id`,
    [storeId, checklistId, `Item ${counter}`, over.status ?? null, over.done ?? false],
  );
}

const itemRow = (itemId: string) => one<{ status_id: string | null; done: boolean; checklist_id: string }>("select status_id, done_at is not null as done, checklist_id from commerce.checklist_items where id = $1", [itemId]);
const homeOf = async (checklistId: string) => (await one<{ p: string | null }>("select primary_project_id as p from commerce.checklists where id = $1", [checklistId])).p;
const membersOf = async (checklistId: string) =>
  (await db.query<{ project_id: string }>("select project_id from commerce.project_checklists where checklist_id = $1 order by created_at", [checklistId])).rows.map((r) => r.project_id);

let shopStatuses: Awaited<ReturnType<typeof defaults>>;

beforeAll(async () => {
  db = await createTestDatabase();
  shop = await store("projects-shop");
  other = await store("projects-other");
  account = await id("insert into commerce.accounts (email) values ('planner@example.com') returning id", []);
  shopStatuses = await defaults(shop);
  await defaults(other);
});

afterAll(async () => {
  await db.close();
});

describe("the feature", () => {
  it("needs nothing, so a website or a workspace plans its work too", async () => {
    expect(await one("select commerce.feature_needs('projects') as needs")).toEqual({ needs: [] });
    await db.query("update commerce.stores set features = array['projects'] where id = $1", [other]);
    expect(await one("select commerce.feature_on($1, 'projects') as on", [other])).toEqual({ on: true });
    await db.query("update commerce.stores set features = '{}' where id = $1", [other]);
  });
});

describe("every row is its store's", () => {
  it("refuses a list, a status, an item or a stage of another store", async () => {
    const list = await checklist(shop);
    const theirs = await project(other);
    await rejects("insert into commerce.checklist_items (store_id, checklist_id, title) values ($1, $2, 'Elsewhere')", [other, list], /checklist_items_checklist_fk/);
    await rejects("insert into commerce.project_checklists (store_id, project_id, checklist_id) values ($1, $2, $3)", [shop, theirs, list], /project_checklists_project_fk/);
    await rejects("insert into commerce.checklist_statuses (store_id, checklist_id, name, slug) values ($1, $2, 'Mine', 'mine')", [other, list], /checklist_statuses_checklist_fk/);
    const theirStatus = await one<{ id: string }>("select id from commerce.checklist_statuses where store_id = $1 and checklist_id is null limit 1", [other]);
    await rejects("insert into commerce.checklist_items (store_id, checklist_id, title, status_id) values ($1, $2, 'Borrowed', $3)", [shop, list, theirStatus.id], /checklist_items_status_fk/);
  });

  it("keeps texts, buckets, colours, priorities, dates and money in their bounds", async () => {
    const list = await checklist(shop);
    await rejects("insert into commerce.projects (store_id, name) values ($1, ' padded ')", [shop], /projects_name/);
    await rejects("insert into commerce.projects (store_id, name, status) values ($1, 'Odd', 'paused')", [shop], /projects_status/);
    await rejects("insert into commerce.projects (store_id, name, health) values ($1, 'Odd', 'blue')", [shop], /projects_health/);
    await rejects("insert into commerce.projects (store_id, name, colour) values ($1, 'Odd', '#ff0000')", [shop], /projects_colour/);
    await rejects("insert into commerce.checklist_statuses (store_id, name, slug, bucket) values ($1, 'Odd', 'odd', 'later')", [shop], /checklist_statuses_bucket/);
    await rejects("insert into commerce.checklist_statuses (store_id, name, slug) values ($1, 'Upper', 'Upper')", [shop], /checklist_statuses_slug/);
    await rejects("insert into commerce.checklist_statuses (store_id, name, slug) values ($1, 'Again', 'todo')", [shop], /checklist_statuses_slug_key/);
    await rejects("insert into commerce.checklist_items (store_id, checklist_id, title, priority) values ($1, $2, 'Odd', 'urgent')", [shop, list], /checklist_items_priority/);
    await rejects(
      "insert into commerce.checklist_items (store_id, checklist_id, title, start_at, due_at) values ($1, $2, 'Backwards', now(), now() - interval '1 day')",
      [shop, list],
      /checklist_items_dates/,
    );
    await rejects("insert into commerce.checklist_items (store_id, checklist_id, title, cost_minor) values ($1, $2, 'No currency', 100)", [shop, list], /checklist_items_cost/);
    await rejects("insert into commerce.checklists (store_id, title, advanced_features) values ($1, 'Odd', '[]')", [shop], /checklists_features/);
    await db.query("insert into commerce.checklist_items (store_id, checklist_id, title, cost_minor, cost_currency) values ($1, $2, 'Paint', 24900, 'NOK')", [shop, list]);
  });
});

describe("a list's statuses", () => {
  it("are the store's defaults until the list has its own, which then replace them", async () => {
    const list = await checklist(shop);
    const before = await db.query<{ status_id: string }>("select status_id from commerce.checklist_effective_statuses($1, $2) order by sort_order", [shop, list]);
    expect(before.rows.map((r) => r.status_id)).toEqual([shopStatuses.backlog, shopStatuses.todo, shopStatuses.done, shopStatuses.archived]);
    const own = await defaults(shop, list);
    const after = await db.query<{ status_id: string }>("select status_id from commerce.checklist_effective_statuses($1, $2) order by sort_order", [shop, list]);
    expect(after.rows.map((r) => r.status_id)).toEqual([own.backlog, own.todo, own.done, own.archived]);
  });

  it("give a new item the first active status, or the first done one when it is made ticked", async () => {
    const list = await checklist(shop);
    expect((await itemRow(await item(shop, list))).status_id).toBe(shopStatuses.backlog);
    const ticked = await itemRow(await item(shop, list, { done: true }));
    expect(ticked).toMatchObject({ status_id: shopStatuses.done, done: true });
  });

  it("refuse a status of another list", async () => {
    const mine = await checklist(shop);
    const theirs = await checklist(shop);
    const own = await defaults(shop, theirs);
    await rejects("insert into commerce.checklist_items (store_id, checklist_id, title, status_id) values ($1, $2, 'Borrowed', $3)", [shop, mine, own.todo], /checklist_item.status_scope/);
  });
});

describe("the tick and the status agree", () => {
  it("ticks when a done or archived status is chosen, and unticks for an active one", async () => {
    const list = await checklist(shop);
    const i = await item(shop, list);
    await db.query("update commerce.checklist_items set status_id = $2 where id = $1", [i, shopStatuses.done]);
    expect(await itemRow(i)).toMatchObject({ done: true });
    await db.query("update commerce.checklist_items set status_id = $2 where id = $1", [i, shopStatuses.todo]);
    expect(await itemRow(i)).toMatchObject({ done: false });
    await db.query("update commerce.checklist_items set status_id = $2 where id = $1", [i, shopStatuses.archived]);
    expect(await itemRow(i)).toMatchObject({ done: true });
  });

  it("moves to the first done status when ticked, and back to the first active one when unticked from a finished status", async () => {
    const list = await checklist(shop);
    const i = await item(shop, list, { status: shopStatuses.todo });
    await db.query("update commerce.checklist_items set done_at = now() where id = $1", [i]);
    expect(await itemRow(i)).toMatchObject({ status_id: shopStatuses.done, done: true });
    await db.query("update commerce.checklist_items set done_at = null where id = $1", [i]);
    expect(await itemRow(i)).toMatchObject({ status_id: shopStatuses.backlog, done: false });
  });

  it("keeps a deliberate active status when unticked, and the tick when the status is cleared", async () => {
    const list = await checklist(shop);
    const own = await defaults(shop, list);
    const blocked = await id("insert into commerce.checklist_statuses (store_id, checklist_id, name, slug, bucket, sort_order) values ($1, $2, 'Blocked', 'blocked', 'active', 5) returning id", [
      shop,
      list,
    ]);
    const i = await item(shop, list, { status: blocked });
    // Ticking a blocked item moves it to done; unticking a done one goes to the first active status, not back to Blocked.
    await db.query("update commerce.checklist_items set done_at = now() where id = $1", [i]);
    expect(await itemRow(i)).toMatchObject({ status_id: own.done });
    const j = await item(shop, list, { status: blocked });
    await db.query("update commerce.checklist_items set title = 'Renamed' where id = $1", [j]);
    expect(await itemRow(j)).toMatchObject({ status_id: blocked, done: false });
    await db.query("update commerce.checklist_items set done_at = now() where id = $1", [j]);
    await db.query("update commerce.checklist_items set status_id = null where id = $1", [j]);
    expect(await itemRow(j)).toMatchObject({ status_id: null, done: true });
  });

  it("never refuses a tick in a list without a done status", async () => {
    const list = await checklist(shop);
    await id("insert into commerce.checklist_statuses (store_id, checklist_id, name, slug, bucket) values ($1, $2, 'Open', 'open', 'active') returning id", [shop, list]);
    const i = await item(shop, list);
    await db.query("update commerce.checklist_items set done_at = now() where id = $1", [i]);
    expect(await itemRow(i)).toMatchObject({ done: true });
  });
});

describe("an item moved to another list", () => {
  it("keeps its status by name there, or takes the new list's default", async () => {
    const from = await checklist(shop);
    const to = await checklist(shop);
    const own = await defaults(shop, to);
    const i = await item(shop, from, { status: shopStatuses.todo });
    await db.query("update commerce.checklist_items set checklist_id = $2 where id = $1", [i, to]);
    expect(await itemRow(i)).toMatchObject({ status_id: own.todo, checklist_id: to });
    const plain = await checklist(shop);
    const k = await item(shop, to, { status: own.done });
    await db.query("update commerce.checklist_items set checklist_id = $2 where id = $1", [k, plain]);
    expect(await itemRow(k)).toMatchObject({ status_id: shopStatuses.done, done: true });
  });

  it("loses its stage in a project the new list is not in", async () => {
    const p = await project(shop);
    const inside = await checklist(shop, { project: p });
    const outside = await checklist(shop);
    const i = await item(shop, inside);
    await db.query("insert into commerce.project_item_stages (store_id, project_id, item_id) values ($1, $2, $3)", [shop, p, i]);
    await db.query("update commerce.checklist_items set checklist_id = $2 where id = $1", [i, outside]);
    expect(await one("select count(*)::int as n from commerce.project_item_stages where item_id = $1", [i])).toEqual({ n: 0 });
  });
});

describe("subtasks", () => {
  it("go with their item, start without a status, and keep tick and status together once they have one", async () => {
    const list = await checklist(shop);
    const i = await item(shop, list);
    const plain = await id("insert into commerce.checklist_subtasks (store_id, item_id, title) values ($1, $2, 'Step') returning id", [shop, i]);
    expect(await one("select status_id from commerce.checklist_subtasks where id = $1", [plain])).toEqual({ status_id: null });
    await db.query("update commerce.checklist_subtasks set done_at = now() where id = $1", [plain]);
    expect(await one("select status_id, done_at is not null as done from commerce.checklist_subtasks where id = $1", [plain])).toEqual({ status_id: null, done: true });
    const tracked = await id("insert into commerce.checklist_subtasks (store_id, item_id, title, status_id) values ($1, $2, 'Tracked', $3) returning id", [shop, i, shopStatuses.done]);
    expect(await one("select done_at is not null as done from commerce.checklist_subtasks where id = $1", [tracked])).toEqual({ done: true });
    await db.query("update commerce.checklist_subtasks set done_at = null where id = $1", [tracked]);
    expect(await one("select status_id from commerce.checklist_subtasks where id = $1", [tracked])).toEqual({ status_id: shopStatuses.backlog });
    await db.query("delete from commerce.checklist_items where id = $1", [i]);
    expect(await one("select count(*)::int as n from commerce.checklist_subtasks where item_id = $1", [i])).toEqual({ n: 0 });
  });

  it("refuse a status of another list", async () => {
    const list = await checklist(shop);
    const elsewhere = await checklist(shop);
    const own = await defaults(shop, elsewhere);
    const i = await item(shop, list);
    await rejects("insert into commerce.checklist_subtasks (store_id, item_id, title, status_id) values ($1, $2, 'Borrowed', $3)", [shop, i, own.todo], /checklist_subtask.status_scope/);
  });
});

describe("projects and their lists", () => {
  it("make a list's first project its home, and setting a home links it", async () => {
    const p = await project(shop);
    const q = await project(shop);
    const list = await checklist(shop);
    await db.query("insert into commerce.project_checklists (store_id, project_id, checklist_id) values ($1, $2, $3)", [shop, p, list]);
    await db.query("insert into commerce.project_checklists (store_id, project_id, checklist_id) values ($1, $2, $3)", [shop, q, list]);
    expect(await homeOf(list)).toBe(p);
    const r = await project(shop);
    await db.query("update commerce.checklists set primary_project_id = $2 where id = $1", [list, r]);
    expect(await membersOf(list)).toEqual([p, q, r]);
  });

  it("move the home to another member when unlinked, or clear it, and forget the items' stages there", async () => {
    const p = await project(shop);
    const q = await project(shop);
    const list = await checklist(shop, { project: p });
    await db.query("insert into commerce.project_checklists (store_id, project_id, checklist_id) values ($1, $2, $3)", [shop, q, list]);
    const i = await item(shop, list);
    await db.query("insert into commerce.project_item_stages (store_id, project_id, item_id) values ($1, $2, $3)", [shop, p, i]);
    await db.query("delete from commerce.project_checklists where project_id = $1 and checklist_id = $2", [p, list]);
    expect(await homeOf(list)).toBe(q);
    expect(await one("select count(*)::int as n from commerce.project_item_stages where item_id = $1", [i])).toEqual({ n: 0 });
    await db.query("delete from commerce.projects where id = $1", [q]);
    expect(await homeOf(list)).toBeNull();
    expect(await membersOf(list)).toEqual([]);
  });

  it("keep a stage to items of the project's lists and to the project's own or default stages", async () => {
    const p = await project(shop);
    const q = await project(shop);
    const list = await checklist(shop, { project: p });
    const loose = await checklist(shop);
    const i = await item(shop, list);
    const j = await item(shop, loose);
    await rejects("insert into commerce.project_item_stages (store_id, project_id, item_id) values ($1, $2, $3)", [shop, p, j], /project_item_stage.not_member/);
    const theirs = await id("insert into commerce.project_statuses (store_id, project_id, name, slug) values ($1, $2, 'Shortlist', 'shortlist') returning id", [shop, q]);
    await rejects("insert into commerce.project_item_stages (store_id, project_id, item_id, status_id) values ($1, $2, $3, $4)", [shop, p, i, theirs], /project_item_stage.status_scope/);
    const mine = await id("insert into commerce.project_statuses (store_id, project_id, name, slug) values ($1, $2, 'Prospect', 'prospect') returning id", [shop, p]);
    await db.query("insert into commerce.project_item_stages (store_id, project_id, item_id, status_id) values ($1, $2, $3, $4)", [shop, p, i, mine]);
    const stages = await db.query<{ status_id: string }>("select status_id from commerce.project_effective_stages($1, $2)", [shop, p]);
    expect(stages.rows.map((r) => r.status_id)).toEqual([mine]);
  });

  it("keeps an item's stage when the stage is deleted, as none (the project's first)", async () => {
    const p = await project(shop);
    const list = await checklist(shop, { project: p });
    const i = await item(shop, list);
    const stage = await id("insert into commerce.project_statuses (store_id, project_id, name, slug) values ($1, $2, 'Review', 'review') returning id", [shop, p]);
    await db.query("insert into commerce.project_item_stages (store_id, project_id, item_id, status_id) values ($1, $2, $3, $4)", [shop, p, i, stage]);
    await db.query("delete from commerce.project_statuses where id = $1", [stage]);
    expect(await one("select status_id from commerce.project_item_stages where item_id = $1", [i])).toEqual({ status_id: null });
  });
});

describe("folds and blocking", () => {
  it("fold a section of the list's own only, once per person", async () => {
    const list = await checklist(shop);
    const elsewhere = await checklist(shop);
    const section = await id("insert into commerce.checklist_sections (store_id, checklist_id, title) values ($1, $2, 'Before') returning id", [shop, elsewhere]);
    await rejects("insert into commerce.checklist_folds (store_id, checklist_id, account_id, section_id) values ($1, $2, $3, $4)", [shop, list, account, section], /checklist_folds_section_fk/);
    await db.query("insert into commerce.checklist_folds (store_id, checklist_id, account_id) values ($1, $2, $3)", [shop, list, account]);
    await rejects("insert into commerce.checklist_folds (store_id, checklist_id, account_id) values ($1, $2, $3)", [shop, list, account], /checklist_folds_key/);
  });

  it("forget a blocking item that is deleted, and never block an item by itself", async () => {
    const list = await checklist(shop);
    const first = await item(shop, list);
    const second = await item(shop, list);
    await db.query("update commerce.checklist_items set blocked_by_item_id = $2, blocked_reason = 'Waiting for the supplier' where id = $1", [second, first]);
    await rejects("update commerce.checklist_items set blocked_by_item_id = id where id = $1", [first], /checklist_items_not_self_blocked/);
    await db.query("delete from commerce.checklist_items where id = $1", [first]);
    expect(await one("select blocked_by_item_id, checklist_id from commerce.checklist_items where id = $1", [second])).toEqual({ blocked_by_item_id: null, checklist_id: list });
  });
});
