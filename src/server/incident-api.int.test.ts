import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const route = await import("@/app/api/platform/v1/incidents/[[...path]]/route");
const tokens = await import("./platform-api-tokens");
const incidents = await import("./incidents");
const wake = await import("./autopilot-wake");

/**
 * The incident log's API (D895) against a real database: only a token with the `incidents` scope; what the session ingests lands as
 * entries; a proposal cannot be claimed; a session holds at most three; only the claiming session marks a fix; a night proposes at most
 * three; runs start and finish. And the wake: recorded only while the autopilot is on, sent once the gap allows, at once for Run now.
 */

const run = Date.now().toString(36);
const SESSION = `https://claude.ai/code/session_test${run}`;
const OTHER = `https://claude.ai/code/session_other${run}`;
let owner: Account;
let token = "";
let readToken = "";
let settings: Row | undefined;

const call = (path: string, method: "GET" | "POST", body?: unknown, bearer: string | null = token) => {
  const request = new Request(`https://kaizenaflow.com/api/platform/v1/incidents/${path}`, {
    method,
    headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const handler = method === "GET" ? route.GET : route.POST;
  return handler(request, { params: Promise.resolve({ path: path ? path.split("/") : undefined }) });
};
const json = async (response: Response) => ({ status: response.status, body: (await response.json()) as Record<string, unknown> });
const fp = (name: string) => `test:api:${run}:${name}`;

beforeAll(async () => {
  const [o] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`incident-api-${run}@example.com`}, 'Aud', true) returning id`);
  owner = { id: String(o.id), email: "x", name: null, platformAdmin: true } as Account;
  const made = await tokens.makePlatformToken(owner, { name: "Autopilot", scopes: ["incidents"] });
  const read = await tokens.makePlatformToken(owner, { name: "Reader", scopes: ["figures:read"] });
  if (!made.ok || !read.ok) throw new Error("tokens not made");
  token = made.token;
  readToken = read.token;
  [settings] = await db().execute<Row>(sql`select autopilot_on, autopilot_gap_hours from commerce.platform_settings`);
}, 60_000);

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set autopilot_on = ${Boolean(settings?.autopilot_on)}, autopilot_gap_hours = ${Number(settings?.autopilot_gap_hours ?? 4)}`);
  await db().execute(sql`delete from commerce.platform_incidents where fingerprint like ${`%test:api:${run}:%`}`);
  await db().execute(sql`delete from commerce.platform_autopilot_runs where session like ${`%${run}`} or requested_by = ${owner.id}::uuid or summary like ${`%${run}%`}`);
  await db().execute(sql`delete from commerce.platform_api_tokens where created_by = ${owner.id}::uuid`);
  await closeDb();
});

