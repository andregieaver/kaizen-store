import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

// The permission layer is the one thing replaced: the actions below are the ones the Orders page's forms call, and what they do with a member is read from the real database.
const access = vi.hoisted(() => ({ member: null as unknown, allow: true, asked: [] as string[] }));
vi.mock("./permissions", async (original) => ({
  ...(await original<typeof import("./permissions")>()),
  checkPermission: async (_slug: string, key: string) => {
    access.asked.push(key);
    return access.allow ? access.member : null;
  },
}));

const { newPlainStore, seedOrder } = await import("./order-ops-fixture");
const { bulkOrdersAction, deleteOrderViewAction, saveOrderViewAction } = await import("@/app/admin/(gated)/[store]/orders/list-actions");
const { archiveOrderAction, changeTagsAction, unarchiveOrderAction } = await import("@/app/admin/(gated)/[store]/orders/ops-actions");
const { listOrderViews } = await import("./order-views");
const { getOrderTags } = await import("./order-tags");

type Row = Record<string, unknown>;

/**
 * The server actions behind the Orders page and the order page (wave 3, run 2, D173): the layer between a form or a button and the tested server functions. No test clicks the signed-in
 * admin, so this holds what the screen sends: the permission asked (`orders:write`), what an action does with the text typed, the query "all matching" sends, and the words a refusal comes back in.
 */

afterAll(async () => {
  await closeDb();
});

beforeEach(() => {
  access.allow = true;
  access.asked = [];
});

async function setup(label: string) {
  const store = await newPlainStore(label);
  access.member = { ...store.member, store: { ...store.member.store, id: store.storeId, slug: store.slug } };
  return store;
}

const archivedAt = async (id: string) => (await db().execute<Row>(sql`select archived_at from commerce.orders where id = ${id}::uuid`))[0].archived_at;

describe("without the right to change orders", () => {
  it("every action answers that there is no access and changes nothing", async () => {
    const store = await setup("actions-denied");
    const order = await seedOrder(store, { status: "fulfilled", captured: true, tags: ["keep"] });
    access.allow = false;
    expect(await changeTagsAction(store.slug, order.id, { add: "new" })).toMatchObject({ ok: false, message: "You do not have access to do this." });
    expect(await archiveOrderAction(store.slug, order.id)).toMatchObject({ ok: false });
    expect(await unarchiveOrderAction(store.slug, order.id)).toMatchObject({ ok: false });
    expect(await bulkOrdersAction(store.slug, { action: "archive", ids: [order.id] })).toMatchObject({ ok: false, message: "You do not have access to do this." });
    expect(await saveOrderViewAction(store.slug, { title: "Nope", query: "pay=paid" })).toMatchObject({ ok: false });
    expect(await deleteOrderViewAction(store.slug, crypto.randomUUID())).toMatchObject({ ok: false });
    expect(access.asked.every((key) => key === "orders:write")).toBe(true);
    expect(await archivedAt(order.id)).toBeNull();
    expect((await getOrderTags(store.storeId, order.id)).map((t) => t.label)).toEqual(["keep"]);
    expect(await listOrderViews(store.storeId)).toEqual([]);
  });
});

