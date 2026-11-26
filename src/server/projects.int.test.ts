import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const projects = await import("./projects");
const lists = await import("./projects-lists");
const items = await import("./projects-items");
const statuses = await import("./projects-statuses");
const repeat = await import("./projects-repeat");
const { newStore } = await import("./inventory-test-support");

type TestStore = Awaited<ReturnType<typeof newStore>>;

/**
 * Projects and checklists (D903) through the server, against a real database. What is held: the store's default statuses are made once in
 * the words given; a list is plain until Advanced, and a field switched off is stored and its data kept; items go to the end, a ticked one
 * sinks below the open ones but in a routine; items and sections share one order; a list's own statuses copy the store's and carry its items
 * along, and going back moves them home; a status moved to the done bucket ticks its items; a project's stages and lists, the home project,
 * and a stage only for an item of the project; another store's rows are not found, and a member who may only read changes nothing.
 */

let store: TestStore;
let other: TestStore;

const NAMES = { todo: "To do", doing: "In progress", done: "Done", archived: "Archived" };

beforeAll(async () => {
  store = await newStore("projects");
  other = await newStore("projects-other");
  await statuses.ensureDefaultStatuses(store.storeId, NAMES);
  await statuses.ensureDefaultStatuses(other.storeId, NAMES);
});

afterAll(async () => {
  await closeDb();
});

function ok<T extends object>(result: { ok: true } & T): T;
function ok<T extends object>(result: ({ ok: true } & T) | { ok: false; problem: string }): T;
function ok<T extends object>(result: ({ ok: true } & T) | { ok: false; problem: string }): T {
  if (!result.ok) throw new Error(`refused: ${result.problem}`);
  return result;
}

const detail = async (id: string) => {
  const found = await lists.checklistDetail(store.storeId, id, store.accountId);
  if (!found) throw new Error("no list");
  return found;
};

describe("the store's default statuses", () => {
  it("are made once, in the words given, and never renamed by a second visit", async () => {
    await statuses.ensureDefaultStatuses(store.storeId, { todo: "Å gjøre", doing: "Pågår", done: "Ferdig", archived: "Arkivert" });
    const mine = await statuses.statusesOf(store.storeId, "checklist", null);
    expect(mine.map((s) => s.name)).toEqual(["To do", "In progress", "Done", "Archived"]);
    expect((await statuses.statusesOf(store.storeId, "project", null)).map((s) => s.bucket)).toEqual(["active", "active", "done", "archived"]);
  });
});

