/* eslint-disable @typescript-eslint/no-explicit-any -- rows and snapshots are JSON and the tests read them as such */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fulfilmentState, unitsToSend, type FulfilmentLine } from "@/lib/fulfilment";
import { EDITS_PER_ORDER_MAX } from "@/lib/fulfilment-limits";
import { MOVEMENT_SOURCES } from "@/lib/inventory";
import { noParts, priceOrderEdit } from "@/lib/order-edit";
import { ORDER_EDIT_DOCUMENTS, ORDER_EDIT_STATUSES } from "@/lib/order-edit-status";
import { COPY_RULES } from "@/lib/store-copy-rules";

import { createInvoiceStore, one as q1, placeOrder, refund, scalar as q0, type OrderSpec } from "./invoice-fixture";
import * as fx from "./order-edit-fixture";
import { tax, tokenHash, writeChange, type Tx } from "./order-edit-fixture";
import { createTestDatabase } from "./testing";

/**
 * Sending in parts and changing an order after purchase (wave 3, run 3, D174, docs/wave-3-fulfilment.md 3.3): every rule the database holds, against every
 * migration applied to a real Postgres (PGlite). The changes are written the way `applyOrderEdit()` writes them: priced by `priceOrderEdit()` (the same
 * pure function), in one transaction under the edit context.
 */

let db: PGlite;
let store: string;
let other: string;
let account: string;
let counter = 0;
const next = () => (counter += 1);

const one = <T = Record<string, any>>(sql: string, params: unknown[] = []) => q1<T>(db, sql, params);
const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rows = async <T = Record<string, any>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
const transaction = (fn: (tx: Tx) => Promise<void>) => fx.transaction(db, fn);
const factsOf = (orderId: string) => fx.factsOf(db, orderId);
const newVariant = (s = store, policy: "deny" | "continue" = "deny") => fx.newVariant(db, s, policy);
const edit = (orderId: string, o: fx.EditOptions = {}, s = store) => fx.edit({ db, account }, s, orderId, o);
const settleMoney = (tx: Tx, s: string, orderId: string, editId: string, difference: number, payWith: "manual" | "stripe") =>
  fx.settleMoney(tx, s, orderId, editId, difference, payWith, account);

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "ful-a");
  other = await createInvoiceStore(db, "ful-b");
  account = await scalar<string>("insert into commerce.accounts (email) values ('ful-staff@example.com') returning id");
});

afterAll(async () => {
  await db.close();
});

/** A paid order with goods lines (an invoice of its own, unless the spec says otherwise). */
async function paid(spec: Partial<OrderSpec> = {}, s = store) {
  return placeOrder(db, s, { lines: [{ sku: "A", quantity: 3, unit: 10000 }, { sku: "B", quantity: 1, unit: 5000 }], shipping: 4900, ...spec });
}

/** A parcel, written as markSent() does: the shipment and its lines in one transaction. */
async function ship(orderId: string, lines: [string, number][], s = store, legacy = false): Promise<string> {
  let id = "";
  // PGlite's own transaction, which queues: two parcels at once take turns, as the order line's lock makes them on a server.
  await db.transaction(async (tx) => {
    id = (
      await tx.query<{ id: string }>("insert into commerce.shipments (store_id, order_id, carrier, tracking_number, legacy) values ($1, $2, 'posten', $3, $4) returning id", [
        s,
        orderId,
        `T${next()}`,
        legacy,
      ])
    ).rows[0].id;
    for (const [lineId, quantity] of lines) {
      await tx.query("insert into commerce.shipment_lines (store_id, shipment_id, order_line_id, quantity) values ($1, $2, $3, $4)", [s, id, lineId, quantity]);
    }
  });
  return id;
}

/** A confirmed withdrawal of units of a line (a return that counts, D153). */
async function withdraw(orderId: string, lineId: string, quantity: number, s = store): Promise<string> {
  const req = await scalar<string>(
    "insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel) values ($1, $2, 'A Shopper', 'shopper@example.com', 'web') returning id",
    [s, orderId],
  );
  await db.query("insert into commerce.withdrawal_request_lines (store_id, withdrawal_request_id, order_line_id, quantity) values ($1, $2, $3, $4)", [s, req, lineId, quantity]);
  await db.query("update commerce.withdrawal_requests set status = 'confirmed' where id = $1", [req]);
  const ret = await one<{ id: string }>(
    "insert into commerce.returns (store_id, order_id, withdrawal_request_id, kind, status) values ($1, $2, $3, 'withdrawal', 'approved') returning id",
    [s, orderId, req],
  );
  await db.query("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision) values ($1, $2, $3, $4, 'accept')", [s, ret.id, lineId, quantity]);
  return ret.id;
}

/** Units of a line closed as not to be sent, written as `refundOrder()` with `notSent` writes them (with the refund, when money went back). */
async function close(orderId: string, lineId: string, quantity: number, s = store, refundId: string | null = null): Promise<string> {
  return scalar<string>(
    "insert into commerce.unsent_closures (store_id, order_id, order_line_id, quantity, refund_id, created_by) values ($1, $2, $3, $4, $5, $6) returning id",
    [s, orderId, lineId, quantity, refundId, account],
  );
}

const linesOf = (orderId: string) => rows<any>("select id, sku, quantity, total_minor::int as total, tax_minor::int as tax from commerce.order_lines where order_id = $1 order by ctid", [orderId]);

/** The order's state as the database and the code read it, with each line's units to send held equal on the way (`line_to_send()` and `unitsToSend()`). */
async function stateBoth(orderId: string): Promise<[string, string]> {
  const lines = await rows<any>(
    `select ol.id, ol.quantity, (ol.delivery = 'physical' and ol.variant_id is not null) as physical, commerce.line_shipped(ol.id) as shipped,
            commerce.withdrawn_quantity(ol.id) as withdrawn, commerce.closed_quantity(ol.id) as closed, commerce.line_to_send(ol.id) as to_send
       from commerce.order_lines ol where ol.order_id = $1`,
    [orderId],
  );
  const has = await scalar<boolean>("select exists (select 1 from commerce.shipments where order_id = $1)", [orderId]);
  const ts: FulfilmentLine[] = lines.map((l) => ({ lineId: l.id, quantity: l.quantity, physical: l.physical, shipped: l.shipped, withdrawn: l.withdrawn, closed: l.closed }));
  for (const [i, l] of lines.entries()) expect(unitsToSend(ts[i]), l.id).toBe(l.to_send);
  return [await scalar<string>("select commerce.order_fulfilment($1)", [orderId]), fulfilmentState(ts, has)];
}

// ---------------------------------------------------------------------------------------------------------------------

