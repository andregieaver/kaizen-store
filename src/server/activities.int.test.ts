import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import webpush from "web-push";

import { closeDb, db } from "@/db/client";
import { todayList } from "@/lib/activities";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;

const activities = await import("./activities");
const deals = await import("./deals");
const staff = await import("./customer-staff");
const push = await import("./push");
const { mergeCustomers } = await import("./customer-merge");
const { eraseSubject } = await import("./privacy-erasure");
const { resolveSubject } = await import("./privacy-subject");
const { gatherExport } = await import("./privacy-export");
const { readTimeline } = await import("./customer-timeline");
const { newStore } = await import("./inventory-test-support");

type TestStore = Awaited<ReturnType<typeof newStore>>;
type Row = Record<string, unknown>;

/**
 * Activities (S3, D467) through the server, against a real database: made about the store's own person or deal and for the one who made
 * it unless they chose another; done and undone; on Today when late, today's or done today; a deal's next step; the person told once on
 * their devices when a timed one is due; followed into a merge, gone with an erasure, listed in the person's export and on their timeline.
 */

let store: TestStore;
let other: TestStore;
const run = Date.now().toString(36);

beforeAll(async () => {
  store = await newStore("act");
  other = await newStore("act-other");
});

afterAll(async () => {
  await closeDb();
});

async function person(s: TestStore, name: string): Promise<string> {
  const made = await staff.createCustomer(s.member, { email: `${name}-${run}@example.com`, name });
  if (!made.ok) throw new Error(JSON.stringify(made.problem));
  return made.id;
}

const oslo = (date: string, time = "") => ({ dueOn: date, dueTime: time });

describe("an activity", () => {
  it("is about the store's own person or deal, for its maker unless they choose, and says what is missing", async () => {
    const kari = await person(store, "kari");
    const made = await activities.createActivity(store.member, { kind: "call", title: "Call about the quote", ...oslo("2026-11-09", "10:00"), customerId: kari });
    expect(made.ok).toBe(true);
    const [mine] = await activities.activitiesOf(store.storeId, { customerId: kari });
    expect(mine).toMatchObject({ kind: "call", title: "Call about the quote", timed: true, assignee: { id: store.accountId }, customer: { id: kari } });
    expect(await activities.createActivity(store.member, { kind: "call", title: "x", ...oslo("2026-11-09"), customerId: await person(other, "theirs") })).toEqual({ ok: false, problems: ["who"] });
    expect(await activities.createActivity(store.member, { kind: "call", title: "x", ...oslo("2026-11-09"), customerId: kari, assigneeId: other.accountId })).toEqual({ ok: false, problems: ["assignee"] });
    expect(await activities.createActivity(store.member, { kind: "call", title: "", ...oslo("bad") })).toEqual({ ok: false, problems: ["title", "due", "who"] });
    const reader = { ...store.member, role: "admin" as const, permissions: ["customers:read"] as never };
    expect(await activities.createActivity(reader, { kind: "call", title: "x", ...oslo("2026-11-09"), customerId: kari })).toEqual({ ok: false, problems: ["forbidden"] });
  });

  it("is done and undone, changed and deleted, and a deal's next step is its earliest open one", async () => {
    const [pipeline] = await deals.ensurePipeline(store.storeId, { name: "Sales", stages: [{ name: "New" }] });
    const kari = await person(store, "deal-kari");
    const deal = await deals.createDeal(store.member, { title: "Totes", customerId: kari, pipelineId: pipeline.id, stageId: pipeline.stages[0].id });
    if (!deal.ok) throw new Error("deal");
    const first = await activities.createActivity(store.member, { kind: "task", title: "Send samples", ...oslo("2026-11-12"), dealId: deal.id });
    const second = await activities.createActivity(store.member, { kind: "meeting", title: "Visit", ...oslo("2026-11-14", "13:00"), duration: "60", dealId: deal.id });
    if (!first.ok || !second.ok) throw new Error("activities");
    expect((await activities.nextActivities(store.storeId, [deal.id])).get(deal.id)).toMatchObject({ kind: "task", timed: false });
    expect(await activities.setActivityDone(store.member, first.id, true)).toMatchObject({ ok: true });
    expect((await activities.nextActivities(store.storeId, [deal.id])).get(deal.id)).toMatchObject({ kind: "meeting" });
    expect(await activities.updateActivity(store.member, second.id, { kind: "meeting", title: "Visit at the fair", ...oslo("2026-11-15", "09:00"), duration: "90", dealId: deal.id })).toMatchObject({ ok: true });
    const list = await activities.activitiesOf(store.storeId, { dealId: deal.id });
    expect(list.map((a) => [a.title, a.doneAt !== null])).toEqual([["Visit at the fair", false], ["Send samples", true]]);
    expect(await activities.setActivityDone(store.member, first.id, false)).toMatchObject({ ok: true });
    expect(await activities.deleteActivity(store.member, second.id)).toMatchObject({ ok: true });
    expect(await activities.deleteActivity(other.member, first.id)).toEqual({ ok: false, problems: ["not_found"] });
  });

  it("is on Today when late, today's or done today, the viewer's or the team's", async () => {
    const now = new Date();
    const kari = await person(store, "today-kari");
    const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: store.member.store.timeZone });
    const late = await activities.createActivity(store.member, { kind: "call", title: "Late call", ...oslo(day(-2), "09:00"), customerId: kari });
    const today = await activities.createActivity(store.member, { kind: "task", title: "Today's task", ...oslo(day(0)), customerId: kari });
    const later = await activities.createActivity(store.member, { kind: "task", title: "Later task", ...oslo(day(3)), customerId: kari });
    if (!late.ok || !today.ok || !later.ok) throw new Error("activities");
    const list = todayList(await activities.todayActivities(store.member.store, store.accountId, now), now, store.member.store.timeZone);
    expect(list.late.map((a) => a.title)).toContain("Late call");
    expect(list.today.map((a) => a.title)).toContain("Today's task");
    expect([...list.late, ...list.today, ...list.done].map((a) => a.title)).not.toContain("Later task");
    expect(await activities.todayActivities(store.member.store, other.accountId, now)).toEqual([]);
  });
});

