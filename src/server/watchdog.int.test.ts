import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const { runWatchdog } = await import("./watchdog");
const route = await import("../app/api/cron/watchdog/route");

type Row = Record<string, unknown>;

/**
 * The watcher outside the scheduler (bloat review step 1.22): with the dispatcher's row in the ledger over fifteen minutes old, every platform
 * admin is emailed once per six hours; a fresh row sends nothing; a missing row counts as stopped; and the route refuses a call without the
 * cron secret.
 */
const JOB = "route.cart-reminders";
const run = Date.now().toString(36);
let original: Row | undefined;
let adminId = "";
const ageRow = async (interval: string) =>
  db().execute(sql`
    insert into commerce.cron_jobs (job, every_seconds, last_finished_at) values (${JOB}, 300, now() - ${interval}::interval)
    on conflict (job) do update set last_finished_at = excluded.last_finished_at
  `);
const forget = () => db().execute(sql`delete from commerce.email_messages where kind = 'platform.watchdog'`);

beforeAll(async () => {
  [original] = await db().execute<Row>(sql`select * from commerce.cron_jobs where job = ${JOB}`);
  const [admin] = await db().execute<Row>(
    sql`insert into commerce.accounts (email, name, platform_admin) values (${`watchdog-${run}@example.com`}, 'Admin', true) returning id`,
  );
  adminId = String(admin.id);
  await forget();
});

afterAll(async () => {
  await forget();
  await db().execute(sql`delete from commerce.cron_jobs where job = 'route.watchdog'`);
  await db().execute(sql`delete from commerce.platform_incidents where fingerprint = ${`watchdog:${JOB}`}`);
  if (original) {
    await db().execute(sql`
      update commerce.cron_jobs set last_finished_at = ${original.last_finished_at as Date | null}, every_seconds = ${original.every_seconds as number} where job = ${JOB}
    `);
  } else await db().execute(sql`delete from commerce.cron_jobs where job = ${JOB}`);
  await db().execute(sql`delete from commerce.accounts where id = ${adminId}::uuid`);
  await closeDb();
});

describe("the watchdog", () => {
  it("sends nothing while the dispatcher ran five minutes ago", async () => {
    await ageRow("5 minutes");
    expect(await runWatchdog()).toEqual({ stopped: [], sent: 0 });
  });

  it("emails the platform's admins when pg_cron has stopped, once for the same six hours", async () => {
    await ageRow("16 minutes");
    const now = new Date();
    const first = await runWatchdog(now);
    expect(first.stopped).toEqual([JOB]);
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const [mine] = await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where kind = 'platform.watchdog' and to_address = ${`watchdog-${run}@example.com`}`);
    expect(mine.n).toBe(1);
    expect(await runWatchdog(now)).toEqual({ stopped: [JOB], sent: 0 });
  });

  it("puts the stopped job in the incident log once, for the autopilot (D895)", async () => {
    const [entry] = await db().execute<Row>(sql`select kind, source, status from commerce.platform_incidents where fingerprint = ${`watchdog:${JOB}`}`);
    expect(entry).toEqual({ kind: "error", source: "watchdog", status: expect.any(String) });
  });

  it("counts a dispatcher row that is gone as stopped", async () => {
    await db().execute(sql`delete from commerce.cron_jobs where job = ${JOB}`);
    expect((await runWatchdog(new Date(Date.now() + 7 * 3600_000))).stopped).toEqual([JOB]);
  });

  it("refuses a call without the cron secret and keeps its own run when called with it", async () => {
    await ageRow("5 minutes");
    process.env.CRON_SECRET = `secret-${run}`;
    const refused = await route.GET(new Request("http://localhost/api/cron/watchdog"));
    expect(refused.status).toBe(401);
    const answered = await route.GET(new Request("http://localhost/api/cron/watchdog", { headers: { authorization: `Bearer secret-${run}` } }));
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ stopped: [], sent: 0 });
    const [kept] = await db().execute<Row>(sql`select every_seconds from commerce.cron_jobs where job = 'route.watchdog'`);
    expect(kept.every_seconds).toBe(900);
  });
});
