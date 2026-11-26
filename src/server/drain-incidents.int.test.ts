import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb, db } = await import("@/db/client");
const { drainErrors } = await import("@/lib/drain-errors");
const { logDrainErrors } = await import("./drain-incidents");

type Row = Record<string, unknown>;

/** Runtime errors from the log drain (D895 IA-17): one open entry per route and name, a repeat only counted. */
const route = `/api/zz-drain-${Date.now().toString(36)}`;
const batch = () =>
  drainErrors([
    { source: "lambda", environment: "production", level: "error", path: route, deploymentId: "dpl_x", message: "TypeError: boom for kari@example.com" },
    { source: "lambda", environment: "production", level: "error", path: route, deploymentId: "dpl_x", message: "TypeError: boom again" },
  ]);

afterAll(async () => {
  await db().execute(sql`delete from commerce.platform_incidents where fingerprint like ${`runtime:${route}%`}`);
  await closeDb();
});

describe("runtime errors into the incident log", () => {
  it("logs a new error as one open entry with its facts, and a repeat only counts", async () => {
    expect(await logDrainErrors(batch())).toBe(1);
    const [row] = await db().execute<Row>(
      sql`select kind, source, status, title, facts, occurrences from commerce.platform_incidents where fingerprint = ${`runtime:${route}:typeerror`}`,
    );
    expect(row).toMatchObject({ kind: "error", source: "runtime", status: "open", title: `Runtime error: TypeError on ${route}` });
    expect(row.facts).toMatchObject({ route, name: "TypeError", count: 2, deployment: "dpl_x", message: "TypeError: boom for [email]" });
    await db().execute(sql`update commerce.platform_incidents set last_seen_at = now() - interval '5 minutes' where fingerprint = ${`runtime:${route}:typeerror`}`);
    await logDrainErrors(batch());
    const [again] = await db().execute<Row>(sql`select occurrences from commerce.platform_incidents where fingerprint = ${`runtime:${route}:typeerror`}`);
    expect(Number(again.occurrences)).toBe(Number(row.occurrences) + 1);
  });
});
