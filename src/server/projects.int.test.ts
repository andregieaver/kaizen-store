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
const labels = await import("./projects-labels");
const comments = await import("./projects-comments");
const sources = await import("./projects-sources");
const dealProjects = await import("./projects-deals");
const attention = await import("./attention");
const { dayIn, addCalendarDays, noonOf } = await import("@/lib/work-dates");
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

describe("a duplicated list (P4.2)", () => {
  it("copies the shape of the work, all open, without due dates, repeats or archived tasks, its blocker and subtasks on the copies", async () => {
    const { id: projectId } = ok(await projects.createProject(store.member, { name: "Trade fair" }));
    const { id } = ok(await lists.createChecklist(store.member, { title: "The stand" }, projectId));
    ok(await lists.setChecklistMode(store.member, id, { isAdvanced: true }));
    ok(await statuses.useOwnStatuses(store.member, "checklist", id));
    ok(await items.addSection(store.member, id, "Before"));
    const { id: book } = ok(await items.addItem(store.member, id, { title: "Book the stand", dueAt: "2027-01-10T10:00:00Z", priority: "high", recurrence: { freq: "daily", times: ["09:00"] } }));
    const { id: banner } = ok(await items.addItem(store.member, id, { title: "Print the banner", blockedByItemId: book }));
    const { id: step } = ok(await items.addSubtask(store.member, banner, { title: "Proof it" }));
    ok(await items.updateSubtask(store.member, step, { done: true }));
    ok(await items.setItemDone(store.member, book, true));
    const { id: old } = ok(await items.addItem(store.member, id, { title: "Last year's flyer" }));
    ok(await items.setItemArchived(store.member, [old], true));

    const { id: copy } = ok(await lists.duplicateChecklist(store.member, id, "The stand (copy)"));
    const d = await detail(copy);
    expect(d).toMatchObject({ title: "The stand (copy)", isAdvanced: true, ownStatuses: true, primaryProjectId: projectId, done: [], archived: 0 });
    expect(d.projects).toEqual([{ id: projectId, name: "Trade fair" }]);
    expect(d.entries.filter((e) => e.kind === "section").map((e) => e.kind === "section" && e.section.title)).toEqual(["Before"]);
    const tasks = d.entries.flatMap((e) => (e.kind === "item" ? [e.item] : []));
    expect(tasks.map((t) => t.title).sort()).toEqual(["Book the stand", "Print the banner"]);
    const bookCopy = tasks.find((t) => t.title === "Book the stand");
    const bannerCopy = tasks.find((t) => t.title === "Print the banner");
    expect(bookCopy).toMatchObject({ done: false, dueAt: null, recurrence: null, streak: 0, priority: "high" });
    expect(d.statuses.map((s) => s.id)).toContain(bookCopy?.statusId);
    expect(bannerCopy?.blockedByItemId).toBe(bookCopy?.id);
    expect(bannerCopy?.subtasks.map((s) => [s.title, s.done])).toEqual([["Proof it", false]]);
    // The original is as it was.
    expect((await detail(id)).done.map((t) => t.title)).toEqual(["Book the stand"]);
    expect(await lists.duplicateChecklist(other.member, id, "Theirs")).toEqual({ ok: false, problem: "not_found" });
  });
});

