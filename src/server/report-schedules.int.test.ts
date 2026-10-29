import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { READY_REPORTS } from "@/lib/report-catalogue";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { saveReport } = await import("./saved-reports");
const { deleteReportSchedule, listReportSchedules, saveReportSchedule, sendScheduledReports } = await import("./report-schedules");
const { fxStore, paidOrder } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;

/**
 * Saved reports emailed on a schedule (wave 12 unit A, D395) on a real database: a schedule only for the store's own report and members who
 * may read analytics, sent once on its day from its hour on the store's clock, to each recipient still a member, with the table as a CSV.
 */
let store: Awaited<ReturnType<typeof fxStore>>;
let reportId = "";
let readOnly = "";
let outsider = "";
let analyst = "";

beforeAll(async () => {
  store = await fxStore("report-mail");
  await paidOrder(store, [["DEMO-TOTE", 2]], { manual: true });
  const saved = await saveReport(store.storeId, store.accountId, { title: "Weekly sales", spec: READY_REPORTS.sales_by_product });
  if (!saved.ok) throw new Error(saved.reason);
  reportId = saved.id;
  const account = async (label: string) =>
    String((await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`${label}-${Date.now().toString(36)}@example.com`}, ${label}) returning id`))[0].id);
  readOnly = await account("orders-only");
  outsider = await account("outsider");
  analyst = await account("analyst");
  await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${store.storeId}::uuid, ${analyst}::uuid, 'admin')`);
  const [role] = await db().execute<Row>(sql`
    insert into commerce.store_roles (store_id, name, permissions) values (${store.storeId}::uuid, 'Orders only', '{orders:read}') returning id`);
  await db().execute(sql`insert into commerce.store_members (store_id, account_id, role, role_id) values (${store.storeId}::uuid, ${readOnly}::uuid, 'admin', ${String(role.id)}::uuid)`);
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("a saved report emailed on a schedule (D395)", () => {
  it("is kept only for the store's own report and members who may read analytics", async () => {
    const base = { reportId, frequency: "weekly", weekday: 1, hour: 7, recipients: [store.accountId] };
    expect(await saveReportSchedule(store.storeId, store.accountId, { ...base, recipients: [readOnly] })).toEqual({ ok: false, problem: "recipients" });
    expect(await saveReportSchedule(store.storeId, store.accountId, { ...base, recipients: [outsider] })).toEqual({ ok: false, problem: "recipients" });
    expect(await saveReportSchedule(store.storeId, store.accountId, { ...base, reportId: "33333333-3333-4333-8333-333333333333" })).toEqual({ ok: false, problem: "report" });
    const made = await saveReportSchedule(store.storeId, store.accountId, base);
    expect(made).toMatchObject({ ok: true });
    expect(await listReportSchedules(store.storeId)).toEqual([expect.objectContaining({ reportTitle: "Weekly sales", frequency: "weekly", weekday: 1, hour: 7 })]);
    if (made.ok) expect(await deleteReportSchedule(store.storeId, store.accountId, made.id)).toBe(true);
  });

  it("sends once on its day from its hour, with the table attached, and never to someone who left", async () => {
    await db().execute(sql`update commerce.stores set time_zone = 'Europe/Oslo' where id = ${store.storeId}::uuid`);
    const made = await saveReportSchedule(store.storeId, store.accountId, { reportId, frequency: "weekly", weekday: 1, hour: 7, recipients: [store.accountId, analyst] });
    if (!made.ok) throw new Error(made.problem);
    const sent: { to: string; subject: string; attachments?: unknown[]; storeId: string | null }[] = [];
    const send = async (m: { to: string; email: { subject: string }; attachments?: unknown[]; storeId: string | null }) => {
      sent.push({ to: m.to, subject: m.email.subject, attachments: m.attachments, storeId: m.storeId });
      return "sent" as const;
    };
    // Monday 2 November 2026, 05:00 UTC is 06:00 in Oslo: not yet.
    await sendScheduledReports({ now: new Date("2026-11-02T05:00:00Z"), send: send as never });
    expect(sent.filter((s) => s.storeId === store.storeId)).toEqual([]);
    // 07:30 in Oslo: sent once, however often the job runs.
    await sendScheduledReports({ now: new Date("2026-11-02T06:30:00Z"), send: send as never });
    await sendScheduledReports({ now: new Date("2026-11-02T07:30:00Z"), send: send as never });
    const ours = sent.filter((s) => s.storeId === store.storeId);
    expect(ours).toHaveLength(2);
    expect(ours[0].subject).toContain("Weekly sales");
    expect(ours[0].attachments).toEqual([expect.objectContaining({ contentType: "text/csv; charset=utf-8" })]);
    // A Tuesday: nothing; the next Monday, again, but not to a member who has left.
    await sendScheduledReports({ now: new Date("2026-11-03T08:00:00Z"), send: send as never });
    expect(sent.filter((s) => s.storeId === store.storeId)).toHaveLength(2);
    await db().execute(sql`update commerce.store_members set disabled_at = now() where store_id = ${store.storeId}::uuid and account_id = ${analyst}::uuid`);
    await sendScheduledReports({ now: new Date("2026-11-09T08:00:00Z"), send: send as never });
    const after = sent.filter((s) => s.storeId === store.storeId);
    expect(after).toHaveLength(3);
    expect(after[2].to).not.toContain("analyst");
  });
});