describe("a checklist", () => {
  it("is plain until Advanced, and keeps a hidden field's data", async () => {
    const { id } = ok(await lists.createChecklist(store.member, { title: "Opening the shop" }));
    expect((await detail(id)).features.dueDate).toBe(false);
    ok(await lists.setChecklistMode(store.member, id, { isAdvanced: true, features: { cost: false } }));
    const advanced = await detail(id);
    expect(advanced.features).toMatchObject({ dueDate: true, cost: false });
    const { id: itemId } = ok(await items.addItem(store.member, id, { title: "Paint the sign", cost: { minor: 49900, currency: "NOK" } }));
    ok(await lists.setChecklistMode(store.member, id, { isAdvanced: false }));
    const plain = await detail(id);
    const item = plain.entries.find((e) => e.kind === "item" && e.item.id === itemId);
    expect(item?.kind === "item" && item.item.cost).toEqual({ minor: 49900, currency: "NOK" });
  });

  it("puts new items at the end, sinks a ticked one, and keeps a routine's order", async () => {
    const { id } = ok(await lists.createChecklist(store.member, { title: "Packing" }));
    ok(await items.addItems(store.member, id, ["Boxes", "Tape", "  ", "Labels"]));
    const [boxes, tape] = (await detail(id)).entries.flatMap((e) => (e.kind === "item" ? [e.item] : []));
    ok(await items.setItemDone(store.member, boxes.id, true));
    const after = await detail(id);
    expect(after.entries.flatMap((e) => (e.kind === "item" ? [e.item.title] : []))).toEqual(["Tape", "Labels"]);
    expect(after.done.map((i) => i.title)).toEqual(["Boxes"]);
    expect(after.done[0].statusId).toBe((await statuses.statusesOf(store.storeId, "checklist", null)).find((s) => s.slug === "done")?.id);

    const { id: routine } = ok(await lists.createChecklist(store.member, { title: "Closing up" }));
    ok(await lists.setChecklistMode(store.member, routine, { isRoutine: true }));
    ok(await items.addItems(store.member, routine, ["Lights", "Till", "Door"]));
    const [lights] = (await detail(routine)).entries.flatMap((e) => (e.kind === "item" ? [e.item] : []));
    ok(await items.setItemDone(store.member, lights.id, true));
    const kept = await detail(routine);
    expect(kept.done[0].sortOrder).toBe(lights.sortOrder);
    expect(ok(await lists.resetChecklist(store.member, routine)).reset).toBe(1);
    void tape;
  });

  it("orders items and sections in one sequence, and folds for the person only", async () => {
    const { id } = ok(await lists.createChecklist(store.member, { title: "Launch" }));
    ok(await items.addItems(store.member, id, ["Photos", "Texts"]));
    const { id: before } = ok(await items.addSection(store.member, id, "Before the launch"));
    const [photos, texts] = (await detail(id)).entries.flatMap((e) => (e.kind === "item" ? [e.item] : []));
    ok(
      await items.reorderEntries(store.member, id, [
        { kind: "section", id: before },
        { kind: "item", id: texts.id },
        { kind: "item", id: photos.id },
      ]),
    );
    expect((await detail(id)).entries.map((e) => (e.kind === "section" ? `# ${e.section.title}` : e.item.title))).toEqual(["# Before the launch", "Texts", "Photos"]);
    ok(await lists.setFold(store.member, id, before, true));
    ok(await lists.setFold(store.member, id, null, true));
    expect((await detail(id)).folds.sort()).toEqual([before, "done"].sort());
    ok(await lists.setFold(store.member, id, null, false));
    expect((await detail(id)).folds).toEqual([before]);
  });

  it("moves, archives, gives a status to and deletes items in bulk", async () => {
    const { id: from } = ok(await lists.createChecklist(store.member, { title: "Inbox" }));
    const { id: to } = ok(await lists.createChecklist(store.member, { title: "This week" }));
    ok(await items.addItems(store.member, from, ["One", "Two", "Three"]));
    const ids = (await detail(from)).entries.flatMap((e) => (e.kind === "item" ? [e.item.id] : []));
    expect(ok(await items.moveItems(store.member, ids.slice(0, 2), to)).changed).toBe(2);
    const done = (await statuses.statusesOf(store.storeId, "checklist", null)).find((s) => s.slug === "done");
    expect(ok(await items.setItemsStatus(store.member, ids.slice(0, 2), done?.id ?? null)).changed).toBe(2);
    expect((await detail(to)).done).toHaveLength(2);
    expect(ok(await items.setItemArchived(store.member, [ids[2]], true)).changed).toBe(1);
    expect((await detail(from)).archived).toBe(1);
    expect(ok(await items.deleteItems(store.member, ids)).changed).toBe(3);
  });

  it("keeps subtasks with their item, and promotes one to an item right after it", async () => {
    const { id } = ok(await lists.createChecklist(store.member, { title: "Photoshoot" }));
    ok(await items.addItems(store.member, id, ["Book the studio", "Edit"]));
    const [studio] = (await detail(id)).entries.flatMap((e) => (e.kind === "item" ? [e.item] : []));
    const { id: step } = ok(await items.addSubtask(store.member, studio.id, { title: "Ask for a quote", isGoal: true }));
    ok(await items.updateSubtask(store.member, step, { done: true }));
    expect((await detail(id)).entries.find((e) => e.kind === "item" && e.item.id === studio.id)).toMatchObject({ item: { subtasks: [{ done: true, isGoal: true }] } });
    const { id: second } = ok(await items.addSubtask(store.member, studio.id, { title: "Pick a date" }));
    ok(await items.promoteSubtask(store.member, second));
    expect((await detail(id)).entries.flatMap((e) => (e.kind === "item" ? [e.item.title] : []))).toEqual(["Book the studio", "Pick a date", "Edit"]);
  });
});

