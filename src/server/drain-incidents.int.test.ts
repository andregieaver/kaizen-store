import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { closeDb, db } = await import("@/db/client");
const { drainErrors } = await import("@/lib/drain-errors");
const { logDrainErrors } = await import("./drain-incidents");
const { storeIncidents } = await import("./store-incidents");
const { makeStore } = await import("./trust-fixtures");

type Row = Record<string, unknown>;

/**
 * A run's own name for its routes, in letters only: `routeOf()` reads a part with three digits in a row as an id, so a clock in base 36 such
 * as `mwz3c912` made the route `/api/:id` now and then, and the entry was not where the test looked.
 */
const runName = () => Date.now().toString(36).replace(/\d/g, (d) => "abcdefghij"[Number(d)]);

/** Runtime errors from the log drain (D895 IA-17): one open entry per route and name, a repeat only counted. */
const route = `/api/zz-drain-${runName()}`;
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

describe("the stores an error touched (IA-18)", () => {
  it("links an entry to the store its address names, counts a second sighting, and shows the store's owner where it stands", async () => {
    const shop = await makeStore("drain-link");
    const storeRoute = `/api/zz-store-${runName()}`;
    const errors = drainErrors([
      { source: "lambda", environment: "production", level: "error", path: `${storeRoute}?x=1`, proxy: { host: "kaizenaflow.com" }, message: "TypeError: boom" },
    ]);
    const storeOf = (_host: string, path: string) => (path.startsWith(storeRoute) ? shop.id : undefined);
    expect(await logDrainErrors(errors, storeOf)).toBe(1);
    await logDrainErrors(errors, storeOf);
    const [link] = await db().execute<Row>(
      sql`select l.occurrences from commerce.platform_incident_stores l join commerce.platform_incidents i on i.id = l.incident_id
          where l.store_id = ${shop.id}::uuid and i.fingerprint like ${`runtime:${storeRoute}%`}`,
    );
    expect(link.occurrences).toBe(2);
    expect(await storeIncidents(shop.id)).toEqual([expect.objectContaining({ area: "connection", state: "fixing", occurrences: 2 })]);
    await db().execute(sql`update commerce.platform_incidents set status = 'wont_fix' where fingerprint like ${`runtime:${storeRoute}%`}`);
    expect(await storeIncidents(shop.id)).toEqual([]);
    await db().execute(sql`delete from commerce.platform_incidents where fingerprint like ${`runtime:${storeRoute}%`}`);
  });
});
