import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { privacyDeadline, receivedInstant } from "@/lib/privacy-request";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("./document-html", () => ({ documentHtml: () => "<html></html>" }));
vi.mock("./stripe", () => ({ platformStripe: () => null, WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const { buildSubject } = await import("./privacy-fixture");
const requests = await import("./privacy-requests");
const { auditRows } = await import("./trust-fixtures");

type Row = Record<string, unknown>;

/**
 * The log of privacy requests and their one-month clock (D162, G9 and G12): logged with the day they were received, extended once with a reason
 * and told, refused with a reason and told, closed as "no data held", cancelled, never deleted, reminded to the owners once, and one store's
 * requests never another's.
 */

let store: Awaited<ReturnType<typeof fx.makeStore>>;
let other: Awaited<ReturnType<typeof fx.makeStore>>;
let actor: { storeId: string; accountId: string };
const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  store = await fx.makeStore("requests");
  other = await fx.makeStore("requests-b");
  actor = { storeId: store.storeId, accountId: store.ownerId };
}, 60_000);
afterAll(async () => {
  await closeDb();
});

const mailOf = (kind: string, to?: string) =>
  db().execute<Row>(sql`select to_address, subject, html, text, status from commerce.email_messages where store_id = ${store.storeId}::uuid and kind = ${kind} ${to ? sql`and to_address = ${to}` : sql``} order by created_at`);

describe("logging a request", () => {
  it("runs the month from the day it was received, finds the account, and refuses a day in the future, one too old, or a duplicate open erasure", async () => {
    const subject = await buildSubject(store, "logged");
    const result = await requests.logRequest(actor, { kind: "export", email: subject.email.toUpperCase(), receivedOn: day(-3), note: "Wrote by email" });
    expect(result).toMatchObject({ ok: true });
    const view = (await requests.getRequest(store.storeId, (result as { id: string }).id))!;
    expect(view).toMatchObject({ kind: "export", channel: "staff", status: "open", subjectEmail: subject.email, subjectCustomerId: subject.customerId, note: "Wrote by email", handledBy: store.ownerId });
    expect(view.receivedAt.toISOString()).toBe(receivedInstant(day(-3)).toISOString());
    expect(view.dueAt.toISOString()).toBe(privacyDeadline(receivedInstant(day(-3))).toISOString());
    expect(view.daysLeft).toBeGreaterThan(20);
    expect(view.overdue).toBe(false);
    expect(await requests.logRequest(actor, { kind: "export", email: subject.email, receivedOn: day(1), note: "" })).toMatchObject({ ok: false, field: "receivedOn" });
    expect(await requests.logRequest(actor, { kind: "export", email: subject.email, receivedOn: day(-400), note: "" })).toMatchObject({ ok: false, field: "receivedOn" });
    expect(await requests.logRequest(actor, { kind: "export", email: "not an email", receivedOn: day(), note: "" })).toMatchObject({ ok: false, field: "email" });
    expect(await requests.logRequest(actor, { kind: "erasure", email: subject.email, receivedOn: day(), note: "" })).toMatchObject({ ok: true });
    expect(await requests.logRequest(actor, { kind: "erasure", email: subject.email, receivedOn: day(), note: "" })).toMatchObject({ ok: false, field: "email" });
    // The log holds the id and kind, never the address.
    const entries = await auditRows(store.storeId, "privacy.request_logged");
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(entries.map((e) => e.details))).not.toContain(subject.email);
    expect(entries[0]).toMatchObject({ area: "customers" });
  });

  it("is the store's own: another store's staff cannot read, extend, refuse or cancel it", async () => {
    const created = await requests.logRequest(actor, { kind: "export", email: `mine-${fx.unique("m")}@example.com`, receivedOn: day(), note: "" });
    const id = (created as { id: string }).id;
    const foreign = { storeId: other.storeId, accountId: other.ownerId };
    expect(await requests.getRequest(other.storeId, id)).toBeNull();
    expect((await requests.listRequests(other.storeId)).map((r) => r.id)).not.toContain(id);
    expect(await requests.extendRequest(foreign, id, { reason: "x" })).toMatchObject({ ok: false });
    expect(await requests.refuseRequest(foreign, id, { reason: "other", note: "" })).toMatchObject({ ok: false });
    expect(await requests.cancelRequest(foreign, id)).toMatchObject({ ok: false });
    expect((await requests.getRequest(store.storeId, id))?.status).toBe("open");
  });
});

