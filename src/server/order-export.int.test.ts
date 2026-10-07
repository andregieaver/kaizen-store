import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { convertMinor } from "@/lib/currency";
import { orderColumns, PERSONAL_ORDER_COLUMNS } from "@/lib/order-csv";
import { parseCsv } from "@/lib/csv";

import { auditOf, depsWith, fakeStorage, jobRow, membersOf, rowsOfCsv, runToEnd, textOf } from "./data-test-support";
import { storeToday } from "./test-days";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const fixture = await import("./invoice-test-fixture");
const { buildSubject, SECRETS } = await import("./privacy-fixture");
const jobs = await import("./data-jobs");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

/**
 * The order export (D165, `docs/wave-2-data.md` 2.3, 4.2, 6.2): a date range by the store's days or a pasted selection, a row per line with the order's
 * amounts on its first row, the order's own currency and the main currency, the VAT split out as stored, copied history left out unless asked and always
 * marked, host orders marked, an erased person's order without any personal field, a large export as a job delivered by a signed address, never emailed,
 * only the owner's, only the store's, and nothing in the file that opens something (a secret, a token, the order page's key).
 */

let fx: Awaited<ReturnType<typeof fixture.makeStore>>;
let rival: Awaited<ReturnType<typeof fixture.makeStore>>;
let subject: Awaited<ReturnType<typeof buildSubject>>;
let rivalSubject: Awaited<ReturnType<typeof buildSubject>>;
let members: Awaited<ReturnType<typeof membersOf>>;
let rivalMembers: Awaited<ReturnType<typeof membersOf>>;

beforeAll(async () => {
  fx = await fixture.makeStore("oexp");
  rival = await fixture.makeStore("oexp2");
  subject = await buildSubject(fx, "buyer");
  rivalSubject = await buildSubject(rival, "buyer");
  members = await membersOf(fx);
  rivalMembers = await membersOf(rival);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const today = () => storeToday();
const range = (extra: Record<string, unknown> = {}) => ({ mode: "range", from: "2020-01-01", to: today(), dialect: "standard", ...extra });

async function fileOf(raw: Record<string, unknown>, who = members.owner): Promise<{ header: string[]; rows: Record<string, string>[]; csv: string }> {
  const result = await jobs.requestOrderExport(who, raw);
  if (!result.ok || result.mode !== "file") throw new Error(`file: ${JSON.stringify(result)}`);
  const parsed = rowsOfCsv(result.csv);
  const header = parsed[0];
  return { header, rows: parsed.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]))), csv: result.csv };
}

/** "1234.50" as 123450 (the standard dialect writes a point and two digits). */
const minor = (text: string): number => (text === "" ? 0 : Math.round(Number(text) * 100));

