import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { importBankStatement } = await import("./bank-statements");
const recurring = await import("./recurring-costs");

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

/**
 * A store's subscriptions (D503) against a real database: one added is known on its charges in the bank's statement, the waiting line
 * offered with it; a charge that comes back each month, not yet in the register, is offered to add; one changed and ended stays in the
 * register with its days. The register is the store's own: another store's never shows.
 */

const run = Date.now().toString(36);
afterAll(async () => closeDb());

async function books(tag: string): Promise<{ storeId: string; bookId: string; member: Membership }> {
  const name = `${tag}-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Abo') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Abo', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  const [book] = await db().execute<Row>(sql`
    insert into commerce.ledger_books (store_id, legal_name, country, currency, opened_on, opened_by)
    values (${storeId}::uuid, 'Abo AS', 'NO', 'NOK', '2026-08-01', ${String(owner.id)}::uuid) returning id`);
  const bookId = String(book.id);
  await db().execute(sql`
    insert into commerce.ledger_accounts (store_id, book_id, number, name, standard, kind)
    select ${storeId}::uuid, ${bookId}::uuid, n, 'Account ' || n, n::text, k from (values (1920, 'asset')) as a(n, k)`);
  return { storeId, bookId, member: { account: { id: String(owner.id) }, store: { id: storeId } } as unknown as Membership };
}

const entry = (ref: string, day: string, amount: string, words: string) =>
  `<Ntry><Amt Ccy="NOK">${amount}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${day}</Dt></BookgDt><AcctSvcrRef>${run}-${ref}</AcctSvcrRef><AddtlNtryInf>${words}</AddtlNtryInf></Ntry>`;

describe("subscriptions (D503)", () => {
  it("knows a subscription's charges, offers one that comes back each month, and keeps one changed and ended", async () => {
    const { storeId, bookId, member } = await books("abo");
    const camt = `<?xml version="1.0" encoding="UTF-8"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
      <Acct><Id><IBAN>NO9386011117947</IBAN></Id><Ccy>NOK</Ccy></Acct>
      ${entry("a1", "2026-09-04", "2190.00", "Varekjøp *4321 ANTHROPIC USD 200,00 Kurs 10,95")}
      ${entry("a2", "2026-10-04", "2214.00", "Varekjøp *4321 ANTHROPIC USD 200,00 Kurs 11,07")}
      ${entry("s1", "2026-08-03", "260.00", "Varekjøp *4321 SUPABASE INC USD 25,00")}
      ${entry("s2", "2026-09-03", "258.00", "Varekjøp *4321 SUPABASE INC USD 25,00")}
      ${entry("s3", "2026-10-03", "256.00", "Varekjøp *4321 SUPABASE INC USD 25,00")}
    </Stmt></BkToCstmrStmt></Document>`;
    expect(await importBankStatement(member, { name: "konto.xml", bytes: new TextEncoder().encode(camt) })).toMatchObject({ ok: true, newLines: 5 });

    const claude = { name: "Claude Max", matchText: "ANTHROPIC", kind: "software" as const, vatRate: 0 as const, abroad: true, every: "month" as const, amountMinor: 220_000, startedOn: "2026-01-01" };
    const added = await recurring.saveRecurringCost(member, claude, "NOK");
    expect(added).toEqual({ ok: true, id: expect.any(String) });
    if (!added.ok) return;

    const view = await recurring.recurringView(storeId, bookId, "2026-11-08");
    expect(view.rows.map((r) => [r.cost.name, r.lastDay, r.lastMinor, r.nextDay, r.late])).toEqual([["Claude Max", "2026-10-04", 221_400, "2026-11-04", false]]);
    expect(view.monthlyMinor).toBe(220_000);
    // Both of its lines wait for their receipts, and each is offered as Claude Max.
    const [a2] = await db().execute<Row>(sql`select id from commerce.bank_lines where book_id = ${bookId}::uuid and line_key = ${`ref:${run}-a2`}`);
    expect(view.charges.get(String(a2.id))?.name).toBe("Claude Max");
    expect(view.charges.size).toBe(2);
    expect(view.likely).toEqual([{ matchText: "supabase", name: "Supabase", amountMinor: 25_800, firstDay: "2026-08-03", lastDay: "2026-10-03", count: 3 }]);

    // Changed: a year's plan; ended: not running, and costs nothing a month.
    expect(await recurring.saveRecurringCost(member, { ...claude, every: "year", amountMinor: 2_400_000 }, "NOK", added.id)).toEqual({ ok: true, id: added.id });
    expect(await recurring.saveRecurringCost(member, claude, "NOK", crypto.randomUUID())).toEqual({ ok: false, problem: "not_found" });
    expect(await recurring.endRecurringCost(member, added.id, "2025-12-31")).toEqual({ ok: false, problem: "day" });
    expect(await recurring.endRecurringCost(member, added.id, "2026-11-08")).toEqual({ ok: true });
    expect(await recurring.endRecurringCost(member, added.id, "2026-11-09")).toEqual({ ok: false, problem: "not_found" });
    const after = await recurring.recurringView(storeId, bookId, "2026-11-20");
    expect(after.rows.map((r) => [r.cost.every, r.cost.amountMinor, r.running, r.cost.endedOn])).toEqual([["year", 2_400_000, false, "2026-11-08"]]);
    expect(after.monthlyMinor).toBe(0);

    // The database holds what the form may not: VAT back on a purchase abroad, an end before the start.
    await expect(db().execute(sql`update commerce.recurring_costs set vat_rate = 25 where id = ${added.id}::uuid`)).rejects.toThrow();
    await expect(db().execute(sql`update commerce.recurring_costs set ended_on = '2025-01-01' where id = ${added.id}::uuid`)).rejects.toThrow();

    // Another store's register is its own.
    const other = await books("abo2");
    expect(await recurring.recurringCosts(other.storeId)).toEqual([]);
    expect(await recurring.endRecurringCost(other.member, added.id, "2026-11-08")).toEqual({ ok: false, problem: "not_found" });

    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action like 'work.recurring_cost_%'`);
    expect(audited.n).toBe(3);
  });
});