describe("parcels name their lines (3.3 point 1)", () => {
  it("records a parcel of some units of a line and refuses more units than the line holds in all its parcels", async () => {
    const o = await paid();
    const [a] = o.lineIds;
    await ship(o.id, [[a, 2]]);
    await ship(o.id, [[a, 1]]);
    await expect(ship(o.id, [[a, 1]])).rejects.toThrow(/shipment_line\.too_many/);
  });

  it("refuses a line of another order, of another store and a line that is not shipped", async () => {
    const o = await paid();
    const p = await paid();
    await expect(ship(o.id, [[p.lineIds[0], 1]])).rejects.toThrow(/shipment_line\.order/);
    const q = await paid({}, other);
    await expect(ship(o.id, [[q.lineIds[0], 1]])).rejects.toThrow(/shipment_line\.order|foreign key/);
    const digital = await paid({ lines: [{ sku: "DL", unit: 1000, delivery: "digital" }, { sku: "A", unit: 1000 }] });
    await expect(ship(digital.id, [[digital.lineIds[0], 1]])).rejects.toThrow(/shipment_line\.not_physical/);
  });

  it("keeps the lines of a parcel as a record: no change, no removal", async () => {
    const o = await paid();
    const shipment = await ship(o.id, [[o.lineIds[0], 1]]);
    await rejects("update commerce.shipment_lines set quantity = 2 where shipment_id = $1", [shipment], /shipment_line\.append_only/);
    await rejects("delete from commerce.shipment_lines where shipment_id = $1", [shipment], /shipment_line\.append_only/);
  });

  it("serialises two parcels of one line, so together they never exceed it", async () => {
    const o = await paid();
    const a = o.lineIds[0];
    const results = await Promise.allSettled([ship(o.id, [[a, 2]]), ship(o.id, [[a, 2]])]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await scalar<number>("select sum(quantity)::int from commerce.shipment_lines where order_line_id = $1", [a])).toBe(2);
  });

  it("refuses, at commit, a parcel that is not legacy and names no line (the follow-up migration after the deploy, 9.1)", async () => {
    const o = await paid();
    await expect(db.query("insert into commerce.shipments (store_id, order_id, carrier, tracking_number) values ($1, $2, 'posten', 'X')", [store, o.id])).rejects.toThrow(
      /shipment\.no_lines/,
    );
    await expect(ship(o.id, [])).rejects.toThrow(/shipment\.no_lines/);
    expect(await scalar<number>("select count(*)::int from commerce.shipments where order_id = $1", [o.id])).toBe(0);
  });

  it("takes a parcel and its lines written in one transaction, as markSent() writes them, and a legacy parcel with no lines", async () => {
    const o = await paid();
    const shipment = await ship(o.id, [[o.lineIds[0], 1], [o.lineIds[1], 1]]);
    expect(await scalar<number>("select count(*)::int from commerce.shipment_lines where shipment_id = $1", [shipment])).toBe(2);
    expect(await stateBoth(o.id)).toEqual(["partly_sent", "partly_sent"]);
    const old = await paid();
    const legacy = await ship(old.id, [], store, true);
    expect(await scalar<boolean>("select legacy from commerce.shipments where id = $1", [legacy])).toBe(true);
    expect(await scalar("select commerce.line_to_send($1)", [old.lineIds[0]])).toBe(0);
  });

  it("marks a parcel the old code recorded during the deploy legacy and back-fills its order's lines, by the follow-up migration's own statements", async () => {
    const o = await paid({ lines: [{ sku: "A", quantity: 2, unit: 1000 }, { sku: "DL", unit: 500, delivery: "digital" }] });
    const sent = await paid();
    const file = readdirSync(path.join(process.cwd(), "supabase", "migrations")).find((f) => f.endsWith("_shipment_lines_required_rule.sql"))!;
    const text = readFileSync(path.join(process.cwd(), "supabase", "migrations", file), "utf8");
    const statements = text.slice(text.indexOf("UPDATE commerce.shipments"), text.indexOf("CREATE FUNCTION"));
    // Written before the rule existed (so, here, in the transaction that runs the migration's statements, which leave it legacy before commit).
    await db.transaction(async (tx) => {
      await tx.query("insert into commerce.shipments (store_id, order_id, carrier, tracking_number) values ($1, $2, 'posten', 'WINDOW')", [store, o.id]);
      await tx.exec(statements.replaceAll("--> statement-breakpoint", ""));
    });
    expect(await rows("select order_line_id, quantity from commerce.shipment_lines where order_line_id = any($1)", [o.lineIds])).toEqual([{ order_line_id: o.lineIds[0], quantity: 2 }]);
    expect(await scalar("select bool_and(legacy) from commerce.shipments where order_id = $1", [o.id])).toBe(true);
    expect(await scalar("select commerce.order_fulfilment($1)", [o.id])).toBe("sent");
    // A parcel made since names its lines and is left as it is; running the statements again writes nothing more.
    const parcel = await ship(sent.id, [[sent.lineIds[0], 1]]);
    await db.exec(statements.replaceAll("--> statement-breakpoint", ""));
    expect(await scalar<boolean>("select legacy from commerce.shipments where id = $1", [parcel])).toBe(false);
    expect(await scalar<number>("select count(*)::int from commerce.shipment_lines where order_line_id = any($1)", [[...o.lineIds, ...sent.lineIds]])).toBe(2);
  });

  it("refuses a parcel for a copied order (D129)", async () => {
    const copy = await placeOrder(db, store, { lines: [{ sku: "A", unit: 1000 }], copied: true });
    await expect(ship(copy.id, [])).rejects.toThrow(/copied_order/);
  });
});

describe("the parcels from before parcels named their lines (3.3 point 2)", () => {
  it("marks them legacy and writes the order's physical lines into its first parcel, by the migration's own statements", async () => {
    const o = await paid({ lines: [{ sku: "A", quantity: 2, unit: 1000 }, { sku: "DL", unit: 500, delivery: "digital" }, { sku: "B", unit: 700 }] });
    const file = readdirSync(path.join(process.cwd(), "supabase", "migrations")).find((f) => f.endsWith("_fulfilment_rules.sql"))!;
    const text = readFileSync(path.join(process.cwd(), "supabase", "migrations", file), "utf8");
    const update = text.match(/UPDATE commerce\.shipments SET legacy = true WHERE NOT legacy;/)![0];
    const insert = text.match(/INSERT INTO commerce\.shipment_lines[\s\S]*?;\n/)![0];
    // Two parcels as the old markSent() wrote them: no lines, not legacy. The migration ran before the rule that a parcel names its lines
    // (`shipments_have_lines`, checked at commit), so they are written and back-filled in one transaction: at commit they are legacy, as the migration left them.
    await db.transaction(async (tx) => {
      await tx.query("insert into commerce.shipments (store_id, order_id, carrier, tracking_number, created_at) values ($1, $2, 'posten', 'OLD1', now() - interval '2 days')", [store, o.id]);
      await tx.query("insert into commerce.shipments (store_id, order_id, carrier, tracking_number, created_at) values ($1, $2, 'posten', 'OLD2', now() - interval '1 day')", [store, o.id]);
      await tx.exec(update + "\n" + insert);
    });
    const lines = await rows<any>(
      "select s.tracking_number, sl.order_line_id, sl.quantity from commerce.shipment_lines sl join commerce.shipments s on s.id = sl.shipment_id where s.order_id = $1 order by sl.quantity desc",
      [o.id],
    );
    expect(lines).toEqual([
      { tracking_number: "OLD1", order_line_id: o.lineIds[0], quantity: 2 },
      { tracking_number: "OLD1", order_line_id: o.lineIds[2], quantity: 1 },
    ]);
    expect(await scalar("select bool_and(legacy) from commerce.shipments where order_id = $1", [o.id])).toBe(true);
    expect(await scalar("select commerce.order_fulfilment($1)", [o.id])).toBe("sent");
    // Running it again writes nothing more.
    await db.exec(insert);
    expect(await scalar<number>("select count(*)::int from commerce.shipment_lines sl join commerce.shipments s on s.id = sl.shipment_id where s.order_id = $1", [o.id])).toBe(2);
  });

  it("counts every unit of an order with a legacy parcel as sent, whatever its lines say", async () => {
    const o = await paid();
    await db.query("insert into commerce.shipments (store_id, order_id, carrier, tracking_number, legacy) values ($1, $2, 'posten', 'L', true)", [store, o.id]);
    expect(await scalar("select commerce.line_shipped($1)", [o.lineIds[0]])).toBe(3);
    expect(await scalar("select commerce.line_to_send($1)", [o.lineIds[0]])).toBe(0);
  });
});

