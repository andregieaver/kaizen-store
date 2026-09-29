import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const { platformOverview } = await import("./platform-overview");

afterAll(async () => {
  await closeDb();
});

describe("the platform overview (D107)", () => {
  it("counts waiting requests and stores from Kaizen's own data", async () => {
    const before = await platformOverview();
    const run = Date.now().toString(36);
    await db().execute(sql`insert into commerce.access_requests (email, name, store_name) values (${`overview-${run}@example.com`}, 'Kari', 'Kaffe')`);
    const after = await platformOverview();
    expect(after.requests.waiting).toBe(before.requests.waiting + 1);
    expect(after.requests.oldest).not.toBeNull();
    expect(after.stores.total).toBeGreaterThanOrEqual(0);
    expect(after.stores.paying + after.stores.overdue + after.stores.withoutPlan).toBeLessThanOrEqual(after.stores.total);
    expect(after.plans.total).toBeGreaterThanOrEqual(0);
    await db().execute(sql`delete from commerce.access_requests where email = ${`overview-${run}@example.com`}`);
  });
});