describe("the incidents API", () => {
  it("answers only a token with the incidents scope", async () => {
    expect((await call("", "GET", undefined, null)).status).toBe(401);
    expect((await call("", "GET", undefined, readToken)).status).toBe(403);
    expect((await call("", "GET")).status).toBe(200);
    expect((await call("nowhere", "GET")).status).toBe(404);
  });

  it("logs what the session ingests, and refuses a source the app logs itself", async () => {
    const ingested = await json(
      await call("ingest", "POST", { entries: [{ kind: "error", source: "runtime", fingerprint: fp("runtime"), title: "TypeError on /cart", facts: { route: "/cart", count: 4 } }] }),
    );
    expect(ingested.status).toBe(200);
    expect((ingested.body.data as Row[])[0]).toMatchObject({ status: "open", created: true });
    expect((await call("ingest", "POST", { entries: [{ kind: "error", source: "cron", fingerprint: fp("cron"), title: "x" }] })).status).toBe(400);
  });

  it("claims, refuses another session's fix, and takes the claiming session's fix with its commit", async () => {
    const [entry] = await db().execute<Row>(sql`select id from commerce.platform_incidents where fingerprint = ${fp("runtime")}`);
    const id = String(entry.id);
    expect((await call(`${id}/claim`, "POST", { session: SESSION })).status).toBe(200);
    expect((await call(`${id}/fixed`, "POST", { session: OTHER, commit: "abc1234", note: "Mine" })).status).toBe(409);
    expect((await call(`${id}/fixed`, "POST", { session: SESSION, commit: "nope", note: "Fixed" })).status).toBe(400);
    expect((await call(`${id}/fixed`, "POST", { session: SESSION, commit: "abc1234", note: "Guarded the empty cart" })).status).toBe(200);
    const detail = await json(await call(id, "GET"));
    expect(detail.body).toMatchObject({ status: "fixed", fixCommit: "abc1234", fixNote: "Guarded the empty cart" });
  });

  it("never claims a proposal, and limits a night to three proposals", async () => {
    const first = await json(await call("propose", "POST", { session: SESSION, fingerprint: `${run}-a`, title: "Cache the menu", reason: "The menu is read on every page." }));
    expect(first.body).toMatchObject({ status: "proposed", created: true });
    expect((await call(`${String(first.body.id)}/claim`, "POST", { session: SESSION })).status).toBe(409);
    for (const n of ["b", "c"]) {
      expect((await call("propose", "POST", { session: SESSION, fingerprint: `${run}-${n}`, title: `Idea ${n}`, reason: "A reason of ten letters." })).status).toBe(200);
    }
    expect((await call("propose", "POST", { session: SESSION, fingerprint: `${run}-d`, title: "One too many", reason: "A reason of ten letters." })).status).toBe(429);
    await db().execute(sql`delete from commerce.platform_incidents where fingerprint like ${`nightly:${run}-%`} or fingerprint like ${`nightly:test:api:${run}:%`}`);
  });

  it("lets a session hold at most three entries, and give one back", async () => {
    const ids: string[] = [];
    for (const n of [1, 2, 3, 4]) {
      const logged = await incidents.logIncident({ kind: "warning", source: "advisor", fingerprint: fp(`hold-${n}`), title: `Advisor ${n}` });
      ids.push(logged!.id);
    }
    for (const id of ids.slice(0, 3)) expect((await call(`${id}/claim`, "POST", { session: SESSION })).status).toBe(200);
    expect((await call(`${ids[3]}/claim`, "POST", { session: SESSION })).status).toBe(429);
    expect((await call(`${ids[0]}/give-back`, "POST", { session: SESSION, note: "Needs a closer look first" })).status).toBe(200);
    expect((await json(await call(ids[0], "GET"))).body).toMatchObject({ status: "open" });
    expect((await call(`${ids[1]}/needs-owner`, "POST", { session: SESSION, note: "Needs the carrier's new key" })).status).toBe(200);
    expect((await call(`${ids[2]}/note`, "POST", { session: SESSION, note: "Looking at the index" })).status).toBe(200);
  });

  it("starts and finishes a run, and says whether to run", async () => {
    const started = await json(await call("runs", "POST", { session: SESSION, reason: "manual" }));
    expect(started.status).toBe(200);
    expect((await call(`runs/${String(started.body.id)}/finish`, "POST", { summary: `Run ${run}`, claimed: 1, fixed: 1, proposed: 0 })).status).toBe(200);
    expect((await call(`runs/${String(started.body.id)}/finish`, "POST", { summary: "Twice", claimed: 0, fixed: 0, proposed: 0 })).status).toBe(404);
    const due = await json(await call("due", "GET"));
    expect(due.body).toMatchObject({ on: expect.any(Boolean), gap_hours: expect.any(Number) });
  });
});

describe("waking the autopilot", () => {
  const fired: { url: string; body: string }[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    fired.push({ url, body: String(init.body) });
    return Response.json({ claude_code_session_id: "s", claude_code_session_url: `https://claude.ai/code/session_woken${run}` });
  };

  beforeAll(() => {
    process.env.AUTOPILOT_FIRE_TOKEN = "test-token";
    process.env.AUTOPILOT_TRIGGER_ID = "trig_test";
  });
  afterAll(() => {
    delete process.env.AUTOPILOT_FIRE_TOKEN;
    delete process.env.AUTOPILOT_TRIGGER_ID;
  });

  it("records nothing while the autopilot is off", async () => {
    await db().execute(sql`update commerce.platform_settings set autopilot_on = false`);
    expect(await wake.requestWake("work")).toBe(false);
  });

  it("waits for the gap after a run, and wakes at once for Run now", async () => {
    await db().execute(sql`update commerce.platform_settings set autopilot_on = true, autopilot_gap_hours = 4`);
    await db().execute(sql`delete from commerce.platform_autopilot_runs where sent_at is null and started_at is null`);
    // A run started an hour ago: within the gap.
    await db().execute(sql`insert into commerce.platform_autopilot_runs (reason, started_at, session, summary) values ('nightly', now() - interval '1 hour', ${SESSION}, ${`gap ${run}`})`);
    expect(await wake.requestWake("work")).toBe(true);
    expect(await wake.requestWake("work")).toBe(false);
    expect(await wake.sendDueWake(fetcher)).toBe(false);
    expect(fired).toHaveLength(0);
    expect(await wake.requestWake("run_now", owner.id)).toBe(true);
    expect(await wake.sendDueWake(fetcher)).toBe(true);
    expect(fired[0].url).toBe("https://api.anthropic.com/v1/claude_code/routines/trig_test/fire");
    expect(fired[0].body).toContain("run_now");
    const [sent] = await db().execute<Row>(sql`select session from commerce.platform_autopilot_runs where reason = 'run_now' and requested_by = ${owner.id}::uuid`);
    expect(sent.session).toBe(`https://claude.ai/code/session_woken${run}`);
    await db().execute(sql`delete from commerce.platform_autopilot_runs where sent_at is null and started_at is null`);
  });
});