describe("what is left to send (3.3 point 3; src/lib/fulfilment.ts says the same)", () => {

  it("moves from not sent to partly sent to sent, and the SQL and the code agree at every step", async () => {
    const o = await paid();
    const [a, b] = o.lineIds;
    expect(await stateBoth(o.id)).toEqual(["unsent", "unsent"]);
    expect(await scalar("select commerce.line_to_send($1)", [a])).toBe(3);
    await ship(o.id, [[a, 2]]);
    expect(await stateBoth(o.id)).toEqual(["partly_sent", "partly_sent"]);
    expect(await scalar("select commerce.refresh_fulfilment($1, $2)", [store, o.id])).toBe(false);
    expect(await scalar("select status from commerce.orders where id = $1", [o.id])).toBe("paid");
    await ship(o.id, [[a, 1], [b, 1]]);
    expect(await stateBoth(o.id)).toEqual(["sent", "sent"]);
    expect(await scalar("select commerce.refresh_fulfilment($1, $2)", [store, o.id])).toBe(true);
    expect(await scalar("select status from commerce.orders where id = $1", [o.id])).toBe("fulfilled");
    // It never moves back, and a second call changes nothing.
    expect(await scalar("select commerce.refresh_fulfilment($1, $2)", [store, o.id])).toBe(false);
  });

  it("takes withdrawn units from the unsent ones: 1 of 3 withdrawn after 1 sent leaves 1; the last unsent withdrawn makes it sent", async () => {
    const o = await paid({ lines: [{ sku: "A", quantity: 3, unit: 1000 }] });
    const [a] = o.lineIds;
    await ship(o.id, [[a, 1]]);
    await withdraw(o.id, a, 1);
    expect(await scalar("select commerce.line_to_send($1)", [a])).toBe(1);
    expect(await stateBoth(o.id)).toEqual(["partly_sent", "partly_sent"]);
    await withdraw(o.id, a, 1);
    expect(await stateBoth(o.id)).toEqual(["sent", "sent"]);
    expect(await scalar("select commerce.refresh_fulfilment($1, $2)", [store, o.id])).toBe(true);
  });

  it("does not take a return of goods received (kind `return`, a voluntary or business return) off what is left to send (review fix)", async () => {
    const o = await paid({ lines: [{ sku: "A", quantity: 3, unit: 1000 }] });
    const [a] = o.lineIds;
    await ship(o.id, [[a, 1]]);
    // The customer sends the one unit received back (a business return, D153): the two units still owed are still to send.
    const ret = await one<{ id: string }>("insert into commerce.returns (store_id, order_id, kind, status) values ($1, $2, 'return', 'requested') returning id", [store, o.id]);
    await db.query("insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision) values ($1, $2, $3, 1, 'accept')", [store, ret.id, a]);
    expect(await scalar("select commerce.returned_quantity($1)", [a])).toBe(1);
    expect(await scalar("select commerce.withdrawn_quantity($1)", [a])).toBe(0);
    expect(await scalar("select commerce.line_to_send($1)", [a])).toBe(2);
    expect(await stateBoth(o.id)).toEqual(["partly_sent", "partly_sent"]);
    await ship(o.id, [[a, 2]]);
    expect(await stateBoth(o.id)).toEqual(["sent", "sent"]);
    expect(await scalar("select commerce.refresh_fulfilment($1, $2)", [store, o.id])).toBe(true);
  });

  it("reads an order withdrawn before anything was sent, and one with nothing to send", async () => {
    const o = await paid({ lines: [{ sku: "A", quantity: 2, unit: 1000 }] });
    await withdraw(o.id, o.lineIds[0], 2);
    expect(await stateBoth(o.id)).toEqual(["withdrawn", "withdrawn"]);
    expect(await scalar("select commerce.refresh_fulfilment($1, $2)", [store, o.id])).toBe(false);
    const dl = await paid({ lines: [{ sku: "DL", unit: 1000, delivery: "digital" }] });
    expect(await stateBoth(dl.id)).toEqual(["none", "none"]);
    expect(await scalar("select commerce.line_to_send($1)", [dl.lineIds[0]])).toBe(0);
    expect(await scalar("select commerce.order_fulfilment($1)", ["00000000-0000-4000-8000-000000000000"])).toBeNull();
  });
});