describe("statuses of a list's own", () => {
  it("copy the store's and carry the items along, and going back moves them home", async () => {
    const { id } = ok(await lists.createChecklist(store.member, { title: "Supplier" }));
    const { id: itemId } = ok(await items.addItem(store.member, id, { title: "Call them" }));
    const { id: waiting } = ok(await statuses.addStatus(store.member, "checklist", id, { name: "Waiting", colour: "warning", bucket: "active" }));
    const own = await detail(id);
    expect(own.ownStatuses).toBe(true);
    expect(own.statuses.map((s) => s.name)).toEqual(["To do", "In progress", "Done", "Archived", "Waiting"]);
    const item = own.entries.find((e) => e.kind === "item");
    expect(item?.kind === "item" && own.statuses.find((s) => s.id === item.item.statusId)?.scopeId).toBe(id);
    ok(await items.updateItem(store.member, itemId, { statusId: waiting }));
    ok(await statuses.useStoreStatuses(store.member, "checklist", id));
    const back = await detail(id);
    expect(back.ownStatuses).toBe(false);
    const moved = back.entries.find((e) => e.kind === "item");
    expect(moved?.kind === "item" && back.statuses.find((s) => s.id === moved.item.statusId)?.slug).toBe("todo");
  });

  it("tick their items when a status moves to the done bucket, and refuse to delete the replacement's own scope's last", async () => {
    const { id } = ok(await lists.createChecklist(store.member, { title: "Review" }));
    const { id: review } = ok(await statuses.addStatus(store.member, "checklist", id, { name: "In review", colour: "insight", bucket: "active" }));
    const { id: itemId } = ok(await items.addItem(store.member, id, { title: "The copy", statusId: review }));
    ok(await statuses.updateStatus(store.member, "checklist", review, { name: "Approved", colour: "positive", bucket: "done" }));
    const after = (await detail(id)).done.find((i) => i.id === itemId);
    expect(after).toMatchObject({ done: true, statusId: review });
    const todo = (await detail(id)).statuses.find((s) => s.slug === "todo");
    ok(await statuses.deleteStatus(store.member, "checklist", review, todo?.id ?? ""));
    expect((await detail(id)).entries.find((e) => e.kind === "item" && e.item.id === itemId)).toBeTruthy();
    const foreign = (await statuses.statusesOf(other.storeId, "checklist", null))[0];
    expect(await statuses.deleteStatus(store.member, "checklist", foreign.id, todo?.id ?? "")).toEqual({ ok: false, problem: "not_found" });
  });

  it("reorder only their own scope", async () => {
    const defaults = await statuses.statusesOf(store.storeId, "checklist", null);
    expect(await statuses.reorderStatuses(store.member, "checklist", null, defaults.slice(1).map((s) => s.id))).toEqual({ ok: false, problem: "invalid" });
    ok(await statuses.reorderStatuses(store.member, "checklist", null, [...defaults].reverse().map((s) => s.id)));
    ok(await statuses.reorderStatuses(store.member, "checklist", null, defaults.map((s) => s.id)));
  });
});

type Detail = Awaited<ReturnType<typeof detail>>;
const itemOf = (list: Detail | null, id: string) => {
  const found = [...(list?.entries ?? []).flatMap((e) => (e.kind === "item" ? [e.item] : [])), ...(list?.done ?? [])].find((i) => i.id === id);
  if (!found) throw new Error("no item");
  return found;
};
const passTime = (id: string) => db().execute(sql`update commerce.checklist_items set next_due_at = now() - interval '1 minute' where store_id = ${store.storeId}::uuid and id = ${id}::uuid`);

