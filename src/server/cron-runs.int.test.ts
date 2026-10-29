import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb, db } = await import("@/db/client");
const { cronJobRows, runJobs, tracked } = await import("./cron-runs");
const { cronHealth } = await import("@/lib/cron-health");

const prefix = `test-${Date.now().toString(36)}`;
const rowOf = async (job: string) => (await cronJobRows()).find((r) => r.job === job);

afterAll(async () => {
  await db().execute(sql`delete from commerce.cron_jobs where job like ${`${prefix}%`}`);
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
});