describe("the file of orders", () => {
  it("is one row per order line with the contract's columns, the order's amounts on its first row only", async () => {
    const { header, rows } = await fileOf(range());
    expect(header).toEqual(orderColumns("lines", "accounting"));
    const signedIn = rows.filter((r) => r.order_number === subject.ids.signedInOrder.number);
    expect(signedIn).toHaveLength(subject.ids.signedInOrder.lines.length);
    expect(signedIn[0].total).not.toBe("");
    for (const continuation of signedIn.slice(1)) {
      expect(continuation.total).toBe("");
      expect(continuation.tax_total).toBe("");
    }
    expect(signedIn[0]).toMatchObject({ currency: "NOK", market: "NO", status: "paid", payment_status: "captured", copied: "false", host_order: "false", line_number: "1", sku: "DEMO-MUG-WHITE", quantity: "2" });
    expect(signedIn[0].placed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(signedIn[0].placed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Only the paid orders by default: the order nobody paid for is not in it.
    expect(rows.some((r) => r.order_number === subject.ids.unpaidOrder.number)).toBe(false);
  });

  it("holds the VAT split of every order: the lines' VAT plus the shipping's is the order's, and goods less discounts plus shipping is the total", async () => {
    const { rows } = await fileOf(range());
    const orders = new Map<string, Record<string, string>[]>();
    for (const r of rows) orders.set(r.order_number, [...(orders.get(r.order_number) ?? []), r]);
    expect(orders.size).toBeGreaterThan(3);
    for (const [number, lines] of orders) {
      const first = lines[0];
      const lineTax = lines.reduce((n, l) => n + minor(l.line_tax), 0);
      expect(lineTax + minor(first.shipping_vat), number).toBe(minor(first.tax_total));
      expect(minor(first.subtotal) - minor(first.discount_total) + minor(first.shipping), number).toBe(minor(first.total));
      // Net and VAT of a line add up to what the line cost.
      for (const l of lines) expect(minor(l.line_net) + minor(l.line_tax), `${number} ${l.line_number}`).toBe(minor(l.line_total));
    }
  });

  it("gives the order's own currency and the main currency at the store's rate, and says so when there is no rate", async () => {
    const euro = subject.ids.euroOrder;
    const { rows } = await fileOf(range());
    const row = rows.find((r) => r.order_number === euro.number)!;
    expect(row).toMatchObject({ currency: "EUR", main_currency: "NOK", main_rate: "11.5", main_converted: "true" });
    const store = (await getStore(fx.slug))!;
    // The amounts are in euro as the order was charged; the main-currency ones are the store's own conversion of them.
    expect(minor(row.total)).toBe(euro.total);
    expect(minor(row.total_main)).toBe(convertMinor(euro.total, "EUR", "NOK", store.localization.rates));
    expect(minor(row.tax_total_main)).toBe(convertMinor(euro.tax, "EUR", "NOK", store.localization.rates));
    // An order in a currency the store has no rate for: its own amounts are there, the main-currency columns are not, and the file says why.
    await db().execute(sql`update commerce.orders set currency = 'SEK' where id = ${subject.ids.guestOrder.orderId}::uuid`);
    const again = await fileOf(range());
    const sek = again.rows.find((r) => r.order_number === subject.ids.guestOrder.number)!;
    expect(sek).toMatchObject({ currency: "SEK", main_converted: "no_rate", main_rate: "", total_main: "", subtotal_main: "" });
    expect(sek.total).not.toBe("");
    await db().execute(sql`update commerce.orders set currency = 'NOK' where id = ${subject.ids.guestOrder.orderId}::uuid`);
  });

  it("counts each order's refunds that succeeded and no others", async () => {
    const order = subject.ids.signedInOrder;
    const [payment] = await db().execute<Row>(sql`select id from commerce.payments where store_id = ${fx.storeId}::uuid and order_id = ${order.orderId}::uuid and status = 'captured' limit 1`);
    await db().execute(sql`insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status) values (${fx.storeId}::uuid, ${String(payment.id)}::uuid, 700, 'x', 'failed'), (${fx.storeId}::uuid, ${String(payment.id)}::uuid, 300, 'x', 'pending')`);
    const { rows } = await fileOf(range());
    const row = rows.find((r) => r.order_number === order.number)!;
    // The one refund that succeeded (1,000 øre of the fixture), not the failed or the pending ones.
    expect(row).toMatchObject({ refunded: "10.00", refund_count: "1" });
    expect(row.last_refund_at).toMatch(/Z$/);
  });

  it("leaves copied history out unless asked, and then marks it; a host's order is in and marked with the commission", async () => {
    const copied = await db().execute<Row>(sql`select number from commerce.orders where id = ${subject.ids.copiedOrder}::uuid`);
    const number = String(copied[0].number);
    expect(number.startsWith("C-")).toBe(true);
    const without = await fileOf(range());
    expect(without.rows.some((r) => r.order_number === number)).toBe(false);
    const withCopies = await fileOf(range({ copied: "true" }));
    const row = withCopies.rows.find((r) => r.order_number === number)!;
    expect(row.copied).toBe("true");
    const host = withCopies.rows.find((r) => r.host_order === "true")!;
    expect(host.order_number).toBeDefined();
    expect(without.rows.some((r) => r.host_order === "true")).toBe(true);
  });

  it("marks an order paid in Stripe's test mode (test_payment), as invoices and the VAT reports treat it, and leaves live orders unmarked", async () => {
    const test = subject.ids.guestOrder;
    const account = `acct_oexpTest${Date.now()}`;
    await db().execute(sql`
      insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
      values (${fx.storeId}::uuid, 'test', ${account}, 'active', false)
      on conflict (store_id, mode) do update set account_id = excluded.account_id
    `);
    await db().execute(sql`update commerce.payments set provider_account = ${account} where order_id = ${test.orderId}::uuid`);
    try {
      const { rows } = await fileOf(range());
      const mine = rows.filter((r) => r.order_number === test.number);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((r) => r.test_payment === "true")).toBe(true);
      // Still in the file (marked, never left out) and the live order next to it is not marked.
      expect(rows.filter((r) => r.order_number === subject.ids.signedInOrder.number).every((r) => r.test_payment === "false")).toBe(true);
      // It is the same test the invoices use.
      const [eligibility] = await db().execute<Row>(sql`select commerce.invoice_eligibility(${test.orderId}::uuid) as e`);
      expect(String(eligibility.e)).toBe("test_mode");
    } finally {
      await db().execute(sql`update commerce.payments set provider_account = null where order_id = ${test.orderId}::uuid`);
      await db().execute(sql`delete from commerce.stripe_accounts where store_id = ${fx.storeId}::uuid and mode = 'test' and account_id = ${account}`);
    }
  });

  it("is the orders of a range of the store's days: an order just after midnight in Oslo is the next day's", async () => {
    // 2026-03-10 22:30 UTC is 23:30 on the 10th in Oslo; 23:30 UTC is 00:30 on the 11th.
    const a = subject.ids.signedInOrder.orderId;
    const b = subject.ids.guestOrder.orderId;
    await db().execute(sql`update commerce.orders set placed_at = '2026-03-10T22:30:00Z' where id = ${a}::uuid`);
    await db().execute(sql`update commerce.orders set placed_at = '2026-03-10T23:30:00Z' where id = ${b}::uuid`);
    const tenth = await fileOf(range({ from: "2026-03-10", to: "2026-03-10" }));
    const eleventh = await fileOf(range({ from: "2026-03-11", to: "2026-03-11" }));
    expect(new Set(tenth.rows.map((r) => r.order_number))).toEqual(new Set([subject.ids.signedInOrder.number]));
    expect(new Set(eleventh.rows.map((r) => r.order_number))).toEqual(new Set([subject.ids.guestOrder.number]));
    expect(tenth.rows[0].placed_on).toBe("2026-03-10");
    expect(eleventh.rows[0].placed_on).toBe("2026-03-11");
    // Both days together are both orders.
    expect(new Set((await fileOf(range({ from: "2026-03-10", to: "2026-03-11" }))).rows.map((r) => r.order_number)).size).toBe(2);
    await db().execute(sql`update commerce.orders set placed_at = now() - interval '3 days' where id in (${a}::uuid, ${b}::uuid)`);
  });

  it("is a pasted selection of order numbers, listing back the ones that are not the store's, even an unpaid or copied one", async () => {
    // Order numbers are per store (both stores have a 1001), so the number that is only the other store's is its copied order's.
    const [rivalCopied] = await db().execute<Row>(sql`select number from commerce.orders where id = ${rivalSubject.ids.copiedOrder}::uuid`);
    const rivalNumber = String(rivalCopied.number);
    const raw = { mode: "numbers", numbers: `${subject.ids.signedInOrder.number}, ${subject.ids.unpaidOrder.number}\n NOPE-1 ${rivalNumber}`, dialect: "standard" };
    const result = await jobs.requestOrderExport(members.owner, raw);
    expect(result.ok && result.mode).toBe("file");
    if (!result.ok || result.mode !== "file") return;
    expect(result.unknownNumbers.sort()).toEqual([rivalNumber, "NOPE-1"].sort());
    const numbers = new Set(rowsOfCsv(result.csv).slice(1).map((r) => r[0]));
    expect(numbers).toEqual(new Set([subject.ids.signedInOrder.number, subject.ids.unpaidOrder.number]));
    // None of them: a plain refusal.
    const none = await jobs.requestOrderExport(members.owner, { mode: "numbers", numbers: "NOPE-1", dialect: "standard" });
    expect(none).toMatchObject({ ok: false, code: "no_orders" });
    const check = await jobs.checkOrderNumbers(members.owner, `${subject.ids.guestOrder.number} NOPE-2`);
    expect(check).toMatchObject({ ok: true, found: [subject.ids.guestOrder.number], unknown: ["NOPE-2"], over: 0 });
  });

  it("is a row per order in the orders layout, with the number of lines", async () => {
    const { header, rows } = await fileOf(range({ layout: "orders" }));
    expect(header).toEqual(orderColumns("orders", "accounting"));
    expect(header).not.toContain("sku");
    const signedIn = rows.filter((r) => r.order_number === subject.ids.signedInOrder.number);
    expect(signedIn).toHaveLength(1);
    expect(signedIn[0].line_count).toBe(String(subject.ids.signedInOrder.lines.length));
  });

  it("writes the Excel (Nordic) dialect with semicolons, decimal commas and a byte order mark", async () => {
    const result = await jobs.requestOrderExport(members.owner, range({ dialect: "excel_nordic" }));
    if (!result.ok || result.mode !== "file") throw new Error("file");
    expect(result.csv.charCodeAt(0)).toBe(0xfeff);
    const lines = result.csv.split("\r\n");
    expect(lines[0].split(";").length).toBeGreaterThan(20);
    expect(lines.slice(1).some((l) => /;\d+,\d{2};/.test(l))).toBe(true);
  });
});

describe("personal data", () => {
  it("is not in the Accounting profile and is in the Full one, and a person who was erased has none in either", async () => {
    const accounting = await fileOf(range());
    for (const column of PERSONAL_ORDER_COLUMNS.filter((c) => c !== "company_name" && c !== "buyer_vat_number")) expect(accounting.header).not.toContain(column);
    expect(accounting.csv).not.toContain(subject.email);
    expect(accounting.csv).not.toContain("Kirkeveien");
    const full = await fileOf(range({ profile: "full" }));
    const mine = full.rows.find((r) => r.order_number === subject.ids.signedInOrder.number)!;
    expect(mine).toMatchObject({ email: subject.email, billing_name: expect.stringContaining("Kari"), billing_line1: "Kirkeveien 5", shipping_postal_code: "0368" });
    // The person is erased: the order is restricted (kept for the bookkeeping, cut loose from the person).
    await db().execute(sql`update commerce.orders set restricted_at = now(), customer_id = null where id = ${subject.ids.guestOrder.orderId}::uuid`);
    const after = await fileOf(range({ profile: "full" }));
    const erased = after.rows.find((r) => r.order_number === subject.ids.guestOrder.number)!;
    expect(erased.email).toBe("[removed]");
    expect(erased.billing_name).toBe("[removed]");
    expect(erased.shipping_line1).toBe("[removed]");
    expect(erased.shipping_phone).toBe("");
    // The country stays: it is the VAT's, and the order's sums stay.
    expect(erased.shipping_country).toBe("NO");
    expect(minor(erased.total)).toBe(subject.ids.guestOrder.total);
    await db().execute(sql`update commerce.orders set restricted_at = null where id = ${subject.ids.guestOrder.orderId}::uuid`);
  });

  it("carries no secret, token, hash, key or reference that opens something, in any profile or layout", async () => {
    const everything = [await fileOf(range({ profile: "full", copied: "true", which: "all" })), await fileOf(range({ profile: "full", layout: "orders", copied: "true", which: "all" }))];
    const forbidden = [
      SECRETS.passwordHash,
      SECRETS.clientSecret,
      SECRETS.manageToken,
      SECRETS.downloadToken,
      SECRETS.providerAccount,
      "SECRETSALT",
      // The order page's key is the payment's reference (the Checkout Session id), of every order.
      ...Object.values(subject.ids).flatMap((v) => (typeof v === "object" && v !== null && "sessionId" in v ? [(v as { sessionId: string }).sessionId] : [])),
      `${fx.storeId}/avatar-1g.webp`,
      fx.account,
    ];
    for (const f of everything) for (const secret of forbidden) expect(f.csv, secret).not.toContain(secret);
    // The cost of a sold unit is the store's own figure and is in the lines layout only, never the order page's.
    expect(everything[1].header).not.toContain("unit_cost_main");
    // The columns themselves: nothing named for a secret.
    for (const header of everything.map((f) => f.header)) expect(header.join(" ")).not.toMatch(/secret|token|password|hash|session|key|card/i);
  });
});

describe("formula characters", () => {
  it("are made harmless in every text cell, and amounts stay numbers", async () => {
    // A paid order's SKU changes only inside an order change (D174, `order_lines_settled_guard()`): the fixture sets the edit context for its own order to write one.
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('kaizen.order_edit', ${subject.ids.signedInOrder.orderId}, true)`);
      await tx.execute(sql`update commerce.order_lines set title = '=HYPERLINK("http://x")', sku = '-1+1' where order_id = ${subject.ids.signedInOrder.orderId}::uuid and sku = 'DEMO-MUG-WHITE'`);
    });
    await db().execute(sql`update commerce.orders set company_name = '+cmd|calc', billing_address = billing_address || '{"name": "@SUM(1)"}'::jsonb, discount_code = '=CODE' where id = ${subject.ids.signedInOrder.orderId}::uuid`);
    for (const dialect of ["standard", "excel_nordic"]) {
      const { csv } = await fileOf(range({ profile: "full", dialect }));
      const raw = parseCsv(csv, { delimiter: dialect === "standard" ? "," : ";" }).rows;
      const offending = raw.flatMap((r, i) => r.flatMap((c, j) => (/^[=+\-@\t\r\n]/.test(c) && !/^-?\d+([.,]\d+)?$/.test(c) ? [`${i}:${j}:${c}`] : [])));
      expect(offending, dialect).toEqual([]);
      expect(csv).toContain("'=HYPERLINK");
      expect(csv).toContain("'-1+1");
      expect(csv).toContain("'@SUM(1)");
    }
  });
});

describe("a large export is a job", () => {
  let big: Awaited<ReturnType<typeof fixture.makeStore>>;
  let bigOwner: Awaited<ReturnType<typeof membersOf>>["owner"];

  beforeAll(async () => {
    big = await fixture.makeStore("obig");
    bigOwner = (await membersOf(big)).owner;
    // 2,030 paid orders with a line each, made in one statement: more than a download takes.
    await db().execute(sql`
      with made as (
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at)
        select ${big.storeId}::uuid, commerce.next_document_number(${big.storeId}::uuid, 'order'), 'NO', 'NOK', 'nb-NO', 'big-' || n || '@example.com', 'paid', 10000, 0, 2000, 10000, '{}', '{}', now() - make_interval(mins => n)
        from generate_series(1, 2030) n returning id
      ),
      lines as (
        insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
        select ${big.storeId}::uuid, id, 'BIG-1', 'Big', 1, 10000, 10000, 2000, 0.25, 'general' from made returning order_id
      )
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      select ${big.storeId}::uuid, order_id, 'stripe', 'cs_big_' || order_id, 10000, 'NOK', 'captured' from lines
    `);
  }, 120_000);

  it("is delivered by a link to the signed-in owner, in parts, and not emailed: the ready email carries no file and no link that works unsigned", async () => {
    const storage = fakeStorage();
    const sent: { to: string; subject: string; html: string; text: string; attachments?: unknown; kind: string }[] = [];
    const deps = depsWith(storage, {
      batchRows: 500,
      partRows: 1200,
      send: async (message) => {
        sent.push({ to: message.to, subject: message.email.subject, html: message.email.html, text: message.email.text, attachments: message.attachments, kind: message.kind });
        return "logged";
      },
    });
    const started = await jobs.requestOrderExport(bigOwner, range({ from: "2020-01-01", to: today() }), deps);
    expect(started.ok && started.mode).toBe("job");
    if (!started.ok || started.mode !== "job") return;
    expect(await runToEnd(started.jobId, deps)).toBe("done");
    const done = await jobRow(started.jobId);
    const files = done.files as { path: string; name: string; rows: number; bytes: number; sha256: string }[];
    expect(files.length).toBe(2);
    expect(files.reduce((n, f) => n + f.rows, 0)).toBe(2030);
    for (const f of files) {
      const rows = rowsOfCsv(textOf(storage, "exports", f.path));
      expect(rows[0]).toEqual(orderColumns("lines", "accounting"));
      expect(rows.length - 1).toBe(f.rows);
    }
    // The orders of the file are the store's own and nothing else.
    const numbers = files.flatMap((f) => rowsOfCsv(textOf(storage, "exports", f.path)).slice(1).map((r) => r[0]));
    expect(new Set(numbers).size).toBe(2030);
    // One email, to the person who asked, naming the page and holding no file.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: bigOwner.account.email, kind: "data_job.ready" });
    expect(sent[0].attachments).toBeUndefined();
    expect(sent[0].html).toContain(`/admin/${big.slug}/orders/export?job=${started.jobId}`);
    expect(sent[0].html + sent[0].text).not.toMatch(/storage\.test|supabase|signed|token=|big-\d+@example/);
    expect(sent[0].text).not.toContain("BIG-1");
    // The audit entry of the made file is written (the job's), with counts only.
    const made = (await auditOf(big.storeId, "order.exported")).find((e) => (e.details as { job?: string }).job === started.jobId);
    expect(made?.details).toMatchObject({ rows: 2030, parts: 2 });
    // The download: a signed address of 60 seconds, made when the button is pressed and logged.
    expect(storage.signed).toHaveLength(0);
    const got = await jobs.downloadPart(bigOwner, started.jobId, 1, deps);
    expect(got.ok).toBe(true);
    expect(storage.signed.at(-1)).toMatchObject({ seconds: 60, path: files[1].path });
    expect((await auditOf(big.storeId, "order.export_downloaded")).some((e) => (e.details as { job?: string; part?: number }).job === started.jobId && (e.details as { part?: number }).part === 1)).toBe(true);
    expect(JSON.stringify((await auditOf(big.storeId, "order.export_downloaded")).map((e) => e.details))).not.toMatch(/@example\.com/);
    // The file expires in 7 days.
    const days = Math.round((new Date(String(done.expires_at)).getTime() - new Date(String(done.finished_at)).getTime()) / 86_400_000);
    expect(days).toBe(7);
  }, 120_000);

  it("is the owner's: a member without the owner key is refused the export, the job and the download", async () => {
    const bigMembers = await membersOf(big);
    expect(await jobs.requestOrderExport(bigMembers.admin, range())).toMatchObject({ ok: false, code: "forbidden" });
    const [job] = await db().execute<Row>(sql`select id from commerce.data_jobs where store_id = ${big.storeId}::uuid and kind = 'order_export' and status = 'done' limit 1`);
    expect(await jobs.jobFor(bigMembers.admin, String(job.id))).toBeNull();
    expect(await jobs.downloadPart(bigMembers.admin, String(job.id), 0, depsWith(fakeStorage()))).toMatchObject({ ok: false });
    expect(await jobs.checkOrderNumbers(bigMembers.admin, "X")).toMatchObject({ ok: false });
  });

  it("refuses an export of more than 500,000 rows before it starts, naming the limit", async () => {
    // The count is the store's own: this store has 2,030 rows, far below, so the refusal is shown on the pure side.
    const { EXPORT_MAX_ROWS } = await import("@/lib/data-limits");
    expect(EXPORT_MAX_ROWS).toBe(500_000);
    expect(jobs.EXPORT_PROBLEM_TEXT.too_big).toContain("500,000");
  });
});

describe("only the store's own orders", () => {
  it("never holds another store's order number or email, and another store's owner has a file of theirs", async () => {
    const mine = await fileOf(range({ profile: "full", copied: "true", which: "all" }));
    expect(mine.csv).not.toContain(rivalSubject.email);
    const [rivalCopied] = await db().execute<Row>(sql`select number from commerce.orders where id = ${rivalSubject.ids.copiedOrder}::uuid`);
    expect(mine.rows.some((r) => r.order_number === String(rivalCopied.number))).toBe(false);
    // The orders of the file are exactly the store's own, counted in its own table.
    const [own] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${fx.storeId}::uuid`);
    expect(new Set(mine.rows.map((r) => r.order_number)).size).toBe(Number(own.n));
    const theirs = await fileOf(range({ profile: "full" }), rivalMembers.owner);
    expect(theirs.csv).toContain(rivalSubject.email);
    expect(theirs.csv).not.toContain(subject.email);
  });
});

void SECRETS;
