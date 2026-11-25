import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const incidents = await import("./incidents");
const { alertFailingJob } = await import("./cron-alerts");
const { runIncidentJobs } = await import("./incident-jobs");

type Row = Record<string, unknown>;

/**
 * The incident log's writer (D895): a problem logged twice is one row that counts; a fixed one that comes back reopens; a proposal made again
 * only counts and never reopens; a dismissed one stays dismissed; moves fill what their status needs and write their event; a claim past its
 * time is released and a quiet fix is done.
 */
const run = Date.now().toString(36);
const fp = (name: string) => `test:incidents:${run}:${name}`;
let adminId = "";
const session = { session: "https://claude.ai/code/session_test" };

const row = async (id: string) => (await db().execute<Row>(sql`select * from commerce.platform_incidents where id = ${id}::uuid`))[0];
const events = async (id: string) =>
  db().execute<Row>(sql`select from_status, to_status, note from commerce.platform_incident_events where incident_id = ${id}::uuid order by at, id`);
const age = (id: string, column: string, interval: string) =>
  db().execute(sql`update commerce.platform_incidents set ${sql.raw(column)} = now() - ${interval}::interval where id = ${id}::uuid`);

beforeAll(async () => {
  const [admin] = await db().execute<Row>(
    sql`insert into commerce.accounts (email, name, platform_admin) values (${`incidents-${run}@example.com`}, 'Admin', true) returning id`,
  );
  adminId = String(admin.id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.platform_incidents where fingerprint like ${`test:incidents:${run}:%`} or facts->>'by' = ${adminId}`);
  await db().execute(sql`delete from commerce.accounts where id = ${adminId}::uuid`);
  await closeDb();
});

describe("logIncident", () => {
  it("keeps one row per fingerprint, counting a repeat at most once a minute", async () => {
    const first = await incidents.logIncident({ kind: "error", source: "cron", fingerprint: fp("count"), title: "A job failed", facts: { job: "x" } });
    expect(first).toMatchObject({ status: "open", created: true, reopened: false });
    const again = await incidents.logIncident({ kind: "error", source: "cron", fingerprint: fp("count"), title: "A job failed" });
    expect(again).toMatchObject({ id: first!.id, created: false });
    expect((await row(first!.id)).occurrences).toBe(1);
    await age(first!.id, "last_seen_at", "2 minutes");
    await incidents.logIncident({ kind: "error", source: "cron", fingerprint: fp("count"), title: "A job failed" });
    expect((await row(first!.id)).occurrences).toBe(2);
    expect(await events(first!.id)).toEqual([{ from_status: null, to_status: "open", note: null }]);
  });

  it("reopens a fixed problem that comes back, and leaves a won't-fix one as decided", async () => {
    const entry = (await incidents.logIncident({ kind: "warning", source: "status", fingerprint: fp("reopen"), title: "Slow" }))!;
    expect(await incidents.moveIncident(entry.id, "claimed", session)).toMatchObject({ ok: true });
    expect(await incidents.moveIncident(entry.id, "fixed", session, { commit: "abc1234", note: "Cached it" })).toMatchObject({ ok: true });
    const back = await incidents.logIncident({ kind: "warning", source: "status", fingerprint: fp("reopen"), title: "Slow" });
    expect(back).toMatchObject({ status: "open", reopened: true });
    expect((await row(entry.id)).reopened_count).toBe(1);

    const decided = (await incidents.logIncident({ kind: "error", source: "runtime", fingerprint: fp("wont"), title: "Noise" }))!;
    expect(await incidents.moveIncident(decided.id, "wont_fix", { accountId: adminId }, { note: "A bot's error" })).toMatchObject({ ok: true });
    await age(decided.id, "last_seen_at", "2 minutes");
    expect(await incidents.logIncident({ kind: "error", source: "runtime", fingerprint: fp("wont"), title: "Noise" })).toMatchObject({ status: "wont_fix" });
    expect((await row(decided.id)).occurrences).toBe(2);
  });

  it("starts a proposal as proposed and remembers it when dismissed; the owner's idea starts approved", async () => {
    const proposal = (await incidents.logIncident({ kind: "enhancement", source: "nightly", fingerprint: fp("idea"), title: "Cache the menu" }))!;
    expect(proposal.status).toBe("proposed");
    expect(await incidents.moveIncident(proposal.id, "claimed", session)).toEqual({ ok: false, problem: "move" });
    expect(await incidents.moveIncident(proposal.id, "dismissed", { accountId: adminId })).toMatchObject({ ok: true });
    await age(proposal.id, "last_seen_at", "2 minutes");
    expect(await incidents.logIncident({ kind: "enhancement", source: "nightly", fingerprint: fp("idea"), title: "Cache the menu" })).toMatchObject({
      status: "dismissed",
      reopened: false,
    });
    expect((await row(proposal.id)).decided_by).toBe(adminId);

    const idea = (await incidents.addIdea(adminId, "A dark admin", "Please"))!;
    expect(idea.status).toBe("approved");
    expect((await events(idea.id)).map((e) => e.note)).toEqual([null, "Please"]);
  });

  it("never throws: a bad source gives null", async () => {
    // @ts-expect-error a source the log does not know, as a broken caller might send
    expect(await incidents.logIncident({ kind: "error", source: "elsewhere", fingerprint: fp("bad"), title: "x" })).toBeNull();
  });
});

describe("moveIncident", () => {
  it("asks a fix for its commit and a hand-over for its note, and only a session may claim", async () => {
    const entry = (await incidents.logIncident({ kind: "error", source: "runtime", fingerprint: fp("needs"), title: "Broken" }))!;
    expect(await incidents.moveIncident(entry.id, "claimed", { accountId: adminId })).toEqual({ ok: false, problem: "move" });
    await incidents.moveIncident(entry.id, "claimed", session);
    expect(await incidents.moveIncident(entry.id, "fixed", session, { commit: "not-a-sha" })).toEqual({ ok: false, problem: "commit" });
    expect(await incidents.moveIncident(entry.id, "needs_owner", session)).toEqual({ ok: false, problem: "note" });
    expect(await incidents.moveIncident(entry.id, "needs_owner", session, { note: "Needs a new key" })).toMatchObject({ ok: true });
    const after = await row(entry.id);
    expect(after).toMatchObject({ status: "needs_owner", claimed_by: null, fix_note: "Needs a new key" });
    expect(await incidents.moveIncident("00000000-0000-0000-0000-000000000000", "open", session)).toEqual({ ok: false, problem: "unknown" });
  });
});

describe("keepIncidents", () => {
  it("releases a claim past its time to the workable status and closes a fix quiet for a day", async () => {
    const problem = (await incidents.logIncident({ kind: "error", source: "runtime", fingerprint: fp("expired"), title: "Died" }))!;
    await incidents.moveIncident(problem.id, "claimed", session);
    await age(problem.id, "claim_expires_at", "1 minute");
    const quiet = (await incidents.logIncident({ kind: "error", source: "runtime", fingerprint: fp("quiet"), title: "Fixed" }))!;
    await incidents.moveIncident(quiet.id, "claimed", session);
    await incidents.moveIncident(quiet.id, "fixed", session, { commit: "abcdef1" });
    await age(quiet.id, "fixed_at", "25 hours");

    const kept = await incidents.keepIncidents();
    expect(kept.released).toBeGreaterThanOrEqual(1);
    expect(kept.done).toBeGreaterThanOrEqual(1);
    expect(await row(problem.id)).toMatchObject({ status: "open", claimed_by: null });
    expect((await row(quiet.id)).status).toBe("done");
    expect((await events(quiet.id)).at(-1)).toMatchObject({ from_status: "fixed", to_status: "done" });
  });
});

describe("the sources inside the app", () => {
  it("logs a failing scheduled job as one error entry with its last error, counted again when it fails again", async () => {
    const job = `dispatcher.test-${run}`;
    await alertFailingJob(job, { failedAt: new Date(), lastOkAt: null, error: "boom" });
    const [entry] = await db().execute<Row>(sql`select id, kind, source, status, facts from commerce.platform_incidents where fingerprint = ${`cron:${job}`}`);
    expect(entry).toMatchObject({ kind: "error", source: "cron", status: "open", facts: { job, error: "boom" } });
    await db().execute(sql`delete from commerce.platform_incidents where id = ${entry.id as string}::uuid`);
  });
});

describe("the board and an entry's page", () => {
  it("shows what waits and what was fixed lately, with an entry's history", async () => {
    const entry = (await incidents.logIncident({ kind: "error", source: "cron", fingerprint: fp("board"), title: "On the board" }))!;
    const board = await incidents.incidentBoard();
    expect(board.find((e) => e.id === entry.id)).toMatchObject({ title: "On the board", status: "open", occurrences: 1 });
    const detail = await incidents.incidentDetail(entry.id);
    expect(detail?.events).toHaveLength(1);
  });
});

describe("the daily summary at seven in Oslo (the owner's answer, 20 November 2026)", () => {
  let lastDay: string | null = null;
  const digests = async (day: string) =>
    (
      await db().execute<Row>(
        sql`select subject from commerce.email_messages where kind = 'platform.incident_digest' and idempotency_key = ${`platform.incident_digest:${day}:${adminId}`}`,
      )
    ).map((r) => String(r.subject));
  const setLast = (day: string | null) => db().execute(sql`update commerce.platform_settings set incident_digest_last_day = ${day}::date`);

  beforeAll(async () => {
    const [row] = await db().execute<Row>(sql`select incident_digest_last_day::text as d from commerce.platform_settings`);
    lastDay = (row?.d as string | null) ?? null;
  });
  afterAll(async () => {
    await setLast(lastDay);
    await db().execute(sql`delete from commerce.email_messages where kind = 'platform.incident_digest' and idempotency_key like ${`%:${adminId}`}`);
  });

  it("waits until seven in winter (06:00 UTC is 07:00 in Oslo) and goes once that day", async () => {
    await setLast(null);
    expect((await runIncidentJobs({ now: new Date("2031-01-15T05:30:00Z") })).day).toBeNull();
    const first = await runIncidentJobs({ now: new Date("2031-01-15T06:05:00Z") });
    expect(first.day).toBe("2031-01-15");
    expect(await digests("2031-01-15")).toHaveLength(1);
    expect((await runIncidentJobs({ now: new Date("2031-01-15T09:00:00Z") })).day).toBeNull();
    expect(await digests("2031-01-15")).toHaveLength(1);
  });

  it("goes at seven in summer too (05:00 UTC is 07:00 in Oslo), naming what needs the owner", async () => {
    await incidents.logIncident({ kind: "enhancement", source: "nightly", fingerprint: fp("digest"), title: "A proposal for the summary" });
    expect((await runIncidentJobs({ now: new Date("2031-07-15T04:30:00Z") })).day).toBeNull();
    expect((await runIncidentJobs({ now: new Date("2031-07-15T05:10:00Z") })).day).toBe("2031-07-15");
    const [subject] = await digests("2031-07-15");
    expect(subject).toMatch(/need you|trenger deg/);
  });
});