describe("the push when one is due", () => {
  it("tells the person it is for on their devices, once, and never for one that is done or not timed", async () => {
    const kari = await person(store, "push-kari");
    expect(await push.savePushSubscription(store.member, { endpoint: `https://fcm.googleapis.com/fcm/send/act-${run}`, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) }, device: "Phone" })).toEqual({ ok: true });
    const due = await activities.createActivity(store.member, { kind: "call", title: "Call Kari now", ...oslo("2026-11-09", "10:00"), customerId: kari });
    const day = await activities.createActivity(store.member, { kind: "task", title: "For the day", ...oslo("2026-11-09"), customerId: kari });
    if (!due.ok || !day.ok) throw new Error("activities");
    const sent: string[] = [];
    const sender = async (_sub: unknown, payload: string) => {
      sent.push(String(JSON.parse(payload).title));
      return { statusCode: 201 };
    };
    // An hour after it was due: told once; a second run finds nothing to tell.
    const at = new Date("2026-11-09T10:00:00Z");
    await activities.runActivityPushes(at, sender);
    expect(sent.filter((t) => t.includes("Call Kari now"))).toHaveLength(1);
    await activities.runActivityPushes(at, sender);
    expect(sent.filter((t) => t.includes("Call Kari now"))).toHaveLength(1);
    expect(sent.some((t) => t.includes("For the day"))).toBe(false);
    const [row] = await db().execute<Row>(sql`select notified_at is not null as told from commerce.activities where id = ${day.id}::uuid`);
    expect(row.told).toBe(false);
  });
});

describe("a person's activities", () => {
  it("follow them into a merge, are in their export and on their timeline, and go with an erasure unless a deal holds them", async () => {
    const keep = await person(store, "keep-act");
    const remove = await person(store, "remove-act");
    const made = await activities.createActivity(store.member, { kind: "call", title: "Follow up", ...oslo("2026-11-09", "11:00"), customerId: remove });
    if (!made.ok) throw new Error("activity");
    await activities.setActivityDone(store.member, made.id, true);
    expect((await mergeCustomers(store.member, keep, remove)).ok).toBe(true);
    expect((await activities.activitiesOf(store.storeId, { customerId: keep })).map((a) => a.id)).toContain(made.id);

    const subject = await resolveSubject(store.storeId, { customerId: keep }, { channel: "staff" });
    expect((await gatherExport(subject!, "en", new Date()))?.customerActivities).toEqual([expect.objectContaining({ kind: "call", title: "Follow up" })]);

    const selling = { ...store.member, store: { ...store.member.store, features: [...store.member.store.features, "sales" as const] } };
    const read = await readTimeline(selling, { kind: "person", email: `keep-act-${run}@example.com`, customerId: keep });
    expect(read.events.find((e) => e.what === "activity_done")).toMatchObject({ label: "Follow up", status: "call" });

    expect(await eraseSubject(store.storeId, { customerId: keep }, { channel: "staff", accountId: store.accountId })).toMatchObject({ ok: true });
    const [left] = await db().execute<Row>(sql`select count(*)::int as n from commerce.activities where id = ${made.id}::uuid`);
    expect(left.n).toBe(0);
  });
});
