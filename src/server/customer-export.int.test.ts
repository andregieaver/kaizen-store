import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { customerColumns } from "@/lib/customer-csv";
import { parseCsv } from "@/lib/csv";

import { auditOf, depsWith, fakeStorage, jobRow, membersOf, rowsOfCsv, runToEnd, textOf } from "./data-test-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const fixture = await import("./invoice-test-fixture");
const { buildSubject, SECRETS } = await import("./privacy-fixture");
const jobs = await import("./data-jobs");
const fields = await import("./custom-fields");
const entities = await import("./field-entities");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

/**
 * The customer export (D165, `docs/wave-2-data.md` 2.4, 2.5, 4.3, 6.3): one row per customer as the Customers page lists them (an account, or a guest
 * with a paid order), one per email whatever its case, nobody who is only in a copy's orders or an erased person's order, the custom fields staff
 * entered read for a whole batch in one query and equal to `customerFieldExport()`, `marketing_consent` always `not_recorded` (Kaizen records no consent
 * yet), the unsubscribe list as `email_opt_out`, nothing that opens an account, owner only, only the store's own.
 */

let fx: Awaited<ReturnType<typeof fixture.makeStore>>;
let rival: Awaited<ReturnType<typeof fixture.makeStore>>;
let subject: Awaited<ReturnType<typeof buildSubject>>;
let rivalSubject: Awaited<ReturnType<typeof buildSubject>>;
let members: Awaited<ReturnType<typeof membersOf>>;