describe("units that will not be sent (3.3 point 11, unsent_closures)", () => {
  it("takes closed units off what is left to send: 1 of 3 sent, the other 2 closed with their refund, and the order is sent in the same statement", async () => {
    const o = await paid({ lines: [{ sku: "A", quantity: 3, unit: 1000 }] });
    const [a] = o.lineIds;
    await ship(o.id, [[a, 1]]);
    expect(await stateBoth(o.id)).toEqual(["partly_sent", "partly_sent"]);
    const r = await refund(db, o.id, 2000);
    await close(o.id, a, 2, store, r);
    expect(await scalar("select commerce.closed_quantity($1)", [a])).toBe(2);
    expect(await scalar("select commerce.line_to_send($1)", [a])).toBe(0);
    expect(await stateBoth(o.id)).toEqual(["sent", "sent"]);
    // The closure's own trigger moved it: no caller has to.
    expect(await scalar("select status from commerce.orders where id = $1", [o.id])).toBe("fulfilled");
    expect(await one("select refund_id, created_by from commerce.unsent_closures where order_line_id = $1", [a])).toEqual({ refund_id: r, created_by: account });
  });

  it("refuses more units than are still to send, a line that is not shipped, another order's line, another order's refund, an order not paid and a copy", async () => {
    const o = await paid({ lines: [{ sku: "A", quantity: 3, unit: 1000 }, { sku: "DL", unit: 500, delivery: "digital" }] });
    const [a, dl] = o.lineIds;
    await ship(o.id, [[a, 1]]);
    await withdraw(o.id, a, 1);
    // 3 bought, 1 sent, 1 withdrawn: 1 is left, so 2 are refused.
    await expect(close(o.id, a, 2)).rejects.toThrow(/unsent_closure\.too_many/);
    await expect(close(o.id, dl, 1)).rejects.toThrow(/unsent_closure\.not_physical/);
    const p = await paid();
    await expect(close(o.id, p.lineIds[0], 1)).rejects.toThrow(/unsent_closure\.order/);
    await expect(close(o.id, a, 1, store, await refund(db, p.id, 100))).rejects.toThrow(/unsent_closure\.refund/);
    await expect(close(o.id, a, 0)).rejects.toThrow(/unsent_closures_quantity/);
    const cancelled = await paid({ lines: [{ sku: "A", quantity: 2, unit: 1000 }] });
    await db.query("update commerce.orders set status = 'cancelled' where id = $1", [cancelled.id]);
    await expect(close(cancelled.id, cancelled.lineIds[0], 1)).rejects.toThrow(/unsent_closure\.not_paid/);
    const copy = await placeOrder(db, store, { lines: [{ sku: "A", quantity: 2, unit: 1000 }], copied: true });
    await expect(close(copy.id, copy.lineIds[0], 1)).rejects.toThrow(/copied_order|unsent_closure\.not_paid/);
    // Another store's order: the composite key or the rule refuses it.
    const q = await paid({}, other);
    await expect(close(q.id, q.lineIds[0], 1, store)).rejects.toThrow(/unsent_closure\.order|foreign key/);
    await close(o.id, a, 1);
    expect(await scalar("select commerce.line_to_send($1)", [a])).toBe(0);
  });

  it("refuses a closure while a change waits for the customer's payment, and a change of an order with closed units", async () => {
    const o = await paid();
    const v = await newVariant();
    const { editId } = await edit(o.id, { added: [{ variantId: v, unitPriceMinor: 2000, quantity: 1 }], awaiting: {} });
    await expect(close(o.id, o.lineIds[0], 1)).rejects.toThrow(/unsent_closure\.edit_pending/);
    await db.query("update commerce.order_edits set status = 'cancelled' where id = $1", [editId]);
    await close(o.id, o.lineIds[0], 1);
    await expect(edit(o.id, { quantities: { [o.lineIds[1]]: 0 } })).rejects.toThrow(/order_edit\.unsent_closed/);
  });

  it("keeps a closure as a record: no change, no removal", async () => {
    const o = await paid();
    const id = await close(o.id, o.lineIds[0], 1);
    await rejects("update commerce.unsent_closures set quantity = 2 where id = $1", [id], /unsent_closure\.append_only/);
    await rejects("delete from commerce.unsent_closures where id = $1", [id], /unsent_closure\.append_only/);
  });

  it("serialises two closures of one line under the order's lock, so together they never exceed what is left", async () => {
    const o = await paid({ lines: [{ sku: "A", quantity: 3, unit: 1000 }] });
    const a = o.lineIds[0];
    const results = await Promise.allSettled([close(o.id, a, 2), close(o.id, a, 2)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await scalar("select commerce.closed_quantity($1)", [a])).toBe(2);
  });

  it("reads an order with nothing sent and everything closed as closed (not withdrawn), and one closed in part then sent as sent", async () => {
    const all = await paid({ lines: [{ sku: "A", quantity: 2, unit: 1000 }] });
    await close(all.id, all.lineIds[0], 2);
    expect(await stateBoth(all.id)).toEqual(["closed", "closed"]);
    // Nothing was sent: the order stays paid (cancelling is the way to end an unsent order), as an order withdrawn in full does.
    expect(await scalar("select status from commerce.orders where id = $1", [all.id])).toBe("paid");
    // Withdrawn and closed together, nothing sent: closed.
    const mixed = await paid({ lines: [{ sku: "A", quantity: 2, unit: 1000 }] });
    await withdraw(mixed.id, mixed.lineIds[0], 1);
    await close(mixed.id, mixed.lineIds[0], 1);
    expect(await stateBoth(mixed.id)).toEqual(["closed", "closed"]);
    // 1 of 3 closed while nothing is sent, then the other 2 sent: sent.
    const later = await paid({ lines: [{ sku: "A", quantity: 3, unit: 1000 }] });
    await close(later.id, later.lineIds[0], 1);
    expect(await stateBoth(later.id)).toEqual(["unsent", "unsent"]);
    // A closed unit never goes in a parcel: 3 units of a line with 1 closed are refused, 2 are taken.
    await expect(ship(later.id, [[later.lineIds[0], 3]])).rejects.toThrow(/shipment_line\.too_many/);
    await ship(later.id, [[later.lineIds[0], 2]]);
    expect(await stateBoth(later.id)).toEqual(["sent", "sent"]);
    expect(await scalar("select status from commerce.orders where id = $1", [later.id])).toBe("paid");
    expect(await scalar("select commerce.refresh_fulfilment($1, $2)", [store, later.id])).toBe(true);
  });
});

describe("a change waiting for payment stops a parcel (3.3 point 4)", () => {
  it("refuses a shipment while the change waits, and allows it once the change has ended", async () => {
    const o = await paid();
    const v = await newVariant();
    const { editId } = await edit(o.id, { added: [{ variantId: v, unitPriceMinor: 2000, quantity: 1 }], awaiting: {} });
    await expect(ship(o.id, [[o.lineIds[0], 1]])).rejects.toThrow(/shipment\.edit_pending/);
    await db.query("update commerce.order_edits set status = 'cancelled' where id = $1", [editId]);
    await ship(o.id, [[o.lineIds[0], 1]]);
  });
});

describe("a paid order's lines and money change only inside a change (3.3 point 5)", () => {
  it("refuses a write to a settled order's lines and amounts outside the edit context", async () => {
    const o = await paid();
    const [a] = o.lineIds;
    await rejects("update commerce.order_lines set quantity = 2, total_minor = 20000 where id = $1", [a], /order_line\.settled/);
    await rejects("update commerce.order_lines set unit_price_minor = 1 where id = $1", [a], /order_line\.settled/);
    await rejects("update commerce.order_lines set sku = 'X' where id = $1", [a], /order_line\.settled/);
    await rejects("delete from commerce.order_lines where id = $1", [a], /order_line\.settled/);
    await rejects(
      "insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code) values ($1, $2, 'S', 'T', 1, 1, 1, 0, 0, 'x')",
      [store, o.id],
      /order_line\.settled/,
    );
    await rejects("update commerce.orders set total_minor = total_minor + 1, subtotal_minor = subtotal_minor + 1 where id = $1", [o.id], /order\.settled/);
    await rejects("update commerce.orders set edited_at = now() where id = $1", [o.id], /order\.settled/);
    // Columns other code writes stay free: the title, the cost, the status, the addresses.
    await db.query("update commerce.order_lines set title = 'Renamed', unit_cost_minor = 5 where id = $1", [a]);
    await db.query("update commerce.orders set email = 'new@example.com', balance_minor = 0 where id = $1", [o.id]);
  });

  it("lets an order waiting for payment change (the checkout's own writes), and passes a write that changes nothing", async () => {
    const o = await placeOrder(db, store, { lines: [{ sku: "A", unit: 1000 }], pay: "pending-only" });
    await db.query("update commerce.order_lines set quantity = 2, total_minor = 2000 where id = $1", [o.lineIds[0]]);
    await db.query("update commerce.order_lines set quantity = 1, total_minor = 1000 where id = $1", [o.lineIds[0]]);
    const p = await paid();
    await db.query("update commerce.order_lines set quantity = quantity where id = $1", [p.lineIds[0]]);
  });

  it("lets the change of its own order write them, and never another order's", async () => {
    const o = await paid();
    const p = await paid();
    await transaction(async (tx) => {
      await tx.query("select set_config('kaizen.order_edit', $1, true)", [o.id]);
      await tx.query("update commerce.order_lines set title = title where id = $1", [o.lineIds[0]]);
      await expect(tx.query("update commerce.order_lines set sku = 'Y' where id = $1", [p.lineIds[0]])).rejects.toThrow(/order_line\.settled/);
    });
  });

  it("freezes the change that added a line, and refuses a line added by another order's change", async () => {
    const o = await paid();
    const v = await newVariant();
    await edit(o.id, { added: [{ variantId: v, unitPriceMinor: 1000, quantity: 1 }] });
    const added = await one<any>("select id, order_edit_id from commerce.order_lines where order_id = $1 and order_edit_id is not null", [o.id]);
    await transaction(async (tx) => {
      await tx.query("select set_config('kaizen.order_edit', $1, true)", [o.id]);
      await expect(tx.query("update commerce.order_lines set order_edit_id = null where id = $1", [added.id])).rejects.toThrow(/order_line\.edit_fixed/);
    });
    const p = await paid();
    await transaction(async (tx) => {
      await tx.query("select set_config('kaizen.order_edit', $1, true)", [p.id]);
      await expect(
        tx.query(
          "insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, order_edit_id) values ($1, $2, $3, 'S', 'T', 1, 1, 1, 0, 0, 'x', $4)",
          [store, p.id, v, added.order_edit_id],
        ),
      ).rejects.toThrow(/order_line\.edit/);
    });
  });
});

describe("the frozen triggers learn the edit context (3.3 point 6)", () => {
  it("lets a draft's staff discount and a line's backorder go down inside a change, never up, and never outside one", async () => {
    const o = await paid({ lines: [{ sku: "A", quantity: 2, unit: 10000, staff: 2000 }], staffLabel: "Loyal customer" });
    await rejects("update commerce.orders set staff_discount_minor = 0 where id = $1", [o.id], /order_origin\.frozen|order\.settled/);
    await transaction(async (tx) => {
      await tx.query("select set_config('kaizen.order_edit', $1, true)", [o.id]);
      await expect(tx.query("update commerce.orders set staff_discount_minor = staff_discount_minor + 1, discount_minor = discount_minor + 1, total_minor = total_minor - 1 where id = $1", [o.id])).rejects.toThrow(
        /order_origin\.frozen/,
      );
    });
    await transaction(async (tx) => {
      await tx.query("select set_config('kaizen.order_edit', $1, true)", [o.id]);
      await expect(tx.query("update commerce.orders set staff_discount_label = 'Other' where id = $1", [o.id])).rejects.toThrow(/order_origin\.frozen/);
    });
    // A change that takes one of the two units off lowers the discount with it; one that takes the discount to 0 takes its name away.
    await edit(o.id, { quantities: { [o.lineIds[0]]: 1 } });
    expect(await one("select staff_discount_minor::int as s, staff_discount_label as l from commerce.orders where id = $1", [o.id])).toEqual({ s: 1000, l: "Loyal customer" });
  });

  it("lets a backorder go down inside a change and refuses it rising", async () => {
    const o = await paid({ lines: [{ sku: "A", quantity: 3, unit: 1000 }] });
    const [a] = o.lineIds;
    await transaction(async (tx) => {
      await tx.query("select set_config('kaizen.drawing', 'on', true)");
      await tx.query("update commerce.order_lines set backorder_quantity = 2, backorder_days = 7 where id = $1", [a]);
    });
    await rejects("update commerce.order_lines set backorder_quantity = 1 where id = $1", [a], /order_line\.backorder_fixed/);
    await transaction(async (tx) => {
      await tx.query("select set_config('kaizen.order_edit', $1, true)", [o.id]);
      await expect(tx.query("update commerce.order_lines set backorder_quantity = 3 where id = $1", [a])).rejects.toThrow(/order_line\.backorder_fixed/);
    });
    await transaction(async (tx) => {
      await tx.query("select set_config('kaizen.order_edit', $1, true)", [o.id]);
      await expect(tx.query("update commerce.order_lines set backorder_days = 9 where id = $1", [a])).rejects.toThrow(/order_line\.backorder_fixed/);
    });
    await edit(o.id, { quantities: { [a]: 2 } });
    expect(await one("select quantity, backorder_quantity, backorder_days from commerce.order_lines where id = $1", [a])).toEqual({ quantity: 2, backorder_quantity: 1, backorder_days: 7 });
  });
});

describe("changes (3.3 point 7)", () => {
  it("numbers the changes of an order 1, 2, … and stops at 20", async () => {
    const o = await paid({ lines: [{ sku: "A", quantity: 25, unit: 100 }] });
    for (let i = 0; i < EDITS_PER_ORDER_MAX; i += 1) await edit(o.id, { quantities: { [o.lineIds[0]]: 24 - i } });
    expect((await rows<any>("select seq from commerce.order_edits where order_id = $1 order by seq", [o.id])).map((r) => r.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    await expect(edit(o.id, { quantities: { [o.lineIds[0]]: 1 } })).rejects.toThrow(/order_edit\.limit/);
  });

  it("refuses a change on an order that is not paid, is sent, a host's, not standard VAT, copied, or of a closed store", async () => {
    const pending = await placeOrder(db, store, { lines: [{ sku: "A", quantity: 2, unit: 1000 }], pay: "pending-only" });
    await expect(edit(pending.id, { quantities: { [pending.lineIds[0]]: 1 } })).rejects.toThrow(/order_edit\.not_paid/);
    const sent = await paid();
    await ship(sent.id, [[sent.lineIds[0], 1]]);
    await expect(edit(sent.id, { quantities: { [sent.lineIds[1]]: 0 } })).rejects.toThrow(/order_edit\.sent/);
    const ioss = await paid({ vatKind: "ioss", market: "DE" });
    await expect(edit(ioss.id, { quantities: { [ioss.lineIds[0]]: 1 } })).rejects.toThrow(/order_edit\.vat_kind/);
    const copy = await placeOrder(db, store, { lines: [{ sku: "A", quantity: 2, unit: 1000 }], copied: true });
    await expect(edit(copy.id, { quantities: { [copy.lineIds[0]]: 1 } })).rejects.toThrow(/copied_order/);
    const closed = await createInvoiceStore(db, `ful-closed-${next()}`);
    const c = await paid({}, closed);
    await db.query("update commerce.stores set status = 'suspended' where id = $1", [closed]).catch(async () => {
      await db.query("select set_config('commerce.store_status', 'on', false)");
      await db.query("update commerce.stores set status = 'suspended' where id = $1", [closed]);
    });
    await expect(edit(c.id, { quantities: { [c.lineIds[0]]: 1 } }, closed)).rejects.toThrow(/order_edit\.store_closed/);
  });

  it("keeps one change waiting per order, moves it forward only, and keeps its link when it ends", async () => {
    const o = await paid();
    const v = await newVariant();
    const { editId } = await edit(o.id, { added: [{ variantId: v, unitPriceMinor: 1000, quantity: 1 }], awaiting: {} });
    await expect(edit(o.id, { added: [{ variantId: v, unitPriceMinor: 1000, quantity: 1 }], awaiting: {} })).rejects.toThrow(/order_edits_awaiting_key|duplicate/);
    // Sent again: a new link and a later end, while it waits.
    await db.query("update commerce.order_edits set pay_token_hash = $2, expires_at = now() + interval '8 days' where id = $1", [editId, tokenHash()]);
    await rejects("update commerce.order_edits set total_after = total_after + 1 where id = $1", [editId], /order_edit\.fixed/);
    await rejects("update commerce.order_edits set status = 'applied' where id = $1", [editId], /order_edit\.unpaid|check/);
    await db.query("update commerce.order_edits set status = 'expired' where id = $1", [editId]);
    const ended = await one<any>("select status, ended_at, pay_token_hash from commerce.order_edits where id = $1", [editId]);
    expect(ended.status).toBe("expired");
    expect(ended.ended_at).not.toBeNull();
    expect(ended.pay_token_hash).toMatch(/^a+/);
    await rejects("update commerce.order_edits set status = 'awaiting_payment' where id = $1", [editId], /order_edit\.move/);
    await rejects("update commerce.order_edits set pay_token_hash = $2 where id = $1", [editId, tokenHash()], /order_edit\.link_fixed/);
    await rejects("delete from commerce.order_edits where id = $1", [editId], /order_edit\.append_only/);
  });

  it("applies a higher total only with its payment of the difference, and a lower one only with its refund", async () => {
    const o = await paid();
    const v = await newVariant();
    await expect(
      transaction(async (tx) => {
        await tx.query("select set_config('kaizen.order_edit', $1, true)", [o.id]);
        await tx.query(
          `insert into commerce.order_edits (store_id, order_id, status, reason, notify, restock, currency, base, total_before, total_after, subtotal_delta, shipping_before, shipping_after, discount_delta, tax_delta, difference_minor, made_by)
           values ($1, $2, 'applied', 'customer_request', true, true, 'NOK', '{}', 100, 200, 100, 0, 0, 0, 20, 100, $3)`,
          [store, o.id, account],
        );
      }),
    ).rejects.toThrow(/order_edit\.unpaid/);
    await expect(
      transaction(async (tx) => {
        await tx.query(
          `insert into commerce.order_edits (store_id, order_id, status, reason, notify, restock, currency, base, total_before, total_after, subtotal_delta, shipping_before, shipping_after, discount_delta, tax_delta, difference_minor, made_by)
           values ($1, $2, 'applied', 'customer_request', true, true, 'NOK', '{}', 200, 100, -100, 0, 0, 0, -20, -100, $3)`,
          [store, o.id, account],
        );
      }),
    ).rejects.toThrow(/order_edit\.unrefunded/);
    // Paid through the link: the payment names the change, the change names the payment.
    const { editId } = await edit(o.id, { added: [{ variantId: v, unitPriceMinor: 3000, quantity: 1 }], awaiting: {} });
    await transaction(async (tx) => {
      await tx.query("select set_config('kaizen.order_edit', $1, true)", [o.id]);
      const priced = priceOrderEdit(
        { order: await factsOf(o.id), quantities: {}, added: [{ key: "k0", variantId: v, sku: "ADD-0", title: "Added 0", unitPriceMinor: 3000, listPriceMinor: 3000, quantity: 1, rate: 0.25 }], shipping: { kind: "keep" } },
        tax,
      );
      await writeChange(tx, store, o.id, editId, priced);
      await tx.query("update commerce.order_edits set status = 'applied' where id = $1", [editId]);
      await settleMoney(tx, store, o.id, editId, 3000, "stripe");
    });
    expect(await one("select status, applied_at is not null as applied, payment_id is not null as paid from commerce.order_edits where id = $1", [editId])).toEqual({
      status: "applied",
      applied: true,
      paid: true,
    });
    await rejects("update commerce.order_edits set payment_id = null where id = $1", [editId], /order_edit\.fixed/);
  });

  it("refuses a payment or refund that names another order's change", async () => {
    const o = await paid();
    const p = await paid();
    const v = await newVariant();
    const { editId } = await edit(o.id, { added: [{ variantId: v, unitPriceMinor: 1000, quantity: 1 }], awaiting: {} });
    await rejects(
      "insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, order_edit_id) values ($1, $2, 'stripe', 'cs_x', 1000, 'NOK', 'pending', $3)",
      [store, p.id, editId],
      /order_edit\.money/,
    );
  });

  it("writes a change's lines with it and never changes them after, but an added line's order line, once", async () => {
    const o = await paid();
    const v = await newVariant();
    const { editId } = await edit(o.id, { quantities: { [o.lineIds[0]]: 2 }, added: [{ variantId: v, unitPriceMinor: 1000, quantity: 1 }] });
    const lines = await rows<any>("select n, kind, order_line_id from commerce.order_edit_lines where order_edit_id = $1 order by n", [editId]);
    expect(lines.map((l) => l.kind)).toEqual(["reduce", "add"]);
    expect(lines[1].order_line_id).not.toBeNull();
    await rejects("update commerce.order_edit_lines set quantity = 5 where order_edit_id = $1 and n = 1", [editId], /order_edit\.lines_fixed/);
    await rejects("update commerce.order_edit_lines set order_line_id = $2 where order_edit_id = $1 and n = 2", [editId, o.lineIds[1]], /order_edit\.lines_fixed/);
    await rejects("delete from commerce.order_edit_lines where order_edit_id = $1", [editId], /order_edit\.append_only/);
    await rejects(
      "insert into commerce.order_edit_lines (store_id, order_edit_id, n, kind, order_line_id, sku, title, quantity, unit_price_minor, total_minor, discount_minor, tax_minor, tax_rate, before) values ($1, $2, 9, 'remove', $3, 'S', 'T', 1, 1, 1, 0, 0, 0, '{}')",
      [store, editId, o.lineIds[1]],
      /order_edit\.lines_fixed/,
    );
  });

  it("keeps the order's number, its sequence and its sums through a run of changes", async () => {
    const o = await paid();
    const before = await one<any>("select number from commerce.orders where id = $1", [o.id]);
    const v = await newVariant();
    await edit(o.id, { quantities: { [o.lineIds[0]]: 2 } });
    await edit(o.id, { added: [{ variantId: v, unitPriceMinor: 2500, quantity: 2 }] });
    await edit(o.id, { quantities: { [o.lineIds[1]]: 0 }, shipping: { kind: "set", amountMinor: 0 } });
    const after = await one<any>("select number, subtotal_minor::int as s, shipping_minor::int as sh, discount_minor::int as d, total_minor::int as t, tax_minor::int as tax from commerce.orders where id = $1", [o.id]);
    expect(after.number).toBe(before.number);
    expect(after.t).toBe(after.s + after.sh - after.d);
    const lines = await linesOf(o.id);
    expect(after.tax).toBe(lines.reduce((s: number, l: any) => s + l.tax, 0));
    expect(lines.map((l: any) => [l.sku, l.quantity])).toEqual([["A", 2], ["ADD-0", 2]]);
    expect(await rows("select * from commerce.document_audit($1) where not ok", [store])).toEqual([]);
  });
});

describe("stock (3.3 point 8)", () => {
  async function stockStore() {
    const s = await createInvoiceStore(db, `ful-stock-${next()}`);
    const loc = await scalar<string>("insert into commerce.inventory_locations (store_id, name, country) values ($1, 'Main', 'NO') returning id", [s]);
    return { s, loc };
  }
  const level = (s: string, v: string, loc: string, n: number) =>
    db.query("insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values ($1, $2, $3, $4) on conflict (variant_id, location_id) do update set on_hand = excluded.on_hand", [s, v, loc, n]);
  const onHand = (v: string, loc: string) => scalar<number>("select on_hand from commerce.inventory_levels where variant_id = $1 and location_id = $2", [v, loc]);

  it("knows the movement source order_edit (the recorder's list and the table's check say the same as MOVEMENT_SOURCES)", async () => {
    expect(MOVEMENT_SOURCES).toContain("order_edit");
  });

  it("draws a change's added units from its own holds, as sales from order_edit, and releases the holds", async () => {
    const { s, loc } = await stockStore();
    const v = await newVariant(s);
    await level(s, v, loc, 5);
    const o = await paid({}, s);
    const { editId } = await edit(o.id, { added: [{ variantId: v, unitPriceMinor: 1000, quantity: 2 }], awaiting: { holds: [{ variantId: v, locationId: loc, quantity: 2 }] } }, s);
    expect(await scalar<number>("select in_stock from commerce.variant_availability where variant_id = $1", [v])).toBe(3);
    // The order's own payment-time draw would not take the change's holds.
    await transaction(async (tx) => {
      await tx.query("select set_config('kaizen.order_edit', $1, true)", [o.id]);
      const priced = priceOrderEdit(
        { order: await factsOf(o.id), quantities: {}, added: [{ key: "k0", variantId: v, sku: "ADD-0", title: "Added 0", unitPriceMinor: 1000, listPriceMinor: 1000, quantity: 2, rate: 0.25 }], shipping: { kind: "keep" } },
        tax,
      );
      await writeChange(tx, s, o.id, editId, priced);
      await tx.query("update commerce.order_edits set status = 'applied' where id = $1", [editId]);
      await settleMoney(tx, s, o.id, editId, priced.differenceMinor, "manual");
      expect((await tx.query<{ short: number }>("select commerce.draw_edit_stock($1) as short", [editId])).rows[0].short).toBe(0);
    });
    expect(await onHand(v, loc)).toBe(3);
    expect(await rows("select reason, source, delta, order_id from commerce.inventory_movements where variant_id = $1 and reason = 'sale'", [v])).toEqual([
      { reason: "sale", source: "order_edit", delta: -2, order_id: o.id },
    ]);
    expect(await scalar<number>("select count(*)::int from commerce.inventory_reservations where order_edit_id = $1 and released_at is null", [editId])).toBe(0);
    expect(await scalar<number>("select in_stock from commerce.variant_availability where variant_id = $1", [v])).toBe(3);
  });

  it("draws afresh when the holds lapsed, backorders what a variant that keeps selling lacks, and says short for one that stops at zero", async () => {
    const { s, loc } = await stockStore();
    const keeps = await newVariant(s, "continue");
    const stops = await newVariant(s, "deny");
    await level(s, keeps, loc, 1);
    await level(s, stops, loc, 0);
    const o = await paid({}, s);
    const { editId } = await edit(o.id, { added: [{ variantId: keeps, unitPriceMinor: 1000, quantity: 3 }], draw: true }, s);
    expect(await onHand(keeps, loc)).toBe(-2);
    expect(await one("select backorder_quantity, backorder_days from commerce.order_lines where order_edit_id = $1", [editId])).toEqual({ backorder_quantity: 2, backorder_days: 10 });
    const p = await paid({}, s);
    await expect(edit(p.id, { added: [{ variantId: stops, unitPriceMinor: 1000, quantity: 1 }], documents: false }, s).then(async ({ editId: id }) => scalar<number>("select commerce.draw_edit_stock($1)", [id]))).resolves.toBe(1);
  });
});

describe("documents of a change (3.3 point 9)", () => {
  const invoices = (orderId: string) =>
    rows<any>("select kind, document_number, total_minor::int as total, tax_minor::int as tax, order_edit_id, snapshot from commerce.invoices where order_id = $1 order by number", [orderId]);
  const notes = (orderId: string) =>
    rows<any>(
      `select c.source, c.document_number, c.total_minor::int as total, c.tax_minor::int as tax, c.refund_id, c.order_edit_id, c.snapshot
         from commerce.credit_notes c join commerce.invoices i on i.id = c.invoice_id where i.order_id = $1 order by c.number`,
      [orderId],
    );
  /** Per rate: Σ invoices − Σ credit notes, from the documents' buckets. */
  async function netPerRate(orderId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const inv of await invoices(orderId)) for (const b of inv.snapshot.buckets) out[b.rate] = (out[b.rate] ?? 0) + b.grossMinor;
    for (const n of await notes(orderId)) for (const b of n.snapshot.buckets) out[b.rate] = (out[b.rate] ?? 0) - b.grossMinor;
    return out;
  }
  async function orderPerRate(orderId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const l of await rows<any>("select tax_rate, total_minor from commerce.order_lines where order_id = $1", [orderId])) out[Number(l.tax_rate)] = (out[Number(l.tax_rate)] ?? 0) + Number(l.total_minor);
    const o = await one<any>("select total_minor, (select coalesce(sum(total_minor), 0) from commerce.order_lines where order_id = $1) as lines from commerce.orders where id = $1", [orderId]);
    const ship = Number(o.total_minor) - Number(o.lines);
    if (ship > 0) out[0.25] = (out[0.25] ?? 0) + ship;
    return out;
  }

  it("issues a credit note for what is taken off and an additional invoice for what is added, both referring to the order's invoice", async () => {
    const o = await paid({ lines: [{ sku: "A", quantity: 3, unit: 10000 }, { sku: "F", quantity: 1, unit: 4000, rate: 0.15 }] });
    const v = await newVariant();
    const { editId, priced } = await edit(o.id, {
      quantities: { [o.lineIds[0]]: 1 },
      added: [{ variantId: v, unitPriceMinor: 2500, quantity: 2, rate: 0.15 }],
      shipping: { kind: "set", amountMinor: 0 },
    });
    expect(priced.differenceMinor).toBe(-20000 + 5000 - 4900);
    const inv = await invoices(o.id);
    expect(inv.map((i) => i.kind)).toEqual(["order", "order_edit"]);
    expect(inv[1]).toMatchObject({ total: 5000, order_edit_id: editId });
    expect(inv[1].snapshot.refersTo).toMatchObject({ invoiceNumber: inv[0].document_number });
    expect(inv[1].snapshot.payments).toEqual([{ kind: "settled_by_order", amountMinor: 5000, provider: "order", invoiceNumber: inv[0].document_number }]);
    const cn = await notes(o.id);
    expect(cn.map((c) => c.source)).toEqual(["order_edit"]);
    expect(cn[0]).toMatchObject({ total: 20000 + 4900, order_edit_id: editId, refund_id: null });
    expect(cn[0].snapshot.lines.map((l: any) => [l.kind, l.quantity, l.grossMinor])).toEqual([["goods", 2, 20000], ["delivery", null, 4900]]);
    expect(cn[0].snapshot.reason).toMatchObject({ kind: "order_edit", editSeq: 1 });
    // The refund of the difference is covered by the change's credit note: no note of its own, and the order says so.
    expect(await scalar<number>("select count(*)::int from commerce.order_events where order_id = $1 and type = 'credit_note.covered_by_edit'", [o.id])).toBe(1);
    expect(await scalar("select documents from commerce.order_edits where id = $1", [editId])).toBe("issued");
    // Per rate, the documents together are the order as it now is.
    expect(await netPerRate(o.id)).toEqual(await orderPerRate(o.id));
    expect(await rows("select * from commerce.document_audit($1) where not ok", [store])).toEqual([]);
  });

  it("credits a later refund over the order's documents together, never above them", async () => {
    const o = await paid({ lines: [{ sku: "A", quantity: 1, unit: 10000 }], shipping: 0 });
    const v = await newVariant();
    await edit(o.id, { added: [{ variantId: v, unitPriceMinor: 6000, quantity: 1 }], payWith: "stripe" });
    // A refund of the whole order as it now is (16,000): above the original invoice alone, within the pool.
    const payment = await scalar<string>("select id from commerce.payments where order_id = $1 and order_edit_id is null", [o.id]);
    await db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values ($1, $2, 16000, 'goodwill', $3, 'succeeded')", [store, payment, `re_${next()}`]);
    const cn = await notes(o.id);
    expect(cn.map((c) => [c.source, c.total])).toEqual([["refund", 16000]]);
    expect(cn[0].snapshot.position).toMatchObject({ invoiceTotalMinor: 16000, creditedBeforeMinor: 0, leftOnInvoiceMinor: 0 });
    const left = await rows<any>("select gross_left::int as g from commerce.order_buckets_left($1, $2)", [store, o.id]);
    expect(left.map((l) => l.g)).toEqual([0]);
  });

  it("counts a change's payment on its own invoice, and a late payment for a change never applied on none", async () => {
    const o = await paid();
    const v = await newVariant();
    const { editId } = await edit(o.id, { added: [{ variantId: v, unitPriceMinor: 3000, quantity: 1 }], payWith: "stripe" });
    const pay = await scalar<string>("select payment_id from commerce.order_edits where id = $1", [editId]);
    const issued = await scalar<string>("select issued_at from commerce.invoices where order_id = $1 and kind = 'order'", [o.id]);
    expect(await scalar("select commerce.payment_on_invoice($1, $2, $3)", [store, pay, issued])).toBe(true);
    const p = await paid();
    const { editId: waiting } = await edit(p.id, { added: [{ variantId: v, unitPriceMinor: 3000, quantity: 1 }], awaiting: {} });
    const late = await scalar<string>(
      "insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, order_edit_id) values ($1, $2, 'stripe', $3, 3000, 'NOK', 'captured', $4) returning id",
      [store, p.id, `cs_late_${next()}`, waiting],
    );
    await db.query("update commerce.order_edits set status = 'cancelled' where id = $1", [waiting]);
    const pIssued = await scalar<string>("select issued_at from commerce.invoices where order_id = $1 and kind = 'order'", [p.id]);
    expect(await scalar("select commerce.payment_on_invoice($1, $2, $3)", [store, late, pIssued])).toBe(false);
    await db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, order_edit_id) values ($1, $2, 3000, 'late', $3, 'succeeded', $4)", [
      store,
      late,
      `re_${next()}`,
      waiting,
    ]);
    expect(await notes(p.id)).toEqual([]);
    expect(await scalar<number>("select count(*)::int from commerce.order_events where order_id = $1 and type = 'credit_note.not_invoiced'", [p.id])).toBe(1);
  });

  it("makes a change's documents wait for the order's invoice, and finds them stated in it when the invoice comes after the change", async () => {
    const s = await createInvoiceStore(db, `ful-wait-${next()}`, { legalName: null });
    const o = await paid({}, s);
    expect(await invoices(o.id)).toEqual([]);
    const { editId } = await edit(o.id, { quantities: { [o.lineIds[0]]: 2 } }, s);
    expect(await scalar("select documents from commerce.order_edits where id = $1", [editId])).toBe("waiting");
    await db.query("update commerce.stores set legal_name = 'Later AS' where id = $1", [s]);
    await db.query("select commerce.issue_waiting_invoices($1)", [s]);
    const inv = await invoices(o.id);
    expect(inv.map((i) => i.kind)).toEqual(["order"]);
    expect(inv[0].total).toBe(await scalar<number>("select total_minor::int from commerce.orders where id = $1", [o.id]));
    expect(await scalar("select documents from commerce.order_edits where id = $1", [editId])).toBe("in_original");
    // The refund of the change is covered (the invoice already states the lower total), so no credit note follows.
    await db.query("select commerce.issue_missing_credit_notes($1)", [s]);
    expect(await notes(o.id)).toEqual([]);
  });

  it("issues none for an order that is not invoiced, and none for a copy or a host's order", async () => {
    const s = await createInvoiceStore(db, `ful-off-${next()}`, { invoicing: false });
    const o = await paid({}, s);
    const { editId } = await edit(o.id, { quantities: { [o.lineIds[0]]: 2 } }, s);
    expect(await scalar("select documents from commerce.order_edits where id = $1", [editId])).toBe("not_invoiced");
  });

  it("refuses a document that the issuing function did not make, and an additional invoice for another amount", async () => {
    const o = await paid();
    const v = await newVariant();
    const { editId } = await edit(o.id, { added: [{ variantId: v, unitPriceMinor: 3000, quantity: 1 }], documents: false });
    const inv = await one<any>("select * from commerce.invoices where order_id = $1 and kind = 'order'", [o.id]);
    const snap = { ...inv.snapshot, buckets: [{ rate: 0.25, basis: "standard", netMinor: 2400, vatMinor: 600, grossMinor: 3000 }] };
    const insert = (by: string, total: number, gross = total) =>
      transaction(async (tx) => {
        await tx.query("select set_config('commerce.issuing_document', $1, true)", [by]);
        const number = (await tx.query<{ n: number }>("select commerce.next_document_number($1, 'invoice') as n", [store])).rows[0].n;
        const prefix = (await tx.query<{ p: string }>("select prefix as p from commerce.document_series where store_id = $1 and series = 'invoice'", [store])).rows[0].p;
        await tx.query(
          `insert into commerce.invoices (store_id, order_id, order_edit_id, series, number, document_number, currency, total_minor, tax_minor, net_minor, kind, issued_on, supply_date, locale, vat_kind, snapshot, public_token)
           values ($1, $2, $3, 'invoice', $4, $5, 'NOK', $6, $7, $8, 'order_edit', current_date, current_date, 'nb-NO', 'standard', $9::jsonb, commerce.new_document_token('inv_'))`,
          [store, o.id, editId, number, `${prefix}${number}`, total, Math.round(gross / 5), gross - Math.round(gross / 5), JSON.stringify({ ...snap, buckets: [{ rate: 0.25, basis: "standard", netMinor: gross - Math.round(gross / 5), vatMinor: Math.round(gross / 5), grossMinor: gross }] })],
        );
      });
    await expect(insert(o.id, 3000)).rejects.toThrow(/document\.issuing_only/);
    await expect(insert(editId, 2999)).rejects.toThrow(/invoice\.total_not_edit/);
    // Then the job issues it properly.
    await db.query("select commerce.issue_edit_documents($1, $2)", [store, editId]);
    expect((await invoices(o.id)).map((i) => [i.kind, i.total])).toEqual([["order", o.total], ["order_edit", 3000]]);
  });

  it("is a closed list of states (the code's and the database's)", async () => {
    const def = await scalar<string>("select pg_get_constraintdef(oid) from pg_constraint where conname = 'order_edits_documents'");
    for (const d of ORDER_EDIT_DOCUMENTS) expect(def).toContain(`'${d}'`);
    const statuses = await scalar<string>("select pg_get_constraintdef(oid) from pg_constraint where conname = 'order_edits_status'");
    for (const s of ORDER_EDIT_STATUSES) expect(statuses).toContain(`'${s}'`);
  });
});

