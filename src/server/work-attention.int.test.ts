import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { attentionFor } from "@/lib/control-center";
import { addCalendarDays } from "@/lib/work-dates";

import type { Account } from "./auth";
import {
  issueReportInvoice,
  logReportTime,
  makeReportAssignment,
  makeReportClient,
  makeReportDraft,
  makeReportStore,
  reportToday,
  type ReportFixture,
} from "./work-reports-test-support";

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
  refresh: () => {},
}));
vi.mock("@/server/auth", () => ({
  requireMember: async () => {
    throw new Error("not used");
  },
  audit: async () => {},
}));

const center = await import("./control-center");
const attention = await import("./work-attention");

type Row = Record<string, unknown>;

/**
 * Work's items in the owner's control center (D107, docs/work.md 6.5) against a real database: the Work overview's
 * own attention items, for the stores that have the module on, counted for all stores together and only ever from
 * the store's own rows.
 */

afterAll(async () => {
  await closeDb();
});

const accountOf = async (f: ReportFixture): Promise<Account> => {
  const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where id = ${f.accountId}::uuid`);
  return { id: String(row.id), email: String(row.email), name: "Owner", platformAdmin: false };
};

/** Something overdue, old unbilled time and a draft left waiting, in a store. */
async function busyStore(tag: string, work = true): Promise<{ f: ReportFixture; today: string }> {
  const f = await makeReportStore(tag);
  const today = await reportToday(f);
  const client = await makeReportClient(f, { name: "Acme", rate: 100000 });
  const assignment = await makeReportAssignment(f, client, { name: "Website" });
  await issueReportInvoice(f, client, addCalendarDays(today, -40), [{ assignmentId: assignment, priceMinor: 100000 }]);
  await logReportTime(f, assignment, addCalendarDays(today, -45), 120);
  const { invoiceId } = await makeReportDraft(f, client, [{ assignmentId: null, priceMinor: 5000 }]);
  await db().execute(
    sql`update commerce.work_invoices set updated_at = now() - interval '10 days' where id = ${invoiceId}::uuid`,
  );
  if (!work) await db().execute(sql`update commerce.stores set modules = '{}' where id = ${f.storeId}::uuid`);
  return { f, today };
}

describe("Work in the control center", () => {
  let on: { f: ReportFixture; today: string };
  let off: { f: ReportFixture; today: string };
  let empty: ReportFixture;

  beforeAll(async () => {
    on = await busyStore("on");
    off = await busyStore("off", false);
    empty = await makeReportStore("nothing");
  });

  it("words what needs the owner in a store that uses Work, urgent first, pointing at its Work pages", async () => {
    const view = await center.controlCenter(await accountOf(on.f));
    expect(view.stores).toHaveLength(1);
    const work = view.stores[0].work!;
    const slug = on.f.slug;
    expect(work.map((i) => i.text)).toEqual([
      "Arbeid: 1 invoice is overdue, the oldest by 26 days.",
      "Arbeid: 2h of time has been unbilled for over 30 days.",
      "Arbeid: 1 invoice draft has been waiting for over 7 days.",
    ]);
    expect(work[0]).toMatchObject({ href: `/admin/${slug}/work/invoices?show=overdue`, action: "Open invoices", urgent: true });
    // "Invoice time" opens the list, where the new-invoice sheet is
    expect(work[1].href).toBe(`/admin/${slug}/work/invoices`);
    expect(work[2].href).toBe(`/admin/${slug}/work/invoices?show=drafts`);
    // and they are among the store's other items in the list
    const items = attentionFor(view.stores);
    expect(items.filter((i) => i.href.includes("/work"))).toHaveLength(3);
    expect(items[0].href).toBe(`/admin/${slug}/work/invoices?show=overdue`);
  });

  it("says nothing for a store that has Work switched off, whatever data it holds", async () => {
    const view = await center.controlCenter(await accountOf(off.f));
    expect(view.stores[0].work).toBeUndefined();
    expect(attentionFor(view.stores).some((i) => i.href.includes("/work"))).toBe(false);
  });

  it("says nothing when there is nothing to do", async () => {
    const view = await center.controlCenter(await accountOf(empty));
    expect(view.stores[0].work).toEqual([]);
    expect(attentionFor(view.stores).some((i) => i.href.includes("/work"))).toBe(false);
  });

  it("counts several stores together and keeps each store's items to its own", async () => {
    const stores = [on.f, empty].map((f) => ({ id: f.storeId, slug: f.slug, name: "Arbeid", timeZone: "Europe/Oslo" }));
    const items = await attention.workAttention(stores);
    expect(items.get(on.f.storeId)!).toHaveLength(3);
    expect(items.get(on.f.storeId)!.every((i) => i.href.startsWith(`/admin/${on.f.slug}/work`))).toBe(true);
    expect(items.get(empty.storeId)).toEqual([]);
    // a store not asked about is not in the answer, and no stores is no queries
    expect(items.has(off.f.storeId)).toBe(false);
    expect((await attention.workAttention([])).size).toBe(0);
  });

  it("is per store's day: the same overdue invoice is not overdue a day before its due date", async () => {
    const [store] = [{ id: on.f.storeId, slug: on.f.slug, name: "Arbeid", timeZone: "Europe/Oslo" }];
    const dueDay = addCalendarDays(on.today, -26);
    const before = Date.parse(`${addCalendarDays(dueDay, -1)}T12:00:00Z`);
    const items = (await attention.workAttention([store], before)).get(on.f.storeId)!;
    expect(items.some((i) => /overdue/.test(i.text))).toBe(false);
  });
});