beforeAll(async () => {
  fx = await fixture.makeStore("cexp");
  rival = await fixture.makeStore("cexp2");
  subject = await buildSubject(fx, "client");
  rivalSubject = await buildSubject(rival, "client");
  members = await membersOf(fx);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

async function fileOf(raw: Record<string, unknown> = {}, who = members.owner): Promise<{ header: string[]; rows: Record<string, string>[]; csv: string }> {
  const result = await jobs.requestCustomerExport(who, { dialect: "standard", ...raw });
  if (!result.ok || result.mode !== "file") throw new Error(`file: ${JSON.stringify(result)}`);
  const parsed = rowsOfCsv(result.csv);
  return { header: parsed[0], rows: parsed.slice(1).map((r) => Object.fromEntries(parsed[0].map((h, i) => [h, r[i] ?? ""]))), csv: result.csv };
}

describe("the file of customers", () => {
  it("has a row for the account with its details, its group and company, and the fields staff entered", async () => {
    const { header, rows } = await fileOf();
    const store = (await getStore(fx.slug))!;
    expect(header).toEqual(customerColumns(await entities.customerCsvFields(fx.storeId)));
    const mine = rows.find((r) => r.email === subject.email)!;
    expect(mine).toMatchObject({ customer_id: subject.customerId, account: "verified", company_name: "Fjord Mat AS", organisation_number: "912345678", company_role: "employee", address_line1: "Kirkeveien 5", address_postal_code: "0368", address_city: "Oslo", address_country: "NO", locale: "nb-NO", copied: "false" });
    expect(mine.name).toContain("Kari Nordmann");
    expect(mine.customer_group).toMatch(/Friends/);
    expect(Number(mine.orders_paid)).toBeGreaterThanOrEqual(3);
    expect(mine.last_order_at).toMatch(/Z$/);
    expect(mine.created_at).toMatch(/Z$/);
    // The staff field, equal to what the data-subject export reads for the same customer.
    const reads = await entities.customerFieldExport(store, subject.customerId);
    expect(reads).toHaveLength(1);
    expect(mine["field:note"]).toBe(reads[0].value);
    expect(mine["field:note"]).toContain("Prefers small packages");
  });

  it("is one row per email, whatever its case, and a guest is one with a paid order", async () => {
    await fixture.paidOrder(fx, [["DEMO-MUG-WHITE", 1]], { email: "Guest.Person@Example.com" });
    await fixture.paidOrder(fx, [["DEMO-MUG-WHITE", 2]], { email: "guest.person@example.com" });
    await fixture.paidOrder(fx, [["DEMO-MUG-WHITE", 1]], { email: "never.paid@example.com", pay: false });
    const { rows } = await fileOf();
    const guests = rows.filter((r) => r.email.toLowerCase() === "guest.person@example.com");
    expect(guests).toHaveLength(1);
    expect(guests[0]).toMatchObject({ account: "none", customer_id: "", orders_paid: "2", address_city: "Oslo" });
    // Nobody who only started a checkout is a customer.
    expect(rows.some((r) => r.email === "never.paid@example.com")).toBe(false);
    // Emails are not repeated.
    const lower = rows.map((r) => r.email.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it("leaves out the person of an erased order and the people who are only in a copy's history, and marks a copied account", async () => {
    const erased = await fixture.paidOrder(fx, [["DEMO-MUG-WHITE", 1]], { email: "erased.person@example.com" });
    await db().execute(sql`update commerce.orders set restricted_at = now() where id = ${erased.orderId}::uuid`);
    const [copy] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name, copied_from) values (${fx.storeId}::uuid, 'copied.account@example.com', 'Copied Account', gen_random_uuid()) returning id`);
    const { rows, csv } = await fileOf();
    expect(csv).not.toContain("erased.person@example.com");
    // The history copied from another store (a `C-` order) makes nobody a customer by itself.
    expect(rows.find((r) => r.email === "copied.account@example.com")).toMatchObject({ copied: "true", account: "unverified", orders_paid: "0" });
    void copy;
  });

  it("says plainly that no consent is recorded, and marks the people on the store's unsubscribe list", async () => {
    const { rows } = await fileOf();
    expect(new Set(rows.map((r) => r.marketing_consent))).toEqual(new Set(["not_recorded"]));
    expect(rows.find((r) => r.email === subject.email)?.email_opt_out).toBe("true");
    expect(rows.find((r) => r.email === "guest.person@example.com" || r.email === "Guest.Person@Example.com")?.email_opt_out).toBe("false");
  });

  it("carries nothing that opens an account: no hash, auth id, session, sign-in code, avatar, referral code or token", async () => {
    const { header, csv } = await fileOf();
    const [referral] = await db().execute<Row>(sql`select code from commerce.affiliates where store_id = ${fx.storeId}::uuid limit 1`);
    const [auth] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name, auth_user_id, password_hash, avatar_path) values (${fx.storeId}::uuid, 'auth.person@example.com', 'Auth Person', gen_random_uuid(), 'scrypt$SECRET-HASH-CEXP', ${`${fx.storeId}/avatar-cexp.webp`}) returning auth_user_id`);
    const again = await fileOf();
    for (const secret of [SECRETS.passwordHash, "SECRET-HASH-CEXP", `${fx.storeId}/avatar-1g.webp`, `${fx.storeId}/avatar-cexp.webp`, String(referral.code), String(auth.auth_user_id), "codehash", SECRETS.manageToken, SECRETS.downloadToken, SECRETS.clientSecret]) {
      expect(again.csv, secret).not.toContain(secret);
    }
    expect(csv).not.toContain("session");
    expect(header.join(" ")).not.toMatch(/secret|token|password|hash|session|avatar|referral|auth/i);
  });

  it("makes formula characters harmless and keeps the Excel (Nordic) dialect's semicolons and byte order mark", async () => {
    await db().execute(sql`update commerce.customers set name = '=cmd|calc', company_name = '@SUM(1)', phone = '+4711111111' where id = ${subject.customerId}::uuid`);
    const standard = await fileOf();
    expect(standard.csv).toContain("'=cmd|calc");
    const raw = parseCsv(standard.csv).rows;
    expect(raw.flatMap((r) => r.filter((c) => /^[=+\-@\t\r\n]/.test(c) && !/^-?\d+([.,]\d+)?$/.test(c)))).toEqual([]);
    const nordic = await jobs.requestCustomerExport(members.owner, { dialect: "excel_nordic" });
    if (!nordic.ok || nordic.mode !== "file") throw new Error("file");
    expect(nordic.csv.charCodeAt(0)).toBe(0xfeff);
    expect(nordic.csv.split("\r\n")[0]).toContain(";");
  });
});

describe("only the store's own customers", () => {
  it("never holds another store's customers, and the other store's owner has theirs", async () => {
    const mine = await fileOf();
    expect(mine.csv).not.toContain(rivalSubject.email);
    const rivalOwner = (await membersOf(rival)).owner;
    const theirs = await fileOf({}, rivalOwner);
    expect(theirs.rows.some((r) => r.email === rivalSubject.email)).toBe(true);
    expect(theirs.rows.some((r) => r.email === subject.email)).toBe(false);
  });
});

describe("custom fields are read in a batch", () => {
  it("asks once for each batch of customers, never once for each customer", async () => {
    // 700 more customers: two batches of 500 rows in all, each asking for its fields once.
    await db().execute(sql`
      insert into commerce.customers (store_id, email, name)
      select ${fx.storeId}::uuid, 'batch-' || n || '@example.com', 'Batch ' || n from generate_series(1, 700) n
    `);
    const spy = vi.spyOn(fields, "getFieldDataMany");
    try {
      const { rows } = await fileOf();
      expect(rows.length).toBeGreaterThan(700);
      const customerCalls = spy.mock.calls.filter((c) => c[1] === "customer");
      expect(customerCalls.length).toBe(Math.ceil(rows.length / 500));
      for (const call of customerCalls) expect(call[2].length).toBeLessThanOrEqual(500);
    } finally {
      spy.mockRestore();
    }
    // The batch reader gives what the one-customer reader gives.
    const store = (await getStore(fx.slug))!;
    const many = await entities.customerFieldExportMany(store, [subject.customerId]);
    expect(many.get(subject.customerId)).toEqual(await entities.customerFieldExport(store, subject.customerId));
  });
});

describe("a large customer export is a job", () => {
  it("is made in parts for the owner, logged, never emailed, and the download is the owner's", async () => {
    await db().execute(sql`
      insert into commerce.customers (store_id, email, name)
      select ${fx.storeId}::uuid, 'more-' || n || '@example.com', 'More ' || n from generate_series(1, 1400) n
    `);
    const storage = fakeStorage();
    const sent: { kind: string; attachments?: unknown; html: string }[] = [];
    const deps = depsWith(storage, { batchRows: 400, partRows: 1000, send: async (m) => (sent.push({ kind: m.kind, attachments: m.attachments, html: m.email.html }), "logged") });
    const started = await jobs.requestCustomerExport(members.owner, { dialect: "standard" }, deps);
    expect(started.ok && started.mode).toBe("job");
    if (!started.ok || started.mode !== "job") return;
    expect(await runToEnd(started.jobId, deps)).toBe("done");
    const files = (await jobRow(started.jobId)).files as { path: string; rows: number }[];
    expect(files.length).toBeGreaterThan(1);
    const emails = files.flatMap((f) => rowsOfCsv(textOf(storage, "exports", f.path)).slice(1).map((r) => r[1]));
    expect(new Set(emails.map((e) => e.toLowerCase())).size).toBe(emails.length);
    expect(emails).toContain(subject.email);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "data_job.ready" });
    expect(sent[0].attachments).toBeUndefined();
    expect(sent[0].html).toContain(`/customers/export?job=${started.jobId}`);
    expect((await auditOf(fx.storeId, "customer.exported")).some((e) => (e.details as { job?: string }).job === started.jobId)).toBe(true);
    const got = await jobs.downloadPart(members.owner, started.jobId, 0, deps);
    expect(got.ok).toBe(true);
    expect((await auditOf(fx.storeId, "customer.export_downloaded")).length).toBeGreaterThan(0);
    // Not for a member who is not the owner.
    expect(await jobs.downloadPart(members.admin, started.jobId, 0, deps)).toMatchObject({ ok: false });
    expect(await jobs.requestCustomerExport(members.admin, {})).toMatchObject({ ok: false, code: "forbidden" });
    // The audit entry holds counts, never an email or a name.
    expect(JSON.stringify((await auditOf(fx.storeId, "customer.exported")).map((e) => e.details))).not.toMatch(/@example\.com|Kari|Nordmann/);
  }, 120_000);
});