describe("the order page's tag card and archive button", () => {
  it("adds typed tags (commas split them), says what was added or already there, removes one, and refuses a tag that breaks the rules in words", async () => {
    const store = await setup("actions-tags");
    const order = await seedOrder(store, { status: "fulfilled", captured: true });
    const added = await changeTagsAction(store.slug, order.id, { add: "VIP, rush order" });
    expect(added).toMatchObject({ ok: true });
    expect(added.tags?.map((t) => t.label).sort()).toEqual(["VIP", "rush order"]);
    expect((await getOrderTags(store.storeId, order.id)).map((t) => t.label).sort()).toEqual(["VIP", "rush order"]);
    // The same tag in another case is the same tag.
    expect(await changeTagsAction(store.slug, order.id, { add: "vip" })).toMatchObject({ message: expect.stringContaining("already") });
    expect((await getOrderTags(store.storeId, order.id)).length).toBe(2);
    expect(await changeTagsAction(store.slug, order.id, { remove: "VIP" })).toMatchObject({ ok: true });
    expect((await getOrderTags(store.storeId, order.id)).map((t) => t.label)).toEqual(["rush order"]);
    // Rules: 40 characters, no empty, a malformed id is "no longer exists".
    expect(await changeTagsAction(store.slug, order.id, { add: "x".repeat(41) })).toMatchObject({ ok: false, tags: null });
    expect(await changeTagsAction(store.slug, order.id, { add: "  " })).toMatchObject({ ok: false, message: "Write a tag first." });
    expect(await changeTagsAction(store.slug, "not-an-id", { add: "a" })).toMatchObject({ ok: false, message: "This order no longer exists." });
  });

  it("tags another store's order as not found, and tags copied history", async () => {
    const mine = await setup("actions-tags-mine");
    const theirs = await newPlainStore("actions-tags-theirs");
    const foreign = await seedOrder(theirs, { status: "fulfilled", captured: true });
    expect(await changeTagsAction(mine.slug, foreign.id, { add: "stolen" })).toMatchObject({ ok: false, message: "This order no longer exists." });
    expect(await getOrderTags(theirs.storeId, foreign.id)).toEqual([]);
    const copied = await seedOrder(mine, { copied: true, status: "fulfilled" });
    expect(await changeTagsAction(mine.slug, copied.id, { add: "history" })).toMatchObject({ ok: true });
  });

  it("archives a finished order, says why it will not archive one that still has to be sent, and brings the first back", async () => {
    const store = await setup("actions-archive");
    const done = await seedOrder(store, { status: "fulfilled", captured: true });
    const toSend = await seedOrder(store, { status: "paid", captured: true });
    expect(await archiveOrderAction(store.slug, done.id)).toEqual({ ok: true, message: "Archived.", archived: true });
    expect(await archivedAt(done.id)).not.toBeNull();
    expect(await archiveOrderAction(store.slug, done.id)).toMatchObject({ ok: false, archived: true });
    const refused = await archiveOrderAction(store.slug, toSend.id);
    expect(refused.ok).toBe(false);
    expect(refused.message).toBeTruthy();
    expect(await archivedAt(toSend.id)).toBeNull();
    expect(await unarchiveOrderAction(store.slug, done.id)).toEqual({ ok: true, message: "Unarchived.", archived: false });
    expect(await archivedAt(done.id)).toBeNull();
    expect(await unarchiveOrderAction(store.slug, done.id)).toMatchObject({ ok: false, archived: false });
  });
});

describe("the list's bulk bar and saved views", () => {
  it("runs a bulk action on ticked ids, and on 'all matching' from the list's query typed in the address, never from ids the browser names", async () => {
    const store = await setup("actions-bulk");
    const a = await seedOrder(store, { status: "fulfilled", captured: true, tags: ["batch"] });
    const b = await seedOrder(store, { status: "fulfilled", captured: true, tags: ["batch"] });
    const other = await seedOrder(store, { status: "fulfilled", captured: true });
    const ticked = await bulkOrdersAction(store.slug, { action: "add_tags", ids: [a.id, other.id], tags: ["picked"] });
    expect(ticked).toMatchObject({ ok: true, result: { applied: 2, refused: [] } });
    const matching = await bulkOrdersAction(store.slug, { action: "archive", matchingQuery: "tag=batch" });
    expect(matching).toMatchObject({ ok: true, result: { requested: 2, applied: 2 } });
    expect(await archivedAt(a.id)).not.toBeNull();
    expect(await archivedAt(b.id)).not.toBeNull();
    expect(await archivedAt(other.id)).toBeNull();
    // Printing is a link to the slips page, not an action; an unknown action is refused before it runs.
    expect(await bulkOrdersAction(store.slug, { action: "print_slips", ids: [a.id] })).toMatchObject({ ok: false });
    expect(await bulkOrdersAction(store.slug, { action: "explode", ids: [a.id] })).toMatchObject({ ok: false });
    // A refusal comes back per order, with its reason.
    const toSend = await seedOrder(store, { status: "paid", captured: true });
    const mixed = await bulkOrdersAction(store.slug, { action: "archive", ids: [other.id, toSend.id] });
    expect(mixed).toMatchObject({ ok: true, result: { requested: 2, applied: 1 } });
    if (mixed.ok) expect(mixed.result.refused.map((r) => r.id)).toEqual([toSend.id]);
  });

  it("saves the list's state as a view from the address, keeps what the parser keeps, and deletes it", async () => {
    const store = await setup("actions-views");
    const saved = await saveOrderViewAction(store.slug, { title: "Paid VIP", query: "q=vip&pay=paid&after=zzz&bogus=1" });
    expect(saved).toMatchObject({ ok: true });
    const views = await listOrderViews(store.storeId);
    expect(views.map((v) => v.title)).toEqual(["Paid VIP"]);
    expect(views[0].params).toMatchObject({ q: "vip", pay: "paid" });
    expect(JSON.stringify(views[0].params)).not.toContain("zzz");
    expect(JSON.stringify(views[0].params)).not.toContain("bogus");
    expect(await saveOrderViewAction(store.slug, { title: "paid vip", query: "pay=paid" })).toMatchObject({ ok: false });
    expect(await deleteOrderViewAction(store.slug, views[0].id)).toMatchObject({ ok: true });
    expect(await listOrderViews(store.storeId)).toEqual([]);
  });
});
