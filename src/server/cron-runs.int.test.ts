import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb, db } = await import("@/db/client");
const { claimDay, cronJobRows, runJobs, tracked, trackedWork } = await import("./cron-runs");
const { cronHealth } = await import("@/lib/cron-health");

const prefix = `test-${Date.now().toString(36)}`;
const rowOf = async (job: string) => (await cronJobRows()).find((r) => r.job === job);

afterAll(async () => {
  await db().execute(sql`delete from commerce.cron_jobs where job like ${`${prefix}%`}`);
  await db().execute(sql`delete from commerce.cron_jobs where job = 'route.page-jobs.work'`);
  await closeDb();
});

describe("the cron run ledger (PSI 2026-10-24, REL-06)", () => {
  it("keeps a job's runs in one row: a success, then failures counted and kept, then a success that clears the count", async () => {
    const job = `${prefix}.one`;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await tracked(job, 300, async () => 7)).toBe(7);
    let row = await rowOf(job);
    expect(row).toMatchObject({ everySeconds: 300, failures: 0, lastError: null });
    const firstOk = row!.lastOkAt;
    expect(firstOk).not.toBeNull();

    for (let i = 0; i < 3; i++) expect(await tracked(job, 300, async () => Promise.reject(new Error("carrier down")))).toBeNull();
    row = await rowOf(job);
    expect(row).toMatchObject({ failures: 3, lastError: "Error: carrier down", lastOkAt: firstOk });
    expect(cronHealth(row!)).toBe("failing");
    expect(JSON.parse(quiet.mock.calls[0][0])).toMatchObject({ level: "error", event: "cron.job_failed", job });

    await tracked(job, 300, async () => null);
    row = await rowOf(job);
    expect(row!.failures).toBe(0);
    expect(cronHealth(row!)).toBe("ok");
    quiet.mockRestore();
  });

  it("tells the platform's admins once when a job turns failing, and again only after it ran well and failed again (D389)", async () => {
    const email = `ops-${prefix}@example.com`;
    await db().execute(sql`insert into commerce.accounts (email, name, platform_admin) values (${email}, 'Ops', true)`);
    const sent = async () => {
      const [row] = await db().execute<{ n: number }>(sql`
        select count(*)::int as n from commerce.email_messages where kind = 'platform.job_failing' and to_address = ${email}`);
      return Number(row.n);
    };
    const job = `${prefix}.alerting`;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const fail = () => tracked(job, 300, async () => Promise.reject(new Error("bank feed down")));
    await tracked(job, 300, async () => 1);
    for (let i = 0; i < 2; i++) await fail();
    expect(await sent()).toBe(0);
    await fail();
    expect(await sent()).toBe(1);
    await fail();
    expect(await sent()).toBe(1);
    const [message] = await db().execute<{ subject: string; text: string }>(sql`
      select subject, text from commerce.email_messages where kind = 'platform.job_failing' and to_address = ${email}`);
    expect(message.subject).toContain(job);
    expect(message.text).toContain("bank feed down");
    // A good run ends the turn; failing again is a new one.
    await tracked(job, 300, async () => 1);
    for (let i = 0; i < 3; i++) await fail();
    expect(await sent()).toBe(2);
    quiet.mockRestore();
  });

  it("runs a dispatcher's jobs side by side, and one that throws leaves the others' answers", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const results = await runJobs(prefix, 300, {
      // A camel-case name is kept in kebab case, as the table's check asks.
      storeCopies: async () => 1,
      a: async () => ({ sent: 2 }),
      b: async () => {
        throw new Error("no");
      },
      c: async () => 3,
    });
    expect(results).toEqual({ storeCopies: 1, a: { sent: 2 }, b: null, c: 3 });
    expect((await rowOf(`${prefix}.store-copies`))!.failures).toBe(0);
    expect((await rowOf(`${prefix}.b`))!.failures).toBe(1);
    expect((await rowOf(`${prefix}.c`))!.failures).toBe(0);
    quiet.mockRestore();
  });

  it("a job whose first part fails still runs its second part, and its run is counted as failed (bloat review step 1.26)", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const job = `${prefix}.parts`;
    let second = false;
    const answer = await tracked(job, 300, async (report) => {
      try {
        throw new Error("mail down");
      } catch (error) {
        report(error, "first");
      }
      second = true;
      return 5;
    });
    expect(answer).toBe(5);
    expect(second).toBe(true);
    let row = await rowOf(job);
    expect(row).toMatchObject({ failures: 1 });
    expect(row!.lastError).toContain("1 part(s) failed (first)");
    expect(row!.lastError).toContain("mail down");
    await tracked(job, 300, async () => 1);
    row = await rowOf(job);
    expect(row!.failures).toBe(0);

    const p = `${prefix}-report`;
    const results = await runJobs(p, 300, {
      a: async (report) => {
        report(new Error("x"), "p");
        return 1;
      },
      b: async () => 2,
    });
    expect(results).toEqual({ a: 1, b: 2 });
    expect((await rowOf(`${p}.a`))!.failures).toBe(1);
    expect((await rowOf(`${p}.b`))!.failures).toBe(0);
    quiet.mockRestore();
  });

  it("a runner that throws after the answer leaves the route's work failed", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await trackedWork(`${prefix}.page-jobs`, 60, async () => {
      throw new Error("model down");
    });
    expect((await rowOf(`${prefix}.page-jobs.work`))!.failures).toBe(1);
    await trackedWork("route.page-jobs", 60, async () => {
      throw new Error("model down");
    });
    expect((await rowOf("route.page-jobs.work"))!.failures).toBeGreaterThanOrEqual(1);
    quiet.mockRestore();
  });

  it("runs at most four jobs at once and writes every row", async () => {
    const p = `${prefix}-cap`;
    let running = 0;
    let peak = 0;
    const job = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 50));
      running--;
    };
    const jobs = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`j${i}`, job]));
    await runJobs(p, 300, jobs);
    expect(peak).toBeLessThanOrEqual(4);
    expect((await cronJobRows()).filter((r) => r.job.startsWith(`${p}.`))).toHaveLength(10);
  });

  it("a job that throws and a job that never returns leave the others' rows written", async () => {
    const p = `${prefix}-hang`;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const now = async () => 1;
    const run = runJobs(
      p,
      300,
      {
        hangs: () => new Promise<never>(() => {}),
        throws: async () => {
          throw new Error("no");
        },
        a: now,
        b: now,
        c: now,
        d: now,
        e: now,
      },
      { lanes: 2, laneMs: 200 },
    );
    void run.catch(() => {});
    const wanted = ["throws", "a", "b", "c", "d", "e"].map((n) => `${p}.${n}`);
    let rows = (await cronJobRows()).filter((r) => r.job.startsWith(`${p}.`));
    for (let waited = 0; waited < 5000 && !wanted.every((w) => rows.some((r) => r.job === w)); waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      rows = (await cronJobRows()).filter((r) => r.job.startsWith(`${p}.`));
    }
    for (const w of wanted) expect(rows.find((r) => r.job === w), w).toBeDefined();
    expect(rows.find((r) => r.job === `${p}.throws`)!.lastError).toContain("no");
    for (const n of ["a", "b", "c", "d", "e"]) expect(rows.find((r) => r.job === `${p}.${n}`)!.lastError).toBeNull();
    expect(rows.find((r) => r.job === `${p}.hangs`)).toBeUndefined();
    quiet.mockRestore();
    warn.mockRestore();
  });

  it("gives a once-a-day job's day to one run, in the job's own time zone, and the next day to the first run of it (D436)", async () => {
    const job = `${prefix}.daily`;
    // 23:30 UTC on 14 January is already the 15th in Oslo.
    expect(await claimDay(job, "2030-01-15", "Europe/Oslo", new Date("2030-01-14T23:30:00Z"))).toBe(true);
    expect(await claimDay(job, "2030-01-15", "Europe/Oslo", new Date("2030-01-15T10:00:00Z"))).toBe(false);
    // Two runs at once: one gets the day.
    const both = await Promise.all([
      claimDay(job, "2030-01-16", "Europe/Oslo", new Date("2030-01-16T01:00:00Z")),
      claimDay(job, "2030-01-16", "Europe/Oslo", new Date("2030-01-16T01:00:01Z")),
    ]);
    expect(both.filter(Boolean)).toHaveLength(1);
    expect(await claimDay(job, "2030-01-16", "Europe/Oslo", new Date("2030-01-16T22:00:00Z"))).toBe(false);
    expect(await rowOf(job)).toMatchObject({ everySeconds: 86_400 });
  });
});