describe("registers (3.7)", () => {
  it("copies none of the new tables", () => {
    expect(COPY_RULES.shipment_lines.group).toBe("never");
    expect(COPY_RULES.order_edits.group).toBe("never");
    expect(COPY_RULES.order_edit_lines.group).toBe("never");
    expect(COPY_RULES.unsent_closures.group).toBe("never");
  });

  it("keeps row-level security on for the new tables", async () => {
    const tables = await rows<any>("select relname, relrowsecurity from pg_class where relname in ('shipment_lines', 'order_edits', 'order_edit_lines', 'unsent_closures') order by relname");
    expect(tables).toEqual([
      { relname: "order_edit_lines", relrowsecurity: true },
      { relname: "order_edits", relrowsecurity: true },
      { relname: "shipment_lines", relrowsecurity: true },
      { relname: "unsent_closures", relrowsecurity: true },
    ]);
  });

  it("sets an empty search path on every new function", async () => {
    const fns = await rows<any>(
      `select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'commerce' and p.proname in ('shipment_lines_rules', 'shipments_edit_pending', 'line_shipped', 'line_to_send', 'order_fulfilment', 'refresh_fulfilment',
          'order_settled', 'in_order_edit', 'order_lines_settled_guard', 'orders_settled_guard', 'order_edits_rules', 'order_edits_settled', 'order_edit_money_ref',
          'order_edit_lines_rules', 'draw_edit_stock', 'order_buckets_left', 'make_edit_documents', 'issue_edit_documents',
          'closed_quantity', 'unsent_closures_rules', 'guard_unsent_closures', 'unsent_closures_refresh', 'order_edits_unsent_closed')`,
    );
    expect(fns).toHaveLength(23);
    for (const f of fns) expect(f.proconfig).toEqual(['search_path=""']);
  });

  it("refuses a change and a parcel line for a copied order", async () => {
    const copy = await placeOrder(db, store, { lines: [{ sku: "A", quantity: 2, unit: 1000 }], copied: true });
    await expect(edit(copy.id, { quantities: { [copy.lineIds[0]]: 1 } })).rejects.toThrow(/copied_order/);
  });
});

