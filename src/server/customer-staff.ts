import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { organisationNumber } from "@/lib/b2b";
import {
  CUSTOMER_NOTE_MAX,
  cleanCustomerInput,
  cleanNote,
  type InputProblem,
  type RawCustomerInput,
  type StaffCustomerInput,
} from "@/lib/customer-staff";
import { TAGS_PER_PERSON } from "@/lib/segments";

import { audit, type Membership } from "./auth";
import { auditChange } from "./audit";
import { saveDefaultAddressIn } from "./customer-addresses";
import { findCustomer } from "./customer-admin";
import { memberCan } from "./permissions";
import { moveTags, tagsTogether } from "./segments";

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * Staff's own writes on a store's customers (wave 10 unit C, D366): adding a customer, changing their name, email, phone, address and
 * company, and the notes staff keep on a person. The ONE writer of these for staff and for the customer import (`customer-import.ts` calls
 * `createCustomerIn()`/`updateCustomerIn()` inside its own row transactions); a shopper still changes their own details in My account
 * (`customers.ts`). Every statement carries the store id, so a customer of another store is `not_found`, never a different answer.
 *
 * A customer staff add is an account with no password and an email not yet proven: the person signs in with a code sent to it (D32), and
 * until then only orders placed signed in join the account. An email staff change is unproven again, and the person's tags and notes move
 * with it (they are about the person, kept by address). Nothing here touches an order: an order keeps the address it was placed with, and a
 * restricted or anonymised one (D162) is never relinked. Every change is audited with `auditChange()` of kind `customer`, whose allowlist
 * writes no value of a person's data (a field is `{ changed: true }`); a note's words are never in the log.
 */

export type StaffProblem = InputProblem | { code: "taken" } | { code: "not_found" } | { code: "tags" } | { code: "addresses" } | { code: "forbidden" };
export type StaffResult = { ok: true; id: string } | { ok: false; problem: StaffProblem };

const WRITE = "customers:write" as const;

/** A refusal found inside a transaction: thrown so the transaction's writes are undone, and caught with its reason. */
class Refused extends Error {
  constructor(readonly problem: StaffProblem) {
    super("customer_staff.refused");
  }
}

const normal = (email: string) => email.trim().toLowerCase();

/** What the activity log compares before and after: the values never reach it (kind `customer` allows only `emailConfirmed`). */
async function snapshot(tx: Tx, storeId: string, customerId: string): Promise<Record<string, unknown> | null> {
  const [row] = await tx.execute<Row>(sql`
    select email, name, phone, address, company_name, organisation_number, email_verified_at is not null as confirmed
    from commerce.customers where store_id = ${storeId}::uuid and id = ${customerId}::uuid
  `);
  if (!row) return null;
  return {
    email: String(row.email),
    name: String(row.name),
    phone: String(row.phone),
    address: row.address ?? {},
    companyName: String(row.company_name ?? ""),
    organisationNumber: String(row.organisation_number ?? ""),
    emailConfirmed: Boolean(row.confirmed),
  };
}

/** The customer with an email in the store, if there is one (case-insensitive). */
export async function customerByEmail(tx: Tx, storeId: string, email: string): Promise<string | null> {
  const [row] = await tx.execute<Row>(sql`select id from commerce.customers where store_id = ${storeId}::uuid and lower(email) = ${normal(email)}`);
  return row ? String(row.id) : null;
}

/**
 * Adds a customer inside the caller's transaction: the account row (no password, email not proven), and the address as their default one.
 * Refused as `taken` when the email is already a customer of the store (the unique index decides when two arrive together).
 */
export async function createCustomerIn(tx: Tx, storeId: string, input: Pick<StaffCustomerInput, "email" | "name" | "phone" | "address"> & { company?: StaffCustomerInput["company"] }): Promise<StaffResult> {
  if (await customerByEmail(tx, storeId, input.email)) return { ok: false, problem: { code: "taken" } };
  const [row] = await tx.execute<Row>(sql`
    insert into commerce.customers (store_id, email, name, phone, company_name, organisation_number)
    values (${storeId}::uuid, ${normal(input.email)}, ${input.name}, ${input.phone}, ${input.company?.name ?? ""}, ${input.company?.number ?? ""})
    on conflict (store_id, lower(email)) do nothing
    returning id
  `);
  if (!row) return { ok: false, problem: { code: "taken" } };
  const id = String(row.id);
  if (input.address) {
    const saved = await saveDefaultAddressIn(tx, storeId, id, input.address);
    if (!saved.ok) return { ok: false, problem: { code: saved.reason === "too_many" ? "addresses" : "not_found" } };
  }
  return { ok: true, id };
}