describe("extending the answer (Art. 12(3))", () => {
  it("is allowed once, with a reason, before the month is out, to three months from receipt, and the person is told in their language", async () => {
    const subject = await buildSubject(store, "extend");
    const { id } = (await requests.logRequest(actor, { kind: "export", email: subject.email, receivedOn: day(-5), note: "" })) as { id: string };
    expect(await requests.extendRequest(actor, id, { reason: "  " })).toMatchObject({ ok: false });
    const result = await requests.extendRequest(actor, id, { reason: "A large number of orders" });
    expect(result).toEqual({ ok: true, emailed: true });
    const view = (await requests.getRequest(store.storeId, id))!;
    expect(view.extendedUntil!.toISOString()).toBe(new Date(Date.UTC(receivedInstant(day(-5)).getUTCFullYear(), receivedInstant(day(-5)).getUTCMonth() + 3, receivedInstant(day(-5)).getUTCDate())).toISOString().replace(/T.*/, "T00:00:00.000Z"));
    expect(view.extensionReason).toBe("A large number of orders");
    expect(view.overdue).toBe(false);
    // Once only.
    expect(await requests.extendRequest(actor, id, { reason: "Again" })).toMatchObject({ ok: false, problem: "A request can be extended once." });
    // The person was told, at the address staff entered, in Norwegian (the account's language), with the reason.
    const [mail] = await mailOf("privacy.extended", subject.email);
    expect(mail.text).toContain("A large number of orders");
    expect(String(mail.subject)).not.toMatch(/^Your request/);
    expect(JSON.stringify((await auditRows(store.storeId, "privacy.request_extended")).map((e) => e.details))).not.toContain(subject.email);
  });

  it("is refused for a request whose month is already out, and for one that is answered", async () => {
    const { id } = (await requests.logRequest(actor, { kind: "export", email: `late-${fx.unique("l")}@example.com`, receivedOn: day(-40), note: "" })) as { id: string };
    const late = await requests.getRequest(store.storeId, id);
    expect(late?.overdue).toBe(true);
    expect(await requests.extendRequest(actor, id, { reason: "Too many orders" })).toMatchObject({ ok: false, problem: expect.stringContaining("first month") });
    expect(await requests.cancelRequest(actor, id)).toMatchObject({ ok: true });
    expect(await requests.extendRequest(actor, id, { reason: "x" })).toMatchObject({ ok: false });
  });
});