describe("a repeating task (P4.1)", () => {
  it("comes back at its next time once done, its run one longer and its subtasks unticked; a missed time breaks the run", async () => {
    const { id } = ok(await lists.createChecklist(store.member, { title: "Daily round" }));
    ok(await lists.setChecklistMode(store.member, id, { isAdvanced: true }));
    const { id: itemId } = ok(await items.addItem(store.member, id, { title: "Water the plants", recurrence: { freq: "daily", times: ["08:00"] } }));
    const { id: stepId } = ok(await items.addSubtask(store.member, itemId, { title: "The front" }));
    expect(Date.parse(itemOf(await detail(id), itemId).nextDueAt ?? "")).toBeGreaterThan(Date.now());
    ok(await items.updateSubtask(store.member, stepId, { done: true }));
    ok(await items.setItemDone(store.member, itemId, true));
    const done = itemOf(await detail(id), itemId);
    expect(done).toMatchObject({ done: true, streak: 1 });
    expect(done.lastCompletedAt).not.toBeNull();

    // Its time comes: the list's page rolls it on before it draws it.
    await passTime(itemId);
    const back = itemOf(await lists.checklistDetail(store.storeId, id, store.accountId, "Europe/Oslo"), itemId);
    expect(back).toMatchObject({ done: false, streak: 1 });
    expect(back.subtasks[0]?.done).toBe(false);
    expect(Date.parse(back.nextDueAt ?? "")).toBeGreaterThan(Date.now());

    // Its next time passes untouched: the dispatcher rolls it, the run is broken, and a second roll finds nothing.
    await passTime(itemId);
    expect((await repeat.rollOverDueTasks()).rolled).toBeGreaterThanOrEqual(1);
    expect(itemOf(await detail(id), itemId).streak).toBe(0);
    expect(await repeat.rollOver(store.storeId, "Europe/Oslo", [{ id: itemId, recurrence: back.recurrence }])).toEqual([]);
  });

  it("is skipped with its run broken, its tick is undone exactly, and taking the rule off forgets the run", async () => {
    const { id } = ok(await lists.createChecklist(store.member, { title: "Weekly" }));
    const { id: itemId } = ok(await items.addItem(store.member, id, { title: "Count the till", recurrence: { freq: "weekly", weekdays: [1], times: ["20:00"] } }));
    ok(await items.setItemDone(store.member, itemId, true));
    await passTime(itemId);
    const open = itemOf(await lists.checklistDetail(store.storeId, id, store.accountId, "Europe/Oslo"), itemId);
    expect(open).toMatchObject({ done: false, streak: 1 });

    const moment = { doneAt: open.doneAt, skippedAt: open.skippedAt, lastCompletedAt: open.lastCompletedAt, nextDueAt: open.nextDueAt, streak: open.streak, sortOrder: open.sortOrder, statusId: open.statusId };
    ok(await items.setItemDone(store.member, itemId, true));
    expect(itemOf(await detail(id), itemId)).toMatchObject({ done: true, streak: 2 });
    ok(await items.restoreItem(store.member, itemId, moment));
    expect(itemOf(await detail(id), itemId)).toMatchObject({ done: false, streak: 1, nextDueAt: open.nextDueAt, statusId: open.statusId, sortOrder: open.sortOrder });

    ok(await items.skipItem(store.member, itemId));
    const skipped = itemOf(await detail(id), itemId);
    expect(skipped).toMatchObject({ done: false, streak: 0 });
    expect(skipped.skippedAt).not.toBeNull();
    expect(Date.parse(skipped.nextDueAt ?? "")).toBeGreaterThanOrEqual(Date.parse(open.nextDueAt ?? ""));

    ok(await items.updateItem(store.member, itemId, { recurrence: null }));
    expect(itemOf(await detail(id), itemId)).toMatchObject({ recurrence: null, nextDueAt: null, streak: 0, skippedAt: null });
    expect(await items.updateItem(store.member, itemId, { recurrence: { freq: "weekly", weekdays: [], times: ["09:00"] } })).toMatchObject({ ok: false, problem: "invalid" });
  });
});