/** What an update changes; a key left out is kept as it is. `address: null` keeps the saved addresses (an emptied address never deletes one). */
export type CustomerPatch = Partial<Pick<StaffCustomerInput, "email" | "name" | "phone" | "address" | "company">>;

/**
 * Changes a customer inside the caller's transaction, the row locked first. A new email must not be another customer's of the store; it is
 * then unproven again, and the tags and notes of the old address move to the new one (refused as `tags` when the two would hold more than a
 * person may). The before and after are returned for the caller's audit entry.
 */
export async function updateCustomerIn(
  tx: Tx,
  storeId: string,
  customerId: string,
  patch: CustomerPatch,
): Promise<{ ok: true; before: Record<string, unknown>; after: Record<string, unknown> } | { ok: false; problem: StaffProblem }> {
  const [locked] = await tx.execute<Row>(sql`
    select lower(email) as email from commerce.customers where store_id = ${storeId}::uuid and id = ${customerId}::uuid for update
  `);
  if (!locked) return { ok: false, problem: { code: "not_found" } };
  const before = (await snapshot(tx, storeId, customerId))!;
  const oldEmail = String(locked.email);
  if (patch.email !== undefined && normal(patch.email) !== oldEmail) {
    const to = normal(patch.email);
    const other = await customerByEmail(tx, storeId, to);
    if (other && other !== customerId) return { ok: false, problem: { code: "taken" } };
    if ((await tagsTogether(tx, storeId, oldEmail, to)) > TAGS_PER_PERSON) return { ok: false, problem: { code: "tags" } };
    await tx.execute(sql`
      update commerce.customers set email = ${to}, email_verified_at = null, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${customerId}::uuid
    `);
    await moveTags(tx, storeId, oldEmail, to);
    await tx.execute(sql`update commerce.customer_notes set email = ${to} where store_id = ${storeId}::uuid and email = ${oldEmail}`);
  }
  if (patch.name !== undefined || patch.phone !== undefined || patch.company !== undefined) {
    await tx.execute(sql`
      update commerce.customers set
        name = ${patch.name === undefined ? sql`name` : sql`${patch.name}`},
        phone = ${patch.phone === undefined ? sql`phone` : sql`${patch.phone}`},
        company_name = ${patch.company === undefined ? sql`company_name` : sql`${patch.company?.name ?? ""}`},
        organisation_number = ${patch.company === undefined ? sql`organisation_number` : sql`${patch.company?.number ?? ""}`},
        updated_at = now()
      where store_id = ${storeId}::uuid and id = ${customerId}::uuid
    `);
  }
  if (patch.address) {
    const saved = await saveDefaultAddressIn(tx, storeId, customerId, patch.address);
    if (!saved.ok) return { ok: false, problem: { code: saved.reason === "too_many" ? "addresses" : "not_found" } };
  }
  const after = (await snapshot(tx, storeId, customerId))!;
  return { ok: true, before, after };
}

const homeCountry = (member: Membership): string | null => member.store.markets[0]?.code?.toUpperCase() ?? null;

/** A form's fields, cleaned and checked (`cleanCustomerInput()`): the organisation number by the address's country, else the store's own. */
const cleaned = (member: Membership, raw: RawCustomerInput) => cleanCustomerInput(raw, organisationNumber, homeCountry(member));

/** Staff add a customer (`customers:write`): refused when the email is already a customer of the store. Audited without the values. */
export async function createCustomer(member: Membership, raw: RawCustomerInput): Promise<StaffResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: { code: "forbidden" } };
  const input = cleaned(member, raw);
  if (!input.ok) return { ok: false, problem: input.problem };
  const storeId = member.store.id;
  let result: { made: StaffResult & { ok: true }; after: Record<string, unknown> | null };
  try {
    result = await db().transaction(async (tx) => {
      const made = await createCustomerIn(tx, storeId, input.input);
      // A refusal after the account was written (an address that would not fit) undoes it.
      if (!made.ok) throw new Refused(made.problem);
      return { made, after: await snapshot(tx, storeId, made.id) };
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, problem: error.problem };
    throw error;
  }
  await auditChange(member, "customer.created", { type: "customer", id: result.made.id }, null, result.after, "customer", { source: "staff" });
  return result.made;
}

/** Staff change a customer's name, email, phone, address and company (`customers:write`), the form's whole state. Audited without the values. */
export async function updateCustomer(member: Membership, customerId: string, raw: RawCustomerInput): Promise<StaffResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: { code: "forbidden" } };
  const input = cleaned(member, raw);
  if (!input.ok) return { ok: false, problem: input.problem };
  const storeId = member.store.id;
  const { email, name, phone, address, company } = input.input;
  let result: { ok: true; before: Record<string, unknown>; after: Record<string, unknown> };
  try {
    result = await db().transaction(async (tx) => {
      const done = await updateCustomerIn(tx, storeId, customerId, { email, name, phone, address, company });
      // A refusal after a write (an address that would not fit) undoes the transaction's writes.
      if (!done.ok) throw new Refused(done.problem);
      return done;
    });
  } catch (error) {
    if (error instanceof Refused) return { ok: false, problem: error.problem };
    throw error;
  }
  await auditChange(member, "customer.updated", { type: "customer", id: customerId }, result.before, result.after, "customer", { source: "staff" });
  return { ok: true, id: customerId };
}

