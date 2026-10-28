import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { Cell } from "@/lib/csv";

import { auditOf, csvBytes, depsWith, fakeStorage, itemsOf, jobRow, runToEnd } from "./data-test-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const staff = await import("./customer-staff");
const merge = await import("./customer-merge");
const jobs = await import("./data-jobs");
const { addTag, tagsOf } = await import("./segments");
const { mainLocation, newStore, pay, place, setLevel } = await import("./inventory-test-support");

/**
 * Customers in the admin (wave 10 unit C, D366): staff add and change a customer, keep notes on a person, merge two accounts, and the owner
 * imports a customer file. What is held: one store never reaches another's customer; a changed email is unproven again and its tags and
 * notes follow; a merge moves what is the person's, the bonus as an entry pair, deletes the other account, and refuses before anything
 * changes when it would lose something; an import creates and updates by email, keeps what an empty cell leaves out, never subscribes
 * anyone, and the activity log holds no person's email.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const mail = (name: string) => `${name}-${run}@example.com`;
let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;

beforeAll(async () => {
  store = await newStore("cstaff");
  other = await newStore("cstaff-other");
});

afterAll(async () => {
  await closeDb();
});

async function customerRow(id: string): Promise<Row | undefined> {
  const [row] = await db().execute<Row>(sql`select email, name, phone, address, company_name, organisation_number, email_verified_at, password_hash from commerce.customers where id = ${id}::uuid`);
  return row;
}

const created = async (raw: Parameters<typeof staff.createCustomer>[1]) => {
  const made = await staff.createCustomer(store.member, raw);
  if (!made.ok) throw new Error(JSON.stringify(made.problem));
  return made.id;
};

describe("adding and changing a customer", () => {
  it("adds an account with no password and an email not proven, the address as the default one, and audits no value", async () => {
    const id = await created({ email: mail("Ada").toUpperCase(), name: "Ada Lovelace", phone: "+47 400 00 001", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: "no" });
    const row = await customerRow(id);
    expect(row).toMatchObject({ email: mail("ada"), name: "Ada Lovelace", email_verified_at: null, password_hash: null });
    expect(row?.address).toMatchObject({ line1: "Storgata 1", country: "NO", name: "Ada Lovelace" });
    const [entry] = (await auditOf(store.storeId, "customer.created")).slice(-1);
    expect(JSON.stringify(entry.details)).not.toContain(mail("ada"));
    expect(JSON.stringify(entry.details)).not.toContain("Lovelace");
  });

  it("refuses an email the store already has, a partial address and half a company, writing nothing", async () => {
    expect(await staff.createCustomer(store.member, { email: mail("ada") })).toEqual({ ok: false, problem: { code: "taken" } });
    expect(await staff.createCustomer(store.member, { email: mail("partial"), line1: "Gate 1" })).toEqual({ ok: false, problem: { code: "address", field: "postalCode" } });
    expect(await staff.createCustomer(store.member, { email: mail("half"), companyName: "Half AS" })).toEqual({ ok: false, problem: { code: "company_both" } });
    const [n] = await db().execute<Row>(sql`select count(*)::int as n from commerce.customers where store_id = ${store.storeId}::uuid and email in (${mail("partial")}, ${mail("half")})`);
    expect(n.n).toBe(0);
  });

  it("lets another store add the same person, and never reaches across stores", async () => {
    const theirs = await staff.createCustomer(other.member, { email: mail("ada") });
    expect(theirs.ok).toBe(true);
    if (!theirs.ok) return;
    expect(await staff.updateCustomer(store.member, theirs.id, { email: mail("ada"), name: "Taken over" })).toEqual({ ok: false, problem: { code: "not_found" } });
    expect((await customerRow(theirs.id))?.name).toBe("");
  });

  it("changes the email: unproven again, and the person's tags and notes follow it", async () => {
    const id = await created({ email: mail("bob"), name: "Bob" });
    await db().execute(sql`update commerce.customers set email_verified_at = now() where id = ${id}::uuid`);
    await addTag(store.storeId, store.accountId, mail("bob"), "vip");
    const note = await staff.addNote(store.member, id, "Prefers delivery after 16:00");
    expect(note.ok).toBe(true);
    const done = await staff.updateCustomer(store.member, id, { email: mail("robert"), name: "Robert", phone: "" });
    expect(done.ok).toBe(true);
    const row = await customerRow(id);
    expect(row).toMatchObject({ email: mail("robert"), name: "Robert", email_verified_at: null });
    expect((await tagsOf(store.storeId, mail("robert"))).map((t) => t.key)).toEqual(["vip"]);
    expect(await tagsOf(store.storeId, mail("bob"))).toEqual([]);
    expect((await staff.notesOf(store.storeId, mail("robert"))).map((n) => n.body)).toEqual(["Prefers delivery after 16:00"]);
  });
});

describe("notes", () => {
  it("keeps notes newest first with their author, refuses an empty one, and deletes only this person's", async () => {
    const id = await created({ email: mail("cleo") });
    expect(await staff.addNote(store.member, id, "   ")).toEqual({ ok: false, problem: "empty" });
    expect(await staff.addNote(store.member, id, "x".repeat(5001))).toEqual({ ok: false, problem: "too_long" });
    const first = await staff.addNote(store.member, id, "First");
    const second = await staff.addNote(store.member, id, "Second");
    if (!first.ok || !second.ok) throw new Error("not added");
    const notes = await staff.notesOf(store.storeId, mail("cleo"), store.accountId);
    expect(notes.map((n) => n.body)).toEqual(["Second", "First"]);
    expect(notes[0].mine).toBe(true);
    // A note of another person is not this one's to delete.
    const someoneElse = await created({ email: mail("dora") });
    expect(await staff.deleteNote(store.member, someoneElse, first.id)).toBe(false);
    expect(await staff.deleteNote(store.member, id, first.id)).toBe(true);
    expect((await staff.notesOf(store.storeId, mail("cleo"))).map((n) => n.body)).toEqual(["Second"]);
    // A note is never edited (the database refuses), and its words are not in the activity log.
    await expect(db().execute(sql`update commerce.customer_notes set body = 'changed' where id = ${second.id}::uuid`)).rejects.toThrow();
    const entries = await auditOf(store.storeId, "customer.note_added");
    expect(entries.every((e) => !JSON.stringify(e.details).includes("Second"))).toBe(true);
  });
});

describe("merging two customers", () => {
  it("moves the other account's wishlists, addresses, tags, notes and credits, then deletes it", async () => {
    const keep = await created({ email: mail("keep"), name: "Kept", line1: "Kept 1", postalCode: "0150", city: "Oslo", country: "NO" });
    const remove = await created({ email: mail("gone"), name: "Gone", line1: "Gone 1", postalCode: "5003", city: "Bergen", country: "NO" });
    // A paid order placed signed in with the other account.
    await setLevel(store.storeId, "DEMO-TOTE", await mainLocation(store.storeId), 5);
    const order = await place(store.storeId, [["DEMO-TOTE", 1]]);
    await pay(store.storeId, order, store.account);
    await db().execute(sql`update commerce.orders set customer_id = ${remove}::uuid where id = ${order.orderId}::uuid`);
    const [before] = await db().execute<Row>(sql`select number from commerce.orders where id = ${order.orderId}::uuid`);
    await db().execute(sql`insert into commerce.wishlists (store_id, customer_id, name) values (${store.storeId}::uuid, ${remove}::uuid, 'Later')`);
    // A cancelled subscription box list is history: it moves, and does not stop the other account being deleted.
    const [schedule] = await db().execute<Row>(sql`
      insert into commerce.delivery_schedules (store_id, market_code, currency, name, delivery_weekday) values (${store.storeId}::uuid, 'NO', 'NOK', 'Weekly', 3) returning id
    `);
    await db().execute(sql`
      insert into commerce.standing_orders (store_id, customer_id, schedule_id, status) values (${store.storeId}::uuid, ${remove}::uuid, ${String(schedule.id)}::uuid, 'cancelled')
    `);
    await db().execute(sql`
      insert into commerce.discount_codes (store_id, code, kind, percent, customer_ids)
      values (${store.storeId}::uuid, ${`MERGE${run}`.toUpperCase()}, 'percent', 10, ${JSON.stringify([remove, keep])}::jsonb)
    `);
    await addTag(store.storeId, store.accountId, mail("gone"), "wholesale");
    await staff.addNote(store.member, remove, "Called about an invoice");
    await db().execute(sql`select commerce.bonus_adjust(${store.storeId}::uuid, ${remove}::uuid, 5000, 'Test credits', ${store.accountId}::uuid, ${`test:${run}`})`);

    const preview = await merge.mergePreview(store.member, keep, remove);
    expect(preview).toMatchObject({ ok: true, counts: { wishlists: 1, addresses: 1, tags: 1, notes: 1, bonusMinor: 5000, orders: 1 } });
    // The preview changed nothing.
    expect(await customerRow(remove)).toBeDefined();

    const done = await merge.mergeCustomers(store.member, keep, remove);
    expect(done.ok).toBe(true);
    expect(await customerRow(remove)).toBeUndefined();
    // The order is the kept customer's, its number untouched.
    const [after] = await db().execute<Row>(sql`select number, customer_id from commerce.orders where id = ${order.orderId}::uuid`);
    expect(after).toEqual({ number: before.number, customer_id: keep });
    const [boxes] = await db().execute<Row>(sql`select count(*)::int as n from commerce.standing_orders where customer_id = ${keep}::uuid and status = 'cancelled'`);
    expect(boxes.n).toBe(1);
    const [lists] = await db().execute<Row>(sql`select count(*)::int as n from commerce.wishlists where customer_id = ${keep}::uuid`);
    expect(lists.n).toBe(1);
    const [addresses] = await db().execute<Row>(sql`select count(*)::int as n, count(*) filter (where is_default_shipping)::int as defaults from commerce.customer_addresses where customer_id = ${keep}::uuid`);
    expect(addresses).toMatchObject({ n: 2, defaults: 1 });
    // The kept customer's own address stays the default.
    expect((await customerRow(keep))?.address).toMatchObject({ line1: "Kept 1" });
    const [code] = await db().execute<Row>(sql`select customer_ids from commerce.discount_codes where store_id = ${store.storeId}::uuid and code = ${`MERGE${run}`.toUpperCase()}`);
    expect(code.customer_ids).toEqual([keep]);
    expect((await tagsOf(store.storeId, mail("keep"))).map((t) => t.key)).toEqual(["wholesale"]);
    expect((await staff.notesOf(store.storeId, mail("keep"))).map((n) => n.body)).toEqual(["Called about an invoice"]);
    const [balance] = await db().execute<Row>(sql`select available_minor from commerce.bonus_balance(${store.storeId}::uuid, ${keep}::uuid)`);
    expect(Number(balance.available_minor)).toBe(5000);
    const [entry] = (await auditOf(store.storeId, "customer.merged")).slice(-1);
    expect(entry.details).toMatchObject({ kept: keep, removed: remove, bonusMinor: 5000 });
    expect(JSON.stringify(entry.details)).not.toContain(mail("gone"));
  });

  it("refuses the same customer, another store's customer, and an account with gift cards, changing nothing", async () => {
    const keep = await created({ email: mail("k2") });
    expect(await merge.mergeCustomers(store.member, keep, keep)).toEqual({ ok: false, refusal: "same" });
    const theirs = await staff.createCustomer(other.member, { email: mail("theirs") });
    if (!theirs.ok) throw new Error("not made");
    expect(await merge.mergeCustomers(store.member, keep, theirs.id)).toEqual({ ok: false, refusal: "not_found" });
    expect(await customerRow(theirs.id)).toBeDefined();
  });

  it("refuses when the two would hold more tags than one person may", async () => {
    const keep = await created({ email: mail("tagged-a") });
    const remove = await created({ email: mail("tagged-b") });
    for (let i = 0; i < 30; i += 1) await addTag(store.storeId, store.accountId, mail("tagged-a"), `a${i}`);
    for (let i = 0; i < 30; i += 1) await addTag(store.storeId, store.accountId, mail("tagged-b"), `b${i}`);
    expect(await merge.mergeCustomers(store.member, keep, remove)).toEqual({ ok: false, refusal: "tags" });
    expect(await customerRow(remove)).toBeDefined();
    expect(await tagsOf(store.storeId, mail("tagged-b"))).toHaveLength(30);
  });

  it("finds the other customer by email in the store only", async () => {
    const id = await created({ email: mail("findme") });
    expect(await merge.customerIdByEmail(store.storeId, mail("FINDME"))).toBe(id);
    expect(await merge.customerIdByEmail(other.storeId, mail("findme"))).toBeNull();
  });
});

describe("the customer import", () => {
  const HEADER = ["Email", "First Name", "Last Name", "Phone", "Default Address Address1", "Default Address City", "Default Address Zip", "Default Address Country Code", "Accepts Email Marketing", "Tags"];

  async function importFile(rows: Cell[][], o: { apply?: boolean } = {}) {
    const storage = fakeStorage();
    const deps = depsWith(storage);
    const started = await jobs.startCustomerUpload(store.member, "customers.csv", deps);
    if (!started.ok) throw new Error(started.problem);
    storage.files.set(`imports/${started.path}`, csvBytes([HEADER, ...rows]));
    const registered = await jobs.registerCustomerImport(store.member, { path: started.path, name: "customers.csv" }, deps);
    if (!registered.ok) throw new Error(registered.problems.join(" "));
    const jobId = registered.jobId;
    const check = await jobs.startCustomerCheck(store.member, jobId, deps);
    if (!check.ok) throw new Error(check.problem);
    expect(await runToEnd(jobId, deps)).toBe("checked");
    const dry = jobs.customerDryCountsOf({ counts: (await jobRow(jobId)).counts as Record<string, unknown> });
    if (o.apply) {
      const apply = await jobs.startCustomerApply(store.member, jobId, deps);
      if (!apply.ok) throw new Error(apply.problem);
      expect(await runToEnd(jobId, deps)).toBe("done");
    }
    return { jobId, dry };
  }

  it("checks without writing, then creates and updates by email, keeping what an empty cell leaves out and subscribing nobody", async () => {
    const existing = await created({ email: mail("known"), name: "Known Person", phone: "+47 400 00 009" });
    const rows: Cell[][] = [
      [mail("new1"), "Nina", "Ny", "+47 411 11 111", "Ny gate 1", "Oslo", "0150", "NO", "yes", "vip"],
      [mail("KNOWN"), "", "", "", "", "", "", "", "yes", "returning"],
      ["not-an-email", "Bad", "Row", "", "", "", "", "", "", ""],
      [mail("new1"), "Twice", "", "", "", "", "", "", "", ""],
    ];
    const checked = await importFile(rows);
    expect(checked.dry).toEqual({ toCreate: 1, toUpdate: 1, withProblems: 2 });
    const [none] = await db().execute<Row>(sql`select count(*)::int as n from commerce.customers where store_id = ${store.storeId}::uuid and email = ${mail("new1")}`);
    expect(none.n).toBe(0);
    const codes = (await itemsOf(checked.jobId)).flatMap((i) => i.messages.map((m) => m.code));
    expect(codes).toEqual(expect.arrayContaining(["customerfile.marketing_ignored", "customerfile.email_invalid", "customerfile.duplicate"]));
    // No finding quotes a person's email.
    expect(JSON.stringify(await itemsOf(checked.jobId))).not.toContain(mail("new1"));
    // Only one import is open at a time: this one is cancelled before the file is brought in again.
    expect(await jobs.cancelJob(store.member, checked.jobId)).toEqual({ ok: true });

    await importFile(rows, { apply: true });
    const [made] = await db().execute<Row>(sql`select id, name, phone, address, password_hash, email_verified_at from commerce.customers where store_id = ${store.storeId}::uuid and email = ${mail("new1")}`);
    expect(made).toMatchObject({ name: "Nina Ny", phone: "+47 411 11 111", password_hash: null, email_verified_at: null });
    expect(made.address).toMatchObject({ line1: "Ny gate 1", city: "Oslo", postalCode: "0150", country: "NO" });
    expect((await tagsOf(store.storeId, mail("new1"))).map((t) => t.key)).toEqual(["vip"]);
    // The known customer keeps the name and phone the file left empty, and gains the tag.
    expect(await customerRow(existing)).toMatchObject({ name: "Known Person", phone: "+47 400 00 009" });
    expect((await tagsOf(store.storeId, mail("known"))).map((t) => t.key)).toEqual(["returning"]);
    // "Accepts Email Marketing" is never read: nobody is on the marketing list.
    const [subscribed] = await db().execute<Row>(sql`select count(*)::int as n from commerce.marketing_subscribers where store_id = ${store.storeId}::uuid and email in (${mail("new1")}, ${mail("known")})`);
    expect(subscribed.n).toBe(0);
    const [entry] = (await auditOf(store.storeId, "customer.imported")).slice(-1);
    expect(entry.details).toMatchObject({ created: 1, updated: 1 });
    expect(JSON.stringify(entry.details)).not.toContain("@example.com");
  });

  it("is the owner's: a member without the owner key cannot start one", async () => {
    const member = { ...store.member, role: "admin" as const };
    const started = await jobs.startCustomerUpload(member, "customers.csv", depsWith(fakeStorage()));
    expect(started.ok).toBe(false);
  });
});
