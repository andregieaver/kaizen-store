import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
// The endpoint's address is never reached here; the guard lets a test save it only with this switch (ignored on Vercel).
process.env.REPLICATE_ALLOW_PRIVATE = "1";
// Slack's own sends never leave this machine.
vi.stubGlobal("fetch", async () => new Response("ok", { status: 200 }));

const flows = await import("./platform-workflows");
const endpoints = await import("./platform-endpoints");

/**
 * Kaizena Flow's workflows (C4 step 3, D516) against a real database: checked against the platform's events and actions, saved off and
 * switched on only once tested, queued by the database for the event that starts them, run with their conditions (an email to the platform's
 * owners, a signed request to one of its endpoints), scheduled once a day in Oslo's time, and capped past 100 runs an hour.
 */

const run = Date.now().toString(36);
let admin: Account;
let storeId: string;
let endpointId: string;

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`flows-${run}@example.com`}, 'Frida', true) returning id`);
  admin = { id: String(account.id), email: `flows-${run}@example.com`, name: null, platformAdmin: true } as Account;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`flows-owner-${run}@example.com`}, 'O', 'Flyt') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`flyt-${run}`}, 'Flyt', null)`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${`flyt-${run}`}`);
  storeId = String(store.id);
  await db().execute(sql`update commerce.stores set country = 'NO' where id = ${storeId}::uuid`);
  const added = await endpoints.addPlatformEndpoint(admin, { name: `Flows ${run}`, url: "https://hooks.example.com/flows", topics: ["plan.started"] });
  if (!added.ok) throw new Error(added.problem);
  endpointId = added.id;
}, 120_000);

afterAll(async () => {
  await db().execute(sql`delete from commerce.platform_workflows where created_by = ${admin.id}::uuid`);
  if (endpointId) await db().execute(sql`delete from commerce.platform_webhook_endpoints where id = ${endpointId}::uuid`);
  await closeDb();
});

const runsOf = (id: string) =>
  db().execute<Row>(sql`select id, event, status, matched, outcome from commerce.platform_workflow_runs where workflow_id = ${id}::uuid order by created_at`);

describe("the platform's workflows (D516)", () => {
  it("are checked against the platform's events, fields, actions and own endpoints", async () => {
    const base = { name: "Opened", trigger: "store.opened", schedule: null, conditions: [], actions: [{ kind: "email_staff", subject: "Opened", text: "A store opened." }] };
    expect(await flows.savePlatformWorkflow(admin, null, { ...base, trigger: "order.paid" })).toMatchObject({ ok: false });
    expect(await flows.savePlatformWorkflow(admin, null, { ...base, conditions: [{ field: "order.total", op: "is", value: "1" }] })).toEqual({ ok: false, problems: ["order.total is not a field of this trigger."] });
    expect(await flows.savePlatformWorkflow(admin, null, { ...base, actions: [{ kind: "tag_order", tag: "x" }] })).toEqual({ ok: false, problems: ["tag_order cannot follow this trigger."] });
    const missing = await flows.savePlatformWorkflow(admin, null, { ...base, actions: [{ kind: "send_request", endpointId: "00000000-0000-4000-8000-000000000000" }] });
    expect(missing).toMatchObject({ ok: false, problems: [expect.stringContaining("own endpoints")] });
  });

  it("are saved off, switched on only once tested, and run with their conditions when the event happens", async () => {
    const saved = await flows.savePlatformWorkflow(admin, null, {
      name: "Norwegian store opened",
      trigger: "store.opened",
      schedule: null,
      conditions: [{ field: "store.country", op: "is", value: "no" }],
      actions: [
        { kind: "email_staff", subject: "A Norwegian store opened", text: "Say hello." },
        { kind: "send_request", endpointId },
      ],
    });
    if (!saved.ok) throw new Error(saved.problems.join("; "));
    expect(await flows.switchPlatformWorkflow(admin, saved.id, true)).toBe("untested");
    await expect(db().execute(sql`update commerce.platform_workflows set enabled = true where id = ${saved.id}::uuid`)).rejects.toMatchObject({ cause: { message: expect.stringContaining("platform_workflows_on_when_tested") } });
    const tested = await flows.testPlatformWorkflow(admin, saved.id);
    expect(tested).toMatchObject({ ok: true, found: true });
    expect(await flows.switchPlatformWorkflow(admin, saved.id, true)).toBe("ok");

    // Another that does not match: no actions.
    const other = await flows.savePlatformWorkflow(admin, null, {
      name: "Swedish store opened",
      trigger: "store.opened",
      schedule: null,
      conditions: [{ field: "store.country", op: "is", value: "SE" }],
      actions: [{ kind: "email_staff", subject: "Hej", text: "A Swedish store." }],
    });
    if (!other.ok) throw new Error(other.problems.join("; "));
    await flows.testPlatformWorkflow(admin, other.id);
    await flows.switchPlatformWorkflow(admin, other.id, true);

    await db().execute(sql`select commerce.queue_platform_event('store.opened', ${storeId}::uuid)`);
    await db().execute(sql`select commerce.queue_platform_event('store.created', ${storeId}::uuid)`);
    expect((await runsOf(saved.id)).map((r) => [r.event, r.status])).toEqual([["store.opened", "pending"]]);

    await flows.runPlatformWorkflows(500);
    const [done] = await runsOf(saved.id);
    expect(done).toMatchObject({ status: "done", matched: true });
    expect((done.outcome as { actions: { kind: string; ok: boolean }[] }).actions).toEqual([
      { kind: "email_staff", ok: true },
      { kind: "send_request", ok: true },
    ]);
    const mails = await db().execute<Row>(sql`select to_address from commerce.email_messages where kind = 'platform.workflow' and idempotency_key like ${`platform.workflow:${String(done.id)}:0:%`}`);
    expect(mails.map((m) => String(m.to_address))).toContain(admin.email);
    const [sent] = await db().execute<Row>(sql`select event, subject_id from commerce.platform_integration_deliveries where endpoint_id = ${endpointId}::uuid and event = 'store.opened'`);
    expect(sent).toMatchObject({ event: "store.opened", subject_id: storeId });
    const [skipped] = await runsOf(other.id);
    expect(skipped).toMatchObject({ status: "done", matched: false });

    // Changed: off again, a new version to test.
    const changed = await flows.savePlatformWorkflow(admin, saved.id, { name: "Store opened", trigger: "store.opened", schedule: null, conditions: [], actions: [{ kind: "email_staff", subject: "Opened", text: "x" }] });
    expect(changed).toEqual({ ok: true, id: saved.id });
    expect((await flows.getPlatformWorkflow(saved.id))?.enabled).toBe(false);
    expect(await flows.switchPlatformWorkflow(admin, saved.id, true)).toBe("untested");
  });

  it("schedule once a day in Oslo's time, and cap a workflow past 100 runs an hour", async () => {
    const daily = await flows.savePlatformWorkflow(admin, null, { name: "Morning", trigger: "schedule", schedule: { every: "day", at: "07:00", weekday: null }, conditions: [], actions: [{ kind: "email_staff", subject: "Morning", text: "x" }] });
    if (!daily.ok) throw new Error(daily.problems.join("; "));
    await flows.testPlatformWorkflow(admin, daily.id);
    await flows.switchPlatformWorkflow(admin, daily.id, true);
    // 06:30 UTC is 07:30 in Oslo in November: due, once.
    await flows.queuePlatformScheduledRuns(new Date("2031-11-12T06:30:00Z"));
    await flows.queuePlatformScheduledRuns(new Date("2031-11-12T09:00:00Z"));
    // 05:30 UTC the next day is 06:30 in Oslo: not yet.
    await flows.queuePlatformScheduledRuns(new Date("2031-11-13T05:30:00Z"));
    expect((await runsOf(daily.id)).map((r) => r.event)).toEqual(["schedule"]);

    const busy = await flows.savePlatformWorkflow(admin, null, { name: "Every request", trigger: "request.received", schedule: null, conditions: [], actions: [{ kind: "email_staff", subject: "Request", text: "x" }] });
    if (!busy.ok) throw new Error(busy.problems.join("; "));
    await flows.testPlatformWorkflow(admin, busy.id);
    await flows.switchPlatformWorkflow(admin, busy.id, true);
    await db().execute(sql`
      insert into commerce.platform_workflow_runs (workflow_id, event, event_key, status)
      select ${busy.id}::uuid, 'request.received', 'filled:' || n, 'done' from generate_series(1, 100) n
    `);
    await db().execute(sql`select commerce.queue_platform_event('request.received', null)`);
    const runs = await runsOf(busy.id);
    expect(runs.filter((r) => r.status === "capped")).toHaveLength(1);
    expect(await flows.deletePlatformWorkflow(admin, busy.id)).toBe(true);
    expect(await runsOf(busy.id)).toEqual([]);
  });
});