/** Staff make an account for a guest (a person with paid orders and no account), by the guest's own address read on the server. */
export async function addGuestAsCustomer(member: Membership, key: string): Promise<StaffResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: { code: "forbidden" } };
  const ref = await findCustomer(member.store.id, key);
  if (!ref) return { ok: false, problem: { code: "not_found" } };
  if (ref.customerId) return { ok: true, id: ref.customerId };
  return createCustomer(member, { email: ref.email });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export type CustomerNote = { id: string; body: string; createdAt: string; author: string | null; mine: boolean };

/** The notes on a person (by their address), newest first, with who wrote each (a staff account's name, else its email) and when. */
export async function notesOf(storeId: string, email: string, viewerId: string | null = null): Promise<CustomerNote[]> {
  const rows = await db().execute<Row>(sql`
    select n.id, n.body, n.created_at, n.created_by, coalesce(nullif(a.name, ''), a.email) as author
    from commerce.customer_notes n left join commerce.accounts a on a.id = n.created_by
    where n.store_id = ${storeId}::uuid and n.email = ${normal(email)}
    order by n.created_at desc, n.id
  `);
  return rows.map((r) => ({
    id: String(r.id),
    body: String(r.body),
    createdAt: new Date(String(r.created_at)).toISOString(),
    author: r.author ? String(r.author) : null,
    mine: viewerId !== null && r.created_by !== null && String(r.created_by) === viewerId,
  }));
}

export type NoteResult = { ok: true; id: string } | { ok: false; problem: "empty" | "too_long" | "forbidden" | "not_found" };

/** Staff add a note on a person (`customers:write`), found by the customer page's key; the words are audited only as an entry, never quoted. */
export async function addNote(member: Membership, key: string, raw: unknown): Promise<NoteResult> {
  if (!memberCan(member, WRITE)) return { ok: false, problem: "forbidden" };
  const body = cleanNote(raw);
  if (body === "") return { ok: false, problem: "empty" };
  if (body.length > CUSTOMER_NOTE_MAX) return { ok: false, problem: "too_long" };
  const ref = await findCustomer(member.store.id, key);
  if (!ref) return { ok: false, problem: "not_found" };
  const [row] = await db().execute<Row>(sql`
    insert into commerce.customer_notes (store_id, email, body, created_by)
    values (${member.store.id}::uuid, ${ref.email}, ${body}, ${member.account.id}::uuid)
    returning id
  `);
  const id = String(row.id);
  await audit(member.account.id, member.store.id, "customer.note_added", { note: id, length: body.length }, { area: "customers", target: { type: "customer", id: ref.key } });
  return { ok: true, id };
}

/** Staff delete a note on a person (`customers:write`): only a note of that person in this store. */
export async function deleteNote(member: Membership, key: string, noteId: string): Promise<boolean> {
  if (!memberCan(member, WRITE)) return false;
  const ref = await findCustomer(member.store.id, key);
  if (!ref) return false;
  const gone = await db().execute<Row>(sql`
    delete from commerce.customer_notes where store_id = ${member.store.id}::uuid and email = ${ref.email} and id = ${noteId}::uuid returning id
  `);
  if (!gone[0]) return false;
  await audit(member.account.id, member.store.id, "customer.note_deleted", { note: noteId }, { area: "customers", target: { type: "customer", id: ref.key } });
  return true;
}

/** What the edit form starts from: the account's details as they are (the address its default one), or null for no such customer. */
export async function staffFormValues(storeId: string, customerId: string): Promise<{
  email: string; name: string; phone: string; line1: string; line2: string; postalCode: string; city: string; country: string; companyName: string; organisationNumber: string;
} | null> {
  const [row] = await db().execute<Row>(sql`
    select email, name, phone, address, company_name, organisation_number from commerce.customers
    where store_id = ${storeId}::uuid and id = ${customerId}::uuid
  `);
  if (!row) return null;
  const a = (row.address ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    email: text(row.email),
    name: text(row.name),
    phone: text(row.phone),
    line1: text(a.line1),
    line2: text(a.line2),
    postalCode: text(a.postalCode),
    city: text(a.city),
    country: text(a.country),
    companyName: text(row.company_name),
    organisationNumber: text(row.organisation_number),
  };
}