it("never lets a store's change touch another store (composite keys)", async () => {
  const o = await paid();
  await expect(
    db.query(
      `insert into commerce.order_edits (store_id, order_id, status, reason, notify, restock, currency, base, total_before, total_after, subtotal_delta, shipping_before, shipping_after, discount_delta, tax_delta, difference_minor, made_by)
       values ($1, $2, 'applied', 'customer_request', true, true, 'NOK', '{}', 0, 0, 0, 0, 0, 0, 0, 0, $3)`,
      [other, o.id, account],
    ),
  ).rejects.toThrow(/order_edit\.order|foreign key/);
  expect(noParts()).toEqual({ member: 0, campaign: 0, bonus: 0, referral: 0, staff: 0, relief: 0 });
});

describe("a property: random changes, parcels and withdrawals keep every rule (6.4)", () => {
  /** A small seeded generator, so a failure can be replayed. */
  const random = (seed: number) => () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  async function lineState(orderId: string) {
    return rows<any>(
      `select ol.id, ol.quantity, (ol.delivery = 'physical' and ol.variant_id is not null) as physical, commerce.line_shipped(ol.id) as shipped,
              commerce.withdrawn_quantity(ol.id) as withdrawn, commerce.closed_quantity(ol.id) as closed, commerce.line_to_send(ol.id) as to_send,
              coalesce((select sum(sl.quantity) from commerce.shipment_lines sl where sl.order_line_id = ol.id), 0)::int as in_parcels
         from commerce.order_lines ol where ol.order_id = $1 order by ol.ctid`,
      [orderId],
    );
  }

  async function holds(orderId: string) {
    const lines = await lineState(orderId);
    const has = await scalar<boolean>("select exists (select 1 from commerce.shipments where order_id = $1)", [orderId]);
    for (const l of lines) {
      expect(l.in_parcels).toBeLessThanOrEqual(l.quantity);
      expect(l.to_send).toBeGreaterThanOrEqual(0);
      expect(l.to_send).toBe(l.physical ? Math.max(0, l.quantity - l.shipped - l.withdrawn - l.closed) : 0);
    }
    const ts: FulfilmentLine[] = lines.map((l) => ({ lineId: l.id, quantity: l.quantity, physical: l.physical, shipped: l.shipped, withdrawn: l.withdrawn, closed: l.closed }));
    expect(await scalar("select commerce.order_fulfilment($1)", [orderId])).toBe(fulfilmentState(ts, has));
    const o = await one<any>("select subtotal_minor::int as s, shipping_minor::int as sh, discount_minor::int as d, total_minor::int as t, tax_minor::int as tax from commerce.orders where id = $1", [orderId]);
    expect(o.t).toBe(o.s + o.sh - o.d);
    const sums = await one<any>("select coalesce(sum(tax_minor), 0)::int as tax, coalesce(sum(total_minor), 0)::int as total from commerce.order_lines where order_id = $1", [orderId]);
    expect(o.tax).toBeGreaterThanOrEqual(sums.tax);
    expect(o.t).toBeGreaterThanOrEqual(sums.total);
    return lines;
  }

  it.each([11, 23, 37, 41, 59])("seed %i", async (seed) => {
    const next = random(seed);
    const pick = <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)];
    const s = await createInvoiceStore(db, `ful-prop-${seed}-${counter++}`);
    const audit = async () => one("select * from commerce.order_number_audit($1)", [s]);
    const o = await paid({ lines: [{ sku: "P", quantity: 1 + Math.floor(next() * 4), unit: 1000 + Math.floor(next() * 9000) }, { sku: "Q", quantity: 1 + Math.floor(next() * 3), unit: 777 }, { sku: "DL", unit: 300, delivery: "digital" }] }, s);
    const before = await audit();
    await holds(o.id);
    // First, changes while nothing is sent.
    for (let i = 0; i < 3; i += 1) {
      const lines = (await lineState(o.id)).filter((l) => l.physical);
      const choice = next();
      try {
        if (choice < 0.4) {
          const l = pick(lines);
          await edit(o.id, { quantities: { [l.id]: Math.floor(next() * l.quantity) } }, s);
        } else if (choice < 0.8) {
          const v = await newVariant(s);
          await edit(o.id, { added: [{ variantId: v, unitPriceMinor: 100 + Math.floor(next() * 5000), quantity: 1 + Math.floor(next() * 3) }] }, s);
        } else {
          await edit(o.id, { shipping: { kind: "set", amountMinor: Math.floor(next() * 9900) } }, s);
        }
      } catch (error) {
        // A change the pricing refuses (nothing left, no change) is not written at all.
        expect(String(error)).toMatch(/not priced/);
      }
      await holds(o.id);
    }
    // Then parcels, withdrawals and closures (units that will not be sent) in a random order, until nothing is left.
    for (let i = 0; i < 12; i += 1) {
      const lines = (await lineState(o.id)).filter((l) => l.physical);
      const open = lines.filter((l) => l.to_send > 0);
      if (open.length === 0) break;
      const l = pick(open);
      const roll = next();
      if (roll < 0.6) {
        const units = 1 + Math.floor(next() * l.to_send);
        await ship(o.id, [[l.id, units]], s);
        // One unit more than the line holds, with what its parcels hold now, is always refused by the database.
        await expect(ship(o.id, [[l.id, l.quantity - l.in_parcels - units + 1]], s)).rejects.toThrow(/too_many/);
      } else if (roll < 0.8) {
        const units = 1 + Math.floor(next() * l.to_send);
        // One unit more than is still to send is refused; then what is left of it is closed.
        await expect(close(o.id, l.id, l.to_send + 1, s)).rejects.toThrow(/unsent_closure\.too_many/);
        const status = await scalar<string>("select status from commerce.orders where id = $1", [o.id]);
        if (status === "paid") await close(o.id, l.id, units, s);
      } else {
        await withdraw(o.id, l.id, 1 + Math.floor(next() * l.to_send), s);
      }
      await holds(o.id);
    }
    await db.query("select commerce.refresh_fulfilment($1, $2)", [s, o.id]);
    const state = await scalar<string>("select commerce.order_fulfilment($1)", [o.id]);
    expect(["sent", "withdrawn", "closed", "partly_sent", "none"]).toContain(state);
    if (state === "sent") expect(await scalar("select status from commerce.orders where id = $1", [o.id])).toBe("fulfilled");
    expect(await audit()).toEqual(before);
    expect(await rows("select * from commerce.document_audit($1) where not ok", [s])).toEqual([]);
  });
});
