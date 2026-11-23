import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const { formReport, recordFormSeen } = await import("./form-views");

type Row = Record<string, unknown>;

/**
 * A popup's own report (email plan M4.3) against a real database: a form seen is counted once per call for its own store, never for a
 * robot, a privacy signal, another store or an archived form; the report adds each form's views and answers over 30 days.
 */

const run = Date.now().toString(36);
let storeId: string;
let otherId: string;
let formId: string;
const person = new Headers({ "user-agent": "Mozilla/5.0 (iPhone) AppleWebKit Safari" });

async function newStore(name: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${name}-${run}@example.com`}, 'Kari', 'Skjema') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${name}-${run}`}, 'Skjema', null) as id`);
  return String(store.id);
}

beforeAll(async () => {
  storeId = await newStore("seen");
  otherId = await newStore("seen-other");
  const [form] = await db().execute<Row>(sql`insert into commerce.forms (store_id, kind, name) values (${storeId}::uuid, 'message', 'Kontakt') returning id`);
  formId = String(form.id);
});

afterAll(async () => {
  await closeDb();
});

describe("a popup's own report (M4.3)", () => {
  it("counts a person's view of the store's own active form, and nothing else", async () => {
    expect(await recordFormSeen(person, { store: storeId, form: formId })).toBe(true);
    expect(await recordFormSeen(person, { store: storeId, form: formId })).toBe(true);
    expect(await recordFormSeen(new Headers({ "user-agent": "Googlebot/2.1" }), { store: storeId, form: formId })).toBe(false);
    expect(await recordFormSeen(new Headers({ "user-agent": "Mozilla/5.0", "sec-gpc": "1" }), { store: storeId, form: formId })).toBe(false);
    expect(await recordFormSeen(person, { store: otherId, form: formId })).toBe(false);
    expect(await recordFormSeen(person, { store: storeId, form: "not-a-form" })).toBe(false);
    const [row] = await db().execute<Row>(sql`select sum(views)::int as n from commerce.form_view_counts where form_id = ${formId}::uuid`);
    expect(row.n).toBe(2);
    await db().execute(sql`update commerce.forms set status = 'archived' where id = ${formId}::uuid`);
    expect(await recordFormSeen(person, { store: storeId, form: formId })).toBe(false);
    await db().execute(sql`update commerce.forms set status = 'active' where id = ${formId}::uuid`);
  });

  it("reports each form's views and answers over 30 days", async () => {
    const report = await formReport(storeId);
    expect(report.get(formId)).toEqual({ views: 2, responses: 0 });
    expect((await formReport(otherId)).get(formId)).toBeUndefined();
  });
});