describe("refusing, closing, cancelling", () => {
  it("refuses with a reason from the list, tells the person the reasons, the right to complain and to a judicial remedy, and keeps the request", async () => {
    const subject = await buildSubject(store, "refuse");
    const { id } = (await requests.logRequest(actor, { kind: "erasure", email: subject.email, receivedOn: day(-1), note: "" })) as { id: string };
    expect(await requests.refuseRequest(actor, id, { reason: "because", note: "" })).toMatchObject({ ok: false });
    expect(await requests.markIdentityDoubt(actor, id)).toMatchObject({ ok: true });
    const doubt = (await requests.getRequest(store.storeId, id))!.identityDoubtAt;
    expect(doubt).not.toBeNull();
    expect(await requests.markIdentityDoubt(actor, id)).toMatchObject({ ok: true });
    expect((await requests.getRequest(store.storeId, id))!.identityDoubtAt!.getTime()).toBe(doubt!.getTime());
    expect(await requests.refuseRequest(actor, id, { reason: "identity_not_confirmed", note: "We wrote to the address on file and had no answer." })).toEqual({ ok: true, emailed: true });
    const view = (await requests.getRequest(store.storeId, id))!;
    expect(view).toMatchObject({ status: "refused", outcome: "refused", refusalReason: "identity_not_confirmed" });
    expect(view.completedAt).not.toBeNull();
    const [mail] = await mailOf("privacy.refused", subject.email);
    expect(mail.text).toMatch(/Datatilsynet/);
    expect(mail.text).toContain("We wrote to the address on file");
    // Answered once: no second refusal, no extension, no cancel.
    expect(await requests.refuseRequest(actor, id, { reason: "other", note: "" })).toMatchObject({ ok: false });
    expect(await requests.cancelRequest(actor, id)).toMatchObject({ ok: false });
    // The person's data is untouched by a refusal.
    expect(await db().execute(sql`select 1 from commerce.customers where id = ${subject.customerId}::uuid`)).toHaveLength(1);
  });

  it("closes as no data held only when the store holds nothing, and forgets the address of an erasure request at once", async () => {
    const subject = await buildSubject(store, "holds");
    const held = (await requests.logRequest(actor, { kind: "erasure", email: subject.email, receivedOn: day(), note: "" })) as { id: string };
    expect(await requests.closeNoData(actor, held.id)).toMatchObject({ ok: false, problem: expect.stringContaining("holds data") });
    const nobody = (await requests.logRequest(actor, { kind: "erasure", email: `nobody-${fx.unique("n")}@example.com`, receivedOn: day(), note: "" })) as { id: string };
    expect(await requests.closeNoData(actor, nobody.id)).toMatchObject({ ok: true });
    expect(await requests.getRequest(store.storeId, nobody.id)).toMatchObject({ status: "done", outcome: "no_data", subjectEmail: null });
    const exportNone = (await requests.logRequest(actor, { kind: "export", email: `nobody-${fx.unique("n")}@example.com`, receivedOn: day(), note: "" })) as { id: string };
    expect(await requests.closeNoData(actor, exportNone.id)).toMatchObject({ ok: true });
    // A request is never deleted by staff: the table refuses it for two years.
    await expect(db().execute(sql`delete from commerce.privacy_requests where id = ${nobody.id}::uuid`)).rejects.toThrow();
  });
});

describe("the reminders (G9)", () => {
  it("tells every owner once when a request is due within a week, and once when it is overdue, never naming the person", async () => {
    const subject = await buildSubject(store, "remind");
    const soon = (await requests.logRequest(actor, { kind: "export", email: subject.email, receivedOn: day(-25), note: "" })) as { id: string };
    const late = (await requests.logRequest(actor, { kind: "erasure", email: `late-${fx.unique("r")}@example.com`, receivedOn: day(-40), note: "" })) as { id: string };
    const first = await requests.sendDueReminders();
    expect(first.dueSoon).toBeGreaterThanOrEqual(1);
    expect(first.overdue).toBeGreaterThanOrEqual(1);
    const keyed = async (key: string) => db().execute<Row>(sql`select to_address, subject, text, kind from commerce.email_messages where idempotency_key like ${`${key}%`}`);
    const dueMail = await keyed(`privacy.due:${soon.id}`);
    const overdueMail = await keyed(`privacy.overdue:${late.id}`);
    expect(dueMail).toHaveLength(1);
    expect(overdueMail).toHaveLength(1);
    expect(dueMail[0]).toMatchObject({ to_address: store.ownerEmail, kind: "privacy.due" });
    expect(overdueMail[0]).toMatchObject({ to_address: store.ownerEmail, kind: "privacy.overdue" });
    expect(JSON.stringify([dueMail, overdueMail])).not.toContain(subject.email);
    // Each goes once however often the job runs.
    await requests.sendDueReminders();
    expect(await keyed(`privacy.due:${soon.id}`)).toHaveLength(1);
    expect(await keyed(`privacy.overdue:${late.id}`)).toHaveLength(1);
    const counts = await requests.dueCounts(store.storeId);
    expect(counts.overdue).toBeGreaterThanOrEqual(1);
    expect(counts.dueSoon).toBeGreaterThanOrEqual(1);
    // The other store sees none of it.
    expect((await requests.dueCounts(other.storeId)).open).toBe(0);
  });

  it("finds the open request for a person by account or email", async () => {
    const subject = await buildSubject(store, "find");
    const { id } = (await requests.logRequest(actor, { kind: "export", email: subject.email, receivedOn: day(), note: "" })) as { id: string };
    expect((await requests.requestFor(store.storeId, { customerId: subject.customerId }))?.id).toBe(id);
    expect((await requests.requestFor(store.storeId, { email: subject.email.toUpperCase() }))?.id).toBe(id);
    expect(await requests.requestFor(other.storeId, { email: subject.email })).toBeNull();
  });
});
