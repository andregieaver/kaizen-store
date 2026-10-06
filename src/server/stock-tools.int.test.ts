import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const ownerTools = await import("./owner-tools");
const { ledgerIsWhole, addLocation, mainLocation, movementsOf, newStore, pay, place, setLevel, variantId } = await import("./inventory-test-support");
const { approvalSummary } = await import("@/lib/owner-tools");

type Row = Record<string, unknown>;
// The answers are read as the model reads them: loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

/**
 * The AI manager's stock tools (wave 3, D172), run the way the assistant runs them against a real store: `stock_levels` and `stock_history` repeat the
 * Inventory page's own figures, `set_stock` and `set_backorder` are checked before they are kept for a yes and go through the page's own services (one movement
 * with its reason and the account that asked, the editor's rules), and the older readers (`low_stock`, `get_product`, `restock_suggestions`, `store_checkup`)
 * count stock the way the owner's pages do: the active locations only, a negative figure as what is owed.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
let oslo: string;
let bergen: string;

const ctxOf = (s: typeof store, holder?: { role: "owner" | "admin"; permissions?: string[] | null }) => ({ account: s.member.account, store: s.member.store, invalidate: () => {}, ...(holder ? { holder } : {}) });
const run = (name: string, input: unknown = {}, s = store) => ownerTools.runOwnerTool(ctxOf(s), name, input) as Promise<Answer>;
const preflight = (name: string, input: unknown, s = store) => ownerTools.preflightOwnerTool(ctxOf(s), name, input);
const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof ownerTools.OwnerToolError ? error.message : `not a tool refusal: ${String(error)}`;
  }
};
const policyOf = async (s: typeof store, sku: string) => {
  const [row] = await db().execute<Row>(sql`select stock_policy, backorder_days, low_stock_threshold from commerce.product_variants where store_id = ${s.storeId}::uuid and sku = ${sku}`);
  return { policy: String(row.stock_policy), days: row.backorder_days === null ? null : Number(row.backorder_days), threshold: row.low_stock_threshold === null ? null : Number(row.low_stock_threshold) };
};

beforeAll(async () => {
  store = await newStore("stocktools");
  other = await newStore("stocktools-other");
  oslo = await mainLocation(store.storeId);
  // Only this scenario's stock: everything at zero but what a test sets.
  await db().execute(sql`update commerce.inventory_levels set on_hand = 0 where store_id = ${store.storeId}::uuid`);
  bergen = await addLocation(store.storeId, "Bergen lager", 5);
});

afterAll(async () => {
  await closeDb();
});

describe("set_stock, with a store of one location", () => {
  it("sets a figure as before: the same words, and now one movement with its reason, the account and the AI manager as the source", async () => {
    const solo = await newStore("stocktools-solo");
    const answer = await run("set_stock", { sku: "DEMO-MUG-BLACK", quantity: 42 }, solo);
    expect(answer.done).toBe("DEMO-MUG-BLACK now has 42 in stock.");
    expect(answer).toMatchObject({ before: expect.any(Number), after: 42, reason: "Correction" });
    const last = (await movementsOf(solo.storeId, "DEMO-MUG-BLACK")).at(-1)!;
    expect(last).toMatchObject({ after: 42, reason: "correction", source: "ai_manager", actor: solo.accountId });
    expect(await ledgerIsWhole(solo.storeId)).toBe(true);
    expect(await refusal(run("set_stock", { sku: "NO-SUCH-SKU", quantity: 1 }, solo))).toContain("No shipped variant with the SKU NO-SUCH-SKU");
  });
});

describe("set_stock, with two locations", () => {
  it("asks which location, never choosing one, and names none that is not the store's", async () => {
    expect(await refusal(run("set_stock", { sku: "DEMO-LAMP", quantity: 5 }))).toBe("The store keeps stock at 2 locations: say which one (Lager Oslo, Bergen lager).");
    expect(await refusal(run("set_stock", { sku: "DEMO-LAMP", quantity: 5, location: "Tromsø" }))).toContain("The store has no location called Tromsø");
    // Checked before it is kept for a yes, too: the owner is never asked to approve what cannot be done.
    expect(await refusal(preflight("set_stock", { sku: "DEMO-LAMP", quantity: 5 }))).toContain("say which one");
    expect(await refusal(preflight("set_stock", { sku: "NOPE", quantity: 5, location: "Lager Oslo" }))).toContain("No shipped variant");
  });

  it("sets one location's figure with a reason and a note, leaves the other alone, and writes one movement for the account that asked", async () => {
    await setLevel(store.storeId, "DEMO-LAMP", bergen, 3);
    const answer = await run("set_stock", { sku: "DEMO-LAMP", quantity: 12, location: "lager oslo", reason: "received", note: "Delivery from the glassworks" });
    expect(answer).toMatchObject({ done: "DEMO-LAMP now has 12 in stock at Lager Oslo.", location: "Lager Oslo", after: 12, reason: "Received" });
    const moves = (await movementsOf(store.storeId, "DEMO-LAMP")).filter((m) => m.source === "ai_manager");
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ delta: 12, after: 12, reason: "received", actor: store.accountId, note: "Delivery from the glassworks" });
    expect((await movementsOf(store.storeId, "DEMO-LAMP")).filter((m) => m.location === "Bergen lager").at(-1)!.after).toBe(3);
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
  });

  it("matches a location by the start of its name, and counts an inactive one a person names", async () => {
    expect((await run("set_stock", { sku: "DEMO-LAMP", quantity: 4, location: "Berg", reason: "count" })).done).toBe("DEMO-LAMP now has 4 in stock at Bergen lager.");
    expect(await refusal(preflight("set_stock", { sku: "DEMO-LAMP", quantity: 4, location: "Bergen lager" }))).toBe("DEMO-LAMP already has 4 in stock at Bergen lager: nothing to change.");
  });

  it("refuses to be kept for a yes when it would change nothing, and says so when run anyway", async () => {
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 7);
    expect(await refusal(preflight("set_stock", { sku: "DEMO-TOTE", quantity: 7, location: "Lager Oslo" }))).toContain("nothing to change");
    const same = await run("set_stock", { sku: "DEMO-TOTE", quantity: 7, location: "Lager Oslo" });
    expect(same.done).toContain("nothing was changed");
    expect((await movementsOf(store.storeId, "DEMO-TOTE")).filter((m) => m.source === "ai_manager")).toHaveLength(0);
  });

  it("is kept with the words made from its arguments, and never changes a level from the model alone", async () => {
    expect(approvalSummary("set_stock", { sku: "DEMO-LAMP", quantity: 12, location: "Lager Oslo", reason: "received" })).toBe("Set the stock of DEMO-LAMP at Lager Oslo to 12. Reason: Received.");
    // The tool's own kept call is a gated one: nothing runs from the model alone.
    const { OWNER_TOOLS_BY_NAME } = await import("@/lib/owner-tools");
    expect([OWNER_TOOLS_BY_NAME.set_stock.gate, OWNER_TOOLS_BY_NAME.set_backorder.gate]).toEqual(["public", "public"]);
  });

  it("refuses a member whose role has no right to change products, before and after it is kept", async () => {
    const reader = { role: "admin" as const, permissions: ["products:read"] };
    expect(await refusal(ownerTools.runOwnerTool(ctxOf(store, reader), "set_stock", { sku: "DEMO-LAMP", quantity: 1, location: "Lager Oslo" }))).toBe("I can't do that for you: your role has no access to products.");
    expect(await refusal(ownerTools.preflightOwnerTool(ctxOf(store, reader), "set_backorder", { sku: "DEMO-LAMP", policy: "deny" }))).toBe("I can't do that for you: your role has no access to products.");
    expect(await ownerTools.runOwnerTool(ctxOf(store, reader), "stock_levels", {})).toBeTruthy();
  });

  it("never reaches another store's variant", async () => {
    // The other store has the same demo SKUs; this store's tools only ever see their own.
    await setLevel(other.storeId, "DEMO-LAMP", await mainLocation(other.storeId), 99);
    const mine = await run("stock_levels", { search: "DEMO-LAMP" });
    expect(mine.variants.map((v: Answer) => v.sku)).toEqual(["DEMO-LAMP"]);
    expect(mine.variants[0].on_hand).toBe(16);
    const theirs = await run("stock_levels", { search: "DEMO-LAMP" }, other);
    expect(theirs.variants[0].on_hand).toBe(99);
    expect(await refusal(run("stock_history", { sku: "SKU-OF-NO-STORE" }))).toContain("No shipped variant");
  });
});

describe("set_backorder", () => {
  it("turns keep-selling on with the days shoppers are told, through the page's own service, and says what they will read", async () => {
    const answer = await run("set_backorder", { sku: "DEMO-LAMP", policy: "continue", days: 14 });
    expect(answer.done).toBe("DEMO-LAMP now keeps selling when it is sold out, and shoppers are told it is expected to ship within 14 days.");
    expect(await policyOf(store, "DEMO-LAMP")).toEqual({ policy: "continue", days: 14, threshold: null });
    const [entry] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'products.stock_policy_changed' order by id desc limit 1`);
    expect(entry.details).toMatchObject({ variants: 1, change: "continue", days: 14 });
  });

  it("is checked before it is kept: the days are required, and a setting that is the setting already is refused", async () => {
    expect(await refusal(run("set_backorder", { sku: "DEMO-LAMP", policy: "continue" }))).toContain("how many days");
    expect(await refusal(preflight("set_backorder", { sku: "DEMO-LAMP", policy: "continue", days: 14 }))).toBe("DEMO-LAMP is already set that way: nothing to change.");
    expect(await refusal(preflight("set_backorder", { sku: "DEMO-LAMP", policy: "continue", days: 21 }))).toBeNull();
    expect(await refusal(preflight("set_backorder", { sku: "DEMO-LAMP", policy: "deny", days: 5 }))).toContain("belongs only to a variant that keeps selling");
    expect(await refusal(preflight("set_backorder", { sku: "NOPE", policy: "deny" }))).toContain("No shipped variant");
  });

  it("refuses a variant that is not shipped goods, and never touches the stock itself", async () => {
    const [digital] = await db().execute<Row>(sql`select sku from commerce.product_variants where store_id = ${store.storeId}::uuid and delivery <> 'physical' limit 1`);
    expect(await refusal(run("set_backorder", { sku: String(digital.sku), policy: "continue", days: 7 }))).toContain("No shipped variant");
    const before = (await movementsOf(store.storeId, "DEMO-LAMP")).length;
    await run("set_backorder", { sku: "DEMO-LAMP", policy: "continue", days: 30 });
    expect((await movementsOf(store.storeId, "DEMO-LAMP")).length).toBe(before);
  });

  it("turns it off, and says how many units are still owed on orders already paid", async () => {
    await run("set_backorder", { sku: "DEMO-THERMOS", policy: "continue", days: 7 });
    await setLevel(store.storeId, "DEMO-THERMOS", oslo, 0);
    const order = await place(store.storeId, [["DEMO-THERMOS", 3]]);
    await pay(store.storeId, order, store.account);
    const off = await run("set_backorder", { sku: "DEMO-THERMOS", policy: "deny" });
    expect(off.done).toBe("DEMO-THERMOS now stops selling when it is sold out.");
    expect(off.notes).toEqual(["3 units are still owed to customers on orders already paid and not sent: those orders still need the goods."]);
    // And back on for the rest of the file.
    await run("set_backorder", { sku: "DEMO-THERMOS", policy: "continue", days: 7 });
  });
});

describe("stock_levels", () => {
  it("shows what is owed on a variant sold on backorder, with its days, and the page's own counts", async () => {
    const answer = await run("stock_levels", { search: "DEMO-THERMOS" });
    const row = answer.variants.find((v: Answer) => v.sku === "DEMO-THERMOS");
    expect(row).toMatchObject({ on_hand: -3, available: -3, owed_to_customers: 3, when_sold_out: "keeps selling on backorder", delivery_days: 7, on_backorder_now: true });
    expect(answer.counts).toMatchObject({ owed_units: 3, below_zero: 1 });
    expect(answer.notes.join(" ")).toContain("below zero is what the store still has to receive");
    expect(answer.pages.inventory).toBe(`/admin/${store.slug}/inventory`);
  });

  it("filters by status the way the page does, and by one location", async () => {
    expect((await run("stock_levels", { status: "backorder" })).variants.map((v: Answer) => v.sku)).toEqual(["DEMO-THERMOS"]);
    expect((await run("stock_levels", { status: "negative" })).variants.map((v: Answer) => v.sku)).toEqual(["DEMO-THERMOS"]);
    await db().execute(sql`update commerce.product_variants set low_stock_threshold = 20 where store_id = ${store.storeId}::uuid and sku = 'DEMO-LAMP'`);
    const low = await run("stock_levels", { status: "low" });
    expect(low.variants.map((v: Answer) => v.sku)).toContain("DEMO-LAMP");
    expect(low.counts.at_or_below_their_warning_level).toBeGreaterThanOrEqual(1);
    const lamp = (await run("stock_levels", { search: "DEMO-LAMP", location: "Bergen" })).variants[0];
    expect(lamp).toMatchObject({ on_hand: 4 });
    expect(await refusal(run("stock_levels", { location: "Tromsø" }))).toContain("no location called Tromsø");
  });

  it("shows each location's figures when the store has several, and says which are active", async () => {
    const lamp = (await run("stock_levels", { search: "DEMO-LAMP" })).variants[0];
    expect(lamp.on_hand).toBe(16);
    expect(lamp.per_location).toEqual(expect.arrayContaining([expect.objectContaining({ location: "Bergen lager", on_hand: 4, active: true })]));
  });

  it("never counts a deactivated location's stock as the store's", async () => {
    const closed = await addLocation(store.storeId, "Gammelt lager", 9);
    await setLevel(store.storeId, "DEMO-TOTE", closed, 500);
    const owner = store.member;
    const { deactivateLocation } = await import("./inventory-locations");
    const result = await deactivateLocation(owner, closed, 500);
    expect(result.ok).toBe(true);
    const tote = (await run("stock_levels", { search: "DEMO-TOTE" })).variants[0];
    expect(tote.on_hand).toBe(7);
    // The other readers leave it out as well: the tote has 7 where the store sells it, not 507.
    const low = await run("low_stock", { at_most: 10 });
    expect(low.variants.find((v: Answer) => v.sku === "DEMO-TOTE")).toMatchObject({ stock: 7 });
    const [product] = await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-TOTE'`);
    expect((await run("get_product", { product: String(product.product_id) })).variants[0].stock).toBe(7);
  });
});

describe("stock_history", () => {
  it("lists the changes of one variant newest first, with who and why, and the sale of an order", async () => {
    const answer = await run("stock_history", { sku: "DEMO-LAMP" });
    expect(answer.sku).toBe("DEMO-LAMP");
    const changes = answer.changes as Answer[];
    expect(changes[0]).toMatchObject({ location: "Bergen lager", change: 1, new_on_hand: 4, reason: "Count", by: "AI manager" });
    expect(changes.map((c) => c.reason)).toEqual(expect.arrayContaining(["Received", "Count"]));
    const received = changes.find((c) => c.reason === "Received")!;
    expect(received).toMatchObject({ change: 12, new_on_hand: 12, note: "Delivery from the glassworks" });
    const thermos = await run("stock_history", { sku: "DEMO-THERMOS" });
    expect(thermos.changes[0]).toMatchObject({ reason: "Sale", change: -3, new_on_hand: -3 });
    expect(String(thermos.changes[0].by)).toMatch(/^Order /);
  });

  it("filters by reason and by period, and says when nothing changed", async () => {
    const received = await run("stock_history", { sku: "DEMO-LAMP", reason: "received" });
    expect(received.changes.map((c: Answer) => c.reason)).toEqual(["Received"]);
    const none = await run("stock_history", { sku: "DEMO-LAMP", reason: "damaged" });
    expect(none.changes).toEqual([]);
    expect(none.note).toContain("No change of this variant's stock");
    expect((await run("stock_history", { sku: "DEMO-LAMP", days: 1 })).changes.length).toBeGreaterThan(0);
    expect(await refusal(run("stock_history", { sku: "DEMO-LAMP", days: 0 }))).toContain("days");
  });
});

describe("the older readers count stock the way the owner's pages do", () => {
  it("restock_suggestions adds what is owed to what to order, counts a negative figure as nothing in stock, and says how many units are owed", async () => {
    const answer = await run("restock_suggestions", { days: 30, cover_days: 30, lead_days: 7 });
    const thermos = (answer.to_reorder as Answer[]).find((v) => v.sku === "DEMO-THERMOS")!;
    // 3 sold in 30 days is 0.1 a day; 37 days to cover need 4; with 3 owed (on hand -3) 7 are to be ordered, and none is in stock.
    expect(thermos).toMatchObject({ in_stock: 0, owed_to_customers: 3, sold_in_period: 3, suggested_order: 7, order_now: true, lasts_days: 0 });
    expect(answer.owed_units).toBe(3);
    expect(answer.rule).toContain("units owed to customers are added");
  });

  it("low_stock lists a variant sold on backorder with its negative figure and that it keeps selling", async () => {
    const answer = await run("low_stock", { at_most: 3 });
    expect(answer.variants.find((v: Answer) => v.sku === "DEMO-THERMOS")).toMatchObject({ stock: -3, keeps_selling_when_sold_out: true, delivery_days: 7 });
  });

  it("get_product says what a variant does at zero, its days and its own level", async () => {
    const [product] = await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-THERMOS'`);
    const answer = await run("get_product", { product: String(product.product_id) });
    expect(answer.variants[0]).toMatchObject({ sku: "DEMO-THERMOS", stock: -3, when_sold_out: "keeps selling on backorder", delivery_days: 7, warning_level: null });
  });

  it("store_checkup tells the owner about units owed and variants at their own level", async () => {
    const answer = await run("store_checkup");
    const text = (answer.findings as Answer[]).map((f) => f.what).join("\n");
    expect(text).toContain("3 unit(s) are owed to customers on backorder");
    expect(text).toContain("at or below the warning level you set");
  });
});

describe("the history stays whole", () => {
  it("has every level added up by its movements after all of it", async () => {
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
    expect(await variantId(store.storeId, "DEMO-LAMP")).toBeTruthy();
  });
});