describe("a project", () => {
  it("has lists (the first its home), stages for their items, and a bar of where they stand", async () => {
    const { id: projectId } = ok(await projects.createProject(store.member, { name: "Black Friday", targetDate: "2026-11-27" }));
    const { id: listId } = ok(await lists.createChecklist(store.member, { title: "Campaign" }, projectId));
    ok(await items.addItems(store.member, listId, ["Banner", "Email"]));
    const project = await projects.projectDetail(store.storeId, projectId);
    expect(project?.checklists).toMatchObject([{ id: listId, home: true, total: 2 }]);
    const [banner] = project?.items ?? [];
    const doing = project?.stages.find((s) => s.slug === "doing");
    ok(await projects.setItemStage(store.member, projectId, banner.id, doing?.id ?? null));
    const staged = await projects.projectDetail(store.storeId, projectId);
    expect(staged?.items.find((i) => i.id === banner.id)?.stageId).toBe(doing?.id);
    expect(staged?.bar.parts.map((p) => [p.name, p.count])).toEqual([
      ["To do", 1],
      ["In progress", 1],
    ]);
    ok(await projects.updateProject(store.member, projectId, { status: "blocked", health: "amber", nextAction: "Ask the printer" }));
    expect((await projects.projectDetail(store.storeId, projectId))?.statusReviewedAt).not.toBeNull();
  });

  it("refuses a stage for an item of a list not in it, and keeps lists when it is deleted", async () => {
    const { id: projectId } = ok(await projects.createProject(store.member, { name: "New shelf" }));
    const { id: loose } = ok(await lists.createChecklist(store.member, { title: "Loose" }));
    const { id: itemId } = ok(await items.addItem(store.member, loose, { title: "Measure" }));
    expect(await projects.setItemStage(store.member, projectId, itemId, null)).toEqual({ ok: true });
    const stage = (await statuses.statusesOf(store.storeId, "project", null))[1];
    expect(await projects.setItemStage(store.member, projectId, itemId, stage.id)).toEqual({ ok: false, problem: "invalid" });
    ok(await projects.linkChecklist(store.member, projectId, loose));
    ok(await projects.deleteProject(store.member, projectId));
    expect((await detail(loose)).projects).toEqual([]);
  });
});

describe("who may", () => {
  it("finds nothing of another store", async () => {
    const { id } = ok(await lists.createChecklist(other.member, { title: "Theirs" }));
    expect(await lists.checklistDetail(store.storeId, id, store.accountId)).toBeNull();
    expect(await lists.updateChecklist(store.member, id, { title: "Mine now" })).toEqual({ ok: false, problem: "not_found" });
    expect(await items.addItem(store.member, id, { title: "Sneaky" })).toEqual({ ok: false, problem: "not_found" });
    expect(await lists.createChecklist(store.member, { title: "Theirs assigned", assignedTo: other.accountId })).toEqual({ ok: false, problem: "invalid", fields: ["assignedTo"] });
  });

  it("changes nothing for a member who may only read projects", async () => {
    const reader = { ...store.member, role: "admin" as const, permissions: ["projects:read"] };
    expect(await lists.createChecklist(reader, { title: "Nope" })).toEqual({ ok: false, problem: "forbidden" });
    expect(await projects.createProject(reader, { name: "Nope" })).toEqual({ ok: false, problem: "forbidden" });
    const [row] = await db().execute<{ n: number }>(sql`select count(*)::int as n from commerce.checklists where store_id = ${store.storeId}::uuid and title = 'Nope'`);
    expect(row.n).toBe(0);
  });
});
