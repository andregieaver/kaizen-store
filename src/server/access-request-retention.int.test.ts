import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { RETENTION_SEED } from "@/lib/retention";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("./document-html", () => ({ documentHtml: () => "<html></html>" }));

const { RETENTION_STEPS, runRetention } = await import("./retention");
// Only the step under test runs: the others sweep every table and are tested on their own.
const only = Object.fromEntries(RETENTION_STEPS.filter((s) => s !== "access_requests").map((s) => [s, async () => ({ count: 0 })]));

type Row = Record<string, unknown>;

/**
 * Applications to open a store kept for a period (PSI REG-05): once decided, the applicant's name, address and message are blanked 12
 * months after the decision; a recent decision and a waiting application are left as they are, and the row itself stays.
 */
const RUN = Date.now().toString(36);
const monthsAgo = (months: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString();
};

async function request(tag: string, status: "pending" | "approved" | "declined", decidedAt: string | null): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name, message, status, decided_at)
    values (${`applicant-${tag}-${RUN}@example.com`}, ${`Kari ${tag}`}, ${`Butikk ${tag}`}, ${`About ${tag}`}, ${status}::commerce.access_request_status,
            ${decidedAt}::timestamptz)
    returning id
  `);
  return String(row.id);
}

const read = async (id: string) =>
  (await db().execute<Row>(sql`select email, name, message, store_name, status from commerce.access_requests where id = ${id}::uuid`))[0];

afterAll(async () => {
  await db().execute(sql`delete from commerce.access_requests where store_name like ${`Butikk %`} and (email like ${`%-${RUN}@example.com`} or email like 'erased-%@erased.invalid')`);
  await closeDb();
});

describe("applications to open a store (PSI REG-05)", () => {
  it("has a 12-month rule from the decision, in the seed and the table", async () => {
    expect(RETENTION_SEED.find((r) => r.kind === "access_requests")).toMatchObject({ periodValue: 12, periodUnit: "months" });
    const [rule] = await db().execute<Row>(sql`select period_value, period_unit from commerce.retention_rules where kind = 'access_requests' and country is null`);
    expect(rule).toMatchObject({ period_value: 12, period_unit: "months" });
  });

  it("blanks a decision older than the period and leaves a recent one and a waiting one", async () => {
    const old = await request("old", "declined", monthsAgo(13));
    const oldApproved = await request("oldok", "approved", monthsAgo(14));
    const recent = await request("recent", "declined", monthsAgo(2));
    const waiting = await request("waiting", "pending", null);
    const run = await runRetention(new Date(), { batch: 50, steps: only });
    expect(run.counts.access_requests).toBeGreaterThanOrEqual(2);
    for (const id of [old, oldApproved]) {
      const row = await read(id);
      expect(row).toMatchObject({ email: `erased-${id}@erased.invalid`, name: "", message: "" });
      // The record of the decision stays: the store's name is not the person's.
      expect(String(row.store_name)).toMatch(/^Butikk /);
    }
    expect(await read(recent)).toMatchObject({ name: "Kari recent", message: "About recent" });
    expect(await read(waiting)).toMatchObject({ name: "Kari waiting", status: "pending" });
  });
});