describe("labels and comments (P4.6, P4.4)", () => {
  it("give a task a category and tags from the store's labels, kept in order and taken off with the label", async () => {
    const { id: marketing } = ok(await labels.addLabel(store.member, "category", { name: "Marketing", colour: "insight" }));
    const { id: urgent } = ok(await labels.addLabel(store.member, "tag", { name: "Urgent", colour: "danger" }));
    const { id: small } = ok(await labels.addLabel(store.member, "tag", { name: "Small", colour: "neutral" }));
    const { id } = ok(await lists.createChecklist(store.member, { title: "Labelled" }));
    const { id: task } = ok(await items.addItem(store.member, id, { title: "Write the post", categoryId: marketing, tagIds: [urgent] }));
    expect(itemOf(await detail(id), task)).toMatchObject({ categoryId: marketing, tagIds: [urgent] });
    ok(await items.updateItem(store.member, task, { tagIds: [small, urgent] }));
    ok(await labels.reorderLabels(store.member, "tag", [small, urgent]));
    expect(itemOf(await detail(id), task).tagIds).toEqual([small, urgent]);
    expect(await items.updateItem(store.member, task, { categoryId: urgent })).toMatchObject({ ok: false, problem: "invalid" });
    expect(await labels.addLabel(store.member, "tag", { name: "  ", colour: "neutral" })).toMatchObject({ ok: false, problem: "invalid" });
    const { id: copy } = ok(await lists.duplicateChecklist(store.member, id, "Labelled (copy)"));
    const [copied] = (await detail(copy)).entries.flatMap((e) => (e.kind === "item" ? [e.item] : []));
    expect(copied).toMatchObject({ categoryId: marketing, tagIds: [small, urgent] });
    ok(await labels.deleteLabel(store.member, marketing));
    ok(await items.updateItem(store.member, task, { tagIds: [] }));
    expect(itemOf(await detail(id), task)).toMatchObject({ categoryId: null, tagIds: [] });
  });

  it("keep a thread on a task that only each comment's writer changes or deletes", async () => {
    const { id } = ok(await lists.createChecklist(store.member, { title: "Talked about" }));
    const { id: task } = ok(await items.addItem(store.member, id, { title: "Choose the printer" }));
    const { id: comment } = ok(await comments.addComment(store.member, task, "  The usual one is booked until March.  "));
    const someoneElse = { ...store.member, account: { ...store.member.account, id: other.accountId } };
    expect(await comments.editComment(someoneElse, comment, "Mine now")).toEqual({ ok: false, problem: "not_found" });
    expect(await comments.deleteComment(someoneElse, comment)).toEqual({ ok: false, problem: "not_found" });
    ok(await comments.editComment(store.member, comment, "The usual one is booked until April."));
    const [said] = itemOf(await detail(id), task).comments;
    expect(said).toMatchObject({ body: "The usual one is booked until April.", writtenBy: store.accountId });
    expect(said?.editedAt).not.toBeNull();
    expect(await comments.addComment(store.member, task, "   ")).toMatchObject({ ok: false, problem: "invalid" });
    expect(await comments.addComment(other.member, task, "Sneaky")).toEqual({ ok: false, problem: "not_found" });
    ok(await comments.deleteComment(store.member, comment));
    expect(itemOf(await detail(id), task).comments).toEqual([]);
  });
});

describe("every open task (P4.8)", () => {
  it("lists the open tasks of open lists, the soonest due first, without the done, the archived, routines or closed lists", async () => {
    const { id } = ok(await lists.createChecklist(store.member, { title: "Across one" }));
    const { id: later } = ok(await items.addItem(store.member, id, { title: "Due later", dueAt: "2099-02-01T10:00:00Z" }));
    const { id: sooner } = ok(await items.addItem(store.member, id, { title: "Due sooner", dueAt: "2099-01-01T10:00:00Z" }));
    const { id: ticked } = ok(await items.addItem(store.member, id, { title: "Ticked" }));
    ok(await items.setItemDone(store.member, ticked, true));
    const { id: routine } = ok(await lists.createChecklist(store.member, { title: "A routine" }));
    ok(await lists.setChecklistMode(store.member, routine, { isRoutine: true }));
    const { id: habit } = ok(await items.addItem(store.member, routine, { title: "A habit" }));
    const { id: closed } = ok(await lists.createChecklist(store.member, { title: "Closed" }));
    const { id: old } = ok(await items.addItem(store.member, closed, { title: "In a closed list" }));
    ok(await lists.updateChecklist(store.member, closed, { status: "archived" }));
    const open = await lists.openTasks(store.storeId);
    const ids = open.map((t) => t.id);
    expect(ids.indexOf(sooner)).toBeLessThan(ids.indexOf(later));
    expect(ids).not.toContain(ticked);
    expect(ids).not.toContain(habit);
    expect(ids).not.toContain(old);
    expect(open.find((t) => t.id === sooner)).toMatchObject({ checklistId: id, checklistTitle: "Across one", statusId: expect.any(String) });
    expect((await lists.openTasks(other.storeId)).map((t) => t.id)).not.toContain(sooner);
  });
});

