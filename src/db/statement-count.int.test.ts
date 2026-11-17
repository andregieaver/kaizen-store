import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { countStatements, noteStatement, sameStatementTwice, setRenderCounter, waves } from "@/db/statement-count";

/**
 * The statement counter (bloat review step 1.9, AD-12) against a real database: it records text, values and rows per statement, only inside
 * `countStatements()` (or a render's counter), and never changes a query's result or error.
 */

afterAll(async () => {
  await closeDb();
});

describe("statement counter", () => {
  it("records nothing outside countStatements", async () => {
    await db().execute(sql`select 1`);
    expect(noteStatement("x", [])).toBeNull();
  });

  it("records each statement's text, values and rows", async () => {
    const { statements, count } = await countStatements(async () => {
      await db().execute(sql`select ${7}::int as n`);
      await db().execute(sql`select 1 as one`);
    });
    expect(count).toBe(2);
    expect(statements).toHaveLength(2);
    expect(statements[0].text.toLowerCase()).toContain("select");
    expect(statements[0].values).toEqual([7]);
    for (const s of statements) {
      expect(s.rows).toBe(1);
      expect(s.ms).toBeGreaterThan(0);
    }
  });

  it("counts the statements of a transaction and marks begin and commit as control", async () => {
    const { statements, count } = await countStatements(() =>
      db().transaction(async (tx) => {
        await tx.execute(sql`create temp table statement_count_t (n int) on commit drop`);
        await tx.execute(sql`insert into statement_count_t values (1)`);
        return tx.execute(sql`select n from statement_count_t`);
      }),
    );
    expect(count).toBe(3);
    const control = statements.filter((s) => s.control).map((s) => s.text.trim().toLowerCase().split(/\s+/)[0]);
    expect(control).toEqual(["begin", "commit"]);
  });

  it("keeps two runs at once apart", async () => {
    const [a, b] = await Promise.all([
      countStatements(async () => {
        await db().execute(sql`select 1`);
      }),
      countStatements(async () => {
        await db().execute(sql`select 2`);
        await db().execute(sql`select 3`);
        await db().execute(sql`select 4`);
      }),
    ]);
    expect(a.count).toBe(1);
    expect(b.count).toBe(3);
  });

  it("reports the same statement sent twice with the same value", async () => {
    const { statements } = await countStatements(async () => {
      await db().execute(sql`select ${5}::int as same_twice`);
      await db().execute(sql`select ${5}::int as same_twice`);
      await db().execute(sql`select ${6}::int as same_twice`);
    });
    expect(sameStatementTwice(statements)).toHaveLength(1);
  });

  it("records a failing statement with rows null and lets the error through", async () => {
    let error: unknown;
    const { statements } = await countStatements(async () => {
      try {
        await db().execute(sql`select 1/0`);
      } catch (e) {
        error = e;
      }
    });
    expect(error).toBeTruthy();
    expect(statements).toHaveLength(1);
    expect(statements[0].rows).toBeNull();
  });

  it("counts waves: one after the other is a wave each, a Promise.all is one", async () => {
    // Warm the pool so every connection exists before the timed runs.
    await Promise.all([db().execute(sql`select 1`), db().execute(sql`select 1`)]);
    const sequential = await countStatements(async () => {
      await db().execute(sql`select pg_sleep(0.02)`);
      await db().execute(sql`select pg_sleep(0.02)`);
    });
    const together = await countStatements(async () => {
      await Promise.all([db().execute(sql`select pg_sleep(0.02)`), db().execute(sql`select pg_sleep(0.02)`)]);
    });
    expect(waves(sequential.statements)).toBe(2);
    expect(waves(together.statements)).toBe(1);
    for (const s of [...sequential.statements, ...together.statements]) expect(s.ms).toBeGreaterThan(0);
  });

  it("adds to a render's counter outside countStatements", async () => {
    const box = { statements: 0 };
    setRenderCounter(() => box);
    try {
      await db().execute(sql`select 1`);
      await db().execute(sql`select 2`);
    } finally {
      setRenderCounter(null);
    }
    expect(box.statements).toBe(2);
  });

  it("writes a log line with the statement's text and never its values when STATEMENT_LOG is 1", async () => {
    vi.stubEnv("STATEMENT_LOG", "1");
    vi.resetModules();
    const lines: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
    const fresh = await import("@/db/client");
    try {
      await fresh.db().execute(sql`select ${"secret-value"}::text as t`);
    } finally {
      write.mockRestore();
      vi.unstubAllEnvs();
      await fresh.closeDb();
    }
    const logged = lines.map((l) => l.trim()).filter((l) => l.startsWith("{") && l.includes("db.statement"));
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.some((l) => JSON.parse(l).text.toLowerCase().includes("select"))).toBe(true);
    expect(logged.join("\n")).not.toContain("secret-value");
  });
});
