import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const reports = await import("./content-reports");

/**
 * Notices of illegal content (DSA art. 16, D411) against a real database: kept with the store the address names, a receipt to the
 * sender and an alert to the platform admins, decided once with a reason, the sender told and the store's owners given the statement
 * of reasons only when something was restricted, and the sender forgotten 12 months after the decision.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let admin: { id: string; email: string; name: string; platformAdmin: boolean };
let store: { id: string; slug: string; ownerEmail: string };

const emailsTo = async (to: string, kind: string) =>
  (await db().execute<Row>(sql`select text from commerce.email_messages where to_address = ${to} and kind = ${kind} order by created_at`)).map((r) => String(r.text));

const notice = (over: Partial<Parameters<typeof reports.submitContentReport>[0]> = {}) => ({
  url: `https://kaizenaflow.com/s/${store.slug}/no/p/demo-handlenett`,
  category: "counterfeit_ip" as const,
  explanation: "A copy of a protected bag design.",
  name: "Kari Nordmann",
  email: `kari-${run}@example.com`,
  goodFaith: true as const,
  ...over,
});

beforeAll(async () => {
  const [a] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`report-admin-${run}@example.com`}, 'Platform', true) returning id, email
  `);
  admin = { id: String(a.id), email: String(a.email), name: "Platform", platformAdmin: true };
  const [s] = await db().execute<Row>(sql`insert into commerce.stores (slug, name) values (${`reported-${run}`}, 'Reported store') returning id, slug`);
  const [owner] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`report-owner-${run}@example.com`}, 'Owner') returning id, email
  `);
  await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${String(s.id)}::uuid, ${String(owner.id)}::uuid, 'owner')`);
  store = { id: String(s.id), slug: String(s.slug), ownerEmail: String(owner.email) };
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.content_reports where reporter_email like ${`%-${run}@example.com`} or explanation like ${`%${run}%`}`);
  await closeDb();
});

describe("notices of illegal content (DSA art. 16, D411)", () => {
  it("keeps a notice with the store its address names, sends the sender a receipt and alerts the platform admins", async () => {
    const id = await reports.submitContentReport(notice(), "nb");
    const [row] = await db().execute<Row>(sql`select store_id, status, lang, reporter_email from commerce.content_reports where id = ${id}::uuid`);
    expect(row).toMatchObject({ store_id: store.id, status: "received", lang: "nb", reporter_email: `kari-${run}@example.com` });
    const receipts = await emailsTo(`kari-${run}@example.com`, "platform.content_report_received");
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toContain("Vi har fått meldingen din");
    expect(receipts[0]).toContain(id);
    expect(await emailsTo(admin.email, "platform.content_report_new")).toHaveLength(1);
    expect((await reports.listContentReports()).find((r) => r.id === id)).toMatchObject({ status: "received", store: { slug: store.slug } });
  });

  it("takes a notice about children without a sender, and finds no store for an address outside Kaizena Flow", async () => {
    const id = await reports.submitContentReport(notice({ category: "minors", name: "", email: "", url: "https://elsewhere.example/x", explanation: `Abuse ${run}` }), "en");
    const [row] = await db().execute<Row>(sql`select store_id, reporter_name, reporter_email from commerce.content_reports where id = ${id}::uuid`);
    expect(row).toEqual({ store_id: null, reporter_name: null, reporter_email: null });
  });

  it("decides once, with a reason; tells the sender and gives the store's owners the statement of reasons when content was restricted", async () => {
    const id = await reports.submitContentReport(notice(), "en");
    expect(await reports.decideContentReport(admin, id, { outcome: "actioned", decision: "short", actionTaken: "Hid the product." })).toEqual({ ok: false, problem: "reason" });
    expect(await reports.decideContentReport(admin, id, { outcome: "actioned", decision: "The design is registered to another company.", actionTaken: "" })).toEqual({ ok: false, problem: "action" });
    expect(await reports.decideContentReport(admin, id, { outcome: "actioned", decision: "The design is registered to another company.", actionTaken: "Hid the product." })).toEqual({ ok: true });
    expect(await reports.decideContentReport(admin, id, { outcome: "no_action", decision: "Changed my mind about it.", actionTaken: "" })).toEqual({ ok: false, problem: "decided" });
    expect(await reports.decideContentReport(admin, "00000000-0000-0000-0000-000000000000", { outcome: "no_action", decision: "Nothing here to decide.", actionTaken: "" })).toEqual({ ok: false, problem: "notFound" });

    const told = (await emailsTo(`kari-${run}@example.com`, "platform.content_report_decided")).at(-1) ?? "";
    expect(told).toContain("restricted it");
    expect(told).toContain("The design is registered to another company.");
    expect(told).toContain("Digital Services Coordinator");
    expect(told).toContain("No automated means were used");
    const statement = await emailsTo(store.ownerEmail, "platform.content_report_restricted");
    expect(statement).toHaveLength(1);
    expect(statement[0]).toContain("Hid the product.");
    // The statement of reasons never names the sender.
    expect(statement[0]).not.toContain("Kari Nordmann");
    const [audited] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where action = 'platform.content_report_decided' and target_id = ${id}`);
    expect(audited.n).toBe(1);
  });

  it("tells only the sender when nothing was restricted", async () => {
    const before = (await emailsTo(store.ownerEmail, "platform.content_report_restricted")).length;
    const id = await reports.submitContentReport(notice({ explanation: `Lawful resale ${run}` }), "en");
    expect(await reports.decideContentReport(admin, id, { outcome: "no_action", decision: "A genuine product resold, which the law allows.", actionTaken: "" })).toEqual({ ok: true });
    expect((await emailsTo(`kari-${run}@example.com`, "platform.content_report_decided")).at(-1)).toContain("did not restrict it");
    expect(await emailsTo(store.ownerEmail, "platform.content_report_restricted")).toHaveLength(before);
  });

  it("forgets the sender 12 months after the decision, keeping the notice and its decision", async () => {
    const id = await reports.submitContentReport(notice({ explanation: `Old notice ${run}` }), "en");
    await reports.decideContentReport(admin, id, { outcome: "no_action", decision: "Not illegal as described.", actionTaken: "" });
    await db().execute(sql`update commerce.content_reports set decided_at = now() - interval '13 months' where id = ${id}::uuid`);
    expect(await reports.pruneContentReports()).toBeGreaterThanOrEqual(1);
    const [row] = await db().execute<Row>(sql`select reporter_name, reporter_email, decision from commerce.content_reports where id = ${id}::uuid`);
    expect(row).toEqual({ reporter_name: null, reporter_email: null, decision: "Not illegal as described." });
  });
});