describe("a list's fingerprint (P4.10)", () => {
  it("changes when a teammate ticks, comments or adds, and is no one else's", async () => {
    const { id } = ok(await lists.createChecklist(store.member, { title: "Shared" }));
    const { id: task } = ok(await items.addItem(store.member, id, { title: "Hang the sign" }));
    const first = await lists.listFingerprint(store.storeId, id);
    expect(first).toEqual(expect.any(String));
    ok(await items.setItemDone(store.member, task, true));
    const ticked = await lists.listFingerprint(store.storeId, id);
    expect(ticked).not.toBe(first);
    ok(await comments.addComment(store.member, task, "Hung, a bit crooked."));
    expect(await lists.listFingerprint(store.storeId, id)).not.toBe(ticked);
    expect(await lists.listFingerprint(other.storeId, id)).toBeNull();
  });
});

describe("a template (P4.12)", () => {
  it("is kept apart, has no tasks to do, and its copy is an ordinary open list", async () => {
    const { id } = ok(await lists.createChecklist(store.member, { title: "Opening a pop-up" }));
    const { id: task } = ok(await items.addItem(store.member, id, { title: "Book the venue" }));
    ok(await lists.setChecklistMode(store.member, id, { asTemplate: true }));
    expect((await lists.listChecklists(store.storeId)).find((l) => l.id === id)).toMatchObject({ asTemplate: true });
    expect((await lists.openTasks(store.storeId)).map((t) => t.id)).not.toContain(task);
    const { id: copy } = ok(await lists.duplicateChecklist(store.member, id, "Pop-up in March"));
    const made = await detail(copy);
    expect(made).toMatchObject({ asTemplate: false, title: "Pop-up in March" });
    const [copied] = made.entries.flatMap((e) => (e.kind === "item" ? [e.item] : []));
    expect((await lists.openTasks(store.storeId)).map((t) => t.id)).toContain(copied?.id);
  });
});

describe("Home's attention (P4.9)", () => {
  it("counts the tasks late and due today of lists that show due dates: the reader's and nobody's, or the team's", async () => {
    const fresh = await newStore("projects-attention");
    await statuses.ensureDefaultStatuses(fresh.storeId, NAMES);
    const { id } = ok(await lists.createChecklist(fresh.member, { title: "Due things" }));
    ok(await lists.setChecklistMode(fresh.member, id, { isAdvanced: true }));
    const zone = fresh.member.store.timeZone;
    const today = dayIn(new Date(), zone);
    const day = (offset: number) => noonOf(addCalendarDays(today, offset), zone).toISOString();
    ok(await items.addItem(fresh.member, id, { title: "Late", dueAt: day(-1), allDay: true }));
    ok(await items.addItem(fresh.member, id, { title: "Today", dueAt: day(0), allDay: true }));
    ok(await items.addItem(fresh.member, id, { title: "Tomorrow", dueAt: day(1), allDay: true }));
    const { id: done } = ok(await items.addItem(fresh.member, id, { title: "Done late", dueAt: day(-2), allDay: true }));
    ok(await items.setItemDone(fresh.member, done, true));
    const gates = { disputes: [], decisions: [], leads: [], activities: [], comments: [], tasks: [fresh.storeId] };
    expect((await attention.queueCounts(gates, fresh.accountId)).tasks.get(fresh.storeId)).toEqual({ overdue: 1, today: 1 });
    expect((await attention.queueCounts(gates, null)).tasks.get(fresh.storeId)).toEqual({ overdue: 1, today: 1, team: true });
    // A list that hides its due dates asks nothing of anyone.
    ok(await lists.setChecklistMode(fresh.member, id, { features: { dueDate: false } }));
    expect((await attention.queueCounts(gates, fresh.accountId)).tasks.get(fresh.storeId)).toBeUndefined();
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

describe("a task from where it came from (D904 P8.3a)", () => {
  const conversation = async (storeId: string, name: string | null = null) =>
    (
      await db().execute<{ id: string }>(sql`
        insert into commerce.support_conversations (store_id, source, handler, token_hash, locale, contact_name)
        values (${storeId}::uuid, 'site', 'ai', md5(gen_random_uuid()::text), 'en', ${name}) returning id`)
    )[0].id;
  const LINK_WORDS = { order: "Order {label}", return: "Return {label}", review: "Review by {label}", conversation: "Conversation with {label}", conversationUnnamed: "A conversation" };

  it("goes to the store's list for follow-ups, made once, links back, and is shown on its source", async () => {
    const chat = await conversation(store.storeId, "Kari");
    const first = ok(await sources.addSourceTask(store.member, { kind: "conversation", sourceId: chat, title: "Call Kari back", checklistId: null }, "Follow-ups"));
    const second = ok(await sources.addSourceTask(store.member, { kind: "conversation", sourceId: chat, title: "Send the new size", checklistId: null }, "Follow-ups"));
    const lists = await db().execute<{ id: string }>(sql`select id from commerce.checklists where store_id = ${store.storeId}::uuid and title = 'Follow-ups'`);
    expect(lists).toHaveLength(1);
    const here = await sources.sourceTasks(store.storeId, { kind: "conversation", id: chat });
    expect(here.tasks.map((t) => t.id).sort()).toEqual([first.id, second.id].sort());
    expect(here.tasks.every((t) => t.listTitle === "Follow-ups")).toBe(true);
    expect(here.lists.some((l) => l.title === "Follow-ups")).toBe(true);
    // The list's page links each back to the conversation (extensions are not sold in this database, so the desk is there).
    const links = await sources.sourceLinks(store.member, [{ id: first.id, source: { kind: "conversation", id: chat } }], LINK_WORDS);
    expect(links[first.id]).toEqual({ text: "Conversation with Kari", href: `/admin/${store.member.store.slug}/support?c=${chat}` });
  });

  it("refuses another store's conversation and an order that is not there", async () => {
    const theirs = await conversation(other.storeId);
    expect(await sources.addSourceTask(store.member, { kind: "conversation", sourceId: theirs, title: "Not ours", checklistId: null }, "Follow-ups")).toMatchObject({
      ok: false,
      problem: "invalid",
    });
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await sources.addSourceTask(store.member, { kind: "order", sourceId: missing, title: "No such order", checklistId: null }, "Follow-ups")).toMatchObject({
      ok: false,
      problem: "not_found",
    });
  });
});

describe("a project from a won deal (D904 P8.3b)", () => {
  it("is named after the deal, linked to it, and starts with a copy of the template list, at home in the new project", async () => {
    const [pipeline] = await db().execute<{ id: string }>(sql`insert into commerce.deal_pipelines (store_id, name) values (${store.storeId}::uuid, 'Sales') returning id`);
    const [stage] = await db().execute<{ id: string }>(
      sql`insert into commerce.deal_stages (store_id, pipeline_id, name, position) values (${store.storeId}::uuid, ${pipeline.id}::uuid, 'New', 0) returning id`,
    );
    const [deal] = await db().execute<{ id: string }>(sql`
      insert into commerce.deals (store_id, title, pipeline_id, stage_id, currency)
      values (${store.storeId}::uuid, 'Fit-out for Café Nord', ${pipeline.id}::uuid, ${stage.id}::uuid, 'NOK') returning id`);
    const { id: template } = ok(await lists.createChecklist(store.member, { title: "Shop fit-out steps" }));
    ok(await items.addItem(store.member, template, { title: "Measure the room" }));
    ok(await lists.setChecklistMode(store.member, template, { asTemplate: true }));

    const made = ok(await dealProjects.startDealProject(store.member, { dealId: deal.id, templateId: template }));
    expect(await dealProjects.dealOfProject(store.storeId, made.id)).toEqual({ id: deal.id, title: "Fit-out for Café Nord" });
    expect((await dealProjects.projectsOfDeal(store.storeId, deal.id)).map((p) => p.id)).toEqual([made.id]);
    const [copy] = await db().execute<{ id: string; as_template: boolean; primary_project_id: string; tasks: number }>(sql`
      select l.id, l.as_template, l.primary_project_id, (select count(*)::int from commerce.checklist_items i where i.checklist_id = l.id) as tasks
        from commerce.project_checklists pc join commerce.checklists l on l.id = pc.checklist_id
       where pc.store_id = ${store.storeId}::uuid and pc.project_id = ${made.id}::uuid`);
    expect(copy).toMatchObject({ as_template: false, primary_project_id: made.id, tasks: 1 });

    expect(await dealProjects.startDealProject(store.member, { dealId: "00000000-0000-4000-8000-000000000000", templateId: null })).toMatchObject({ ok: false, problem: "not_found" });
  });
});

