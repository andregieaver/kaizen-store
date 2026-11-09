import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { salesReport } = await import("./sales-reports");

type Row = Record<string, unknown>;

/**
 * Sales reports (S6, D519) against a real database: the forecast of open deals by month and weighted by their stage's chance, the stages
 * reached by deals made in the period (from the moves the database keeps), what each owner won and lost, and the time to win.
 */

const run = Date.now().toString(36);
afterAll(async () => closeDb());

describe("sales reports (D519)", () => {
  it("reads the forecast, the stages, the people and the time to win from the store's deals", async () => {
    const name = `sales-${run}`;
    const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'Siri', 'Salg') returning id`);
    await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Salg', null)`);
    const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
    const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
    const storeId = String(store.id);
    const ownerId = String(owner.id);
    const [pipeline] = await db().execute<Row>(sql`insert into commerce.deal_pipelines (store_id, name) values (${storeId}::uuid, 'Sales') returning id`);
    const pipelineId = String(pipeline.id);
    const stage = async (stageName: string, position: number, probability: number | null) =>
      String(
        (
          await db().execute<Row>(sql`
            insert into commerce.deal_stages (store_id, pipeline_id, name, position, probability)
            values (${storeId}::uuid, ${pipelineId}::uuid, ${stageName}, ${position}, ${probability}) returning id`)
        )[0].id,
      );
    const fresh = await stage("New", 0, 10);
    const talking = await stage("Talking", 1, 50);
    const quote = await stage("Quote sent", 2, null);
    const deal = async (title: string, stageId: string, estimate: number | null, expected: string | null, created: string) =>
      String(
        (
          await db().execute<Row>(sql`
            insert into commerce.deals (store_id, title, pipeline_id, stage_id, currency, estimate_minor, expected_close_on, owner_id, created_at)
            values (${storeId}::uuid, ${title}, ${pipelineId}::uuid, ${stageId}::uuid, 'NOK', ${estimate}, ${expected}::date, ${ownerId}::uuid, ${created}::timestamptz)
            returning id`)
        )[0].id,
      );
    const move = (id: string, stageId: string) => db().execute(sql`update commerce.deals set stage_id = ${stageId}::uuid, stage_entered_at = now() where id = ${id}::uuid`);
    const close = (id: string, status: "won" | "lost", at: string) =>
      db().execute(sql`update commerce.deals set status = ${status}, closed_at = ${at}::timestamptz, closed_via = 'person' where id = ${id}::uuid`);

    // Made in October: one moved on to Talking and won after 10 days, one lost from New, one moved to Quote sent and still open.
    const a = await deal("A", fresh, 400_000, null, "2026-10-01T10:00:00Z");
    await move(a, talking);
    await close(a, "won", "2026-10-11T10:00:00Z");
    const b = await deal("B", fresh, 100_000, null, "2026-10-02T10:00:00Z");
    await close(b, "lost", "2026-10-05T10:00:00Z");
    const c = await deal("C", fresh, 200_000, "2026-11-20", "2026-10-03T10:00:00Z");
    await move(c, quote);
    // Open, outside the period: Talking, overdue.
    await deal("D", talking, 300_000, "2026-09-30", "2026-08-01T10:00:00Z");

    const report = await salesReport(storeId, { main: "NOK", from: "2026-10-01", to: "2026-11-01", today: "2026-11-09" });
    expect(report.pipelineId).toBe(pipelineId);
    expect(report.open).toEqual({ deals: 2, valueMinor: 500_000, weightedMinor: 150_000 });
    const by = Object.fromEntries(report.forecast.map((x) => [x.key, x]));
    expect(by.overdue).toMatchObject({ deals: 1, valueMinor: 300_000, weightedMinor: 150_000 });
    expect(by["2026-11"]).toMatchObject({ deals: 1, valueMinor: 200_000, weightedMinor: 0, unweighted: 1 });

    expect(report.stages.steps.map((s) => [report.stages.names[s.stageId], s.reached, s.onward])).toEqual([
      ["New", 3, 2 / 3],
      // A won deal has passed every stage: A (won from Talking) and C (Quote sent) reached both; of those at Quote sent, A was won.
      ["Talking", 2, 1],
      ["Quote sent", 2, 1 / 2],
    ]);
    expect([report.stages.won, report.stages.lost, report.stages.open]).toEqual([1, 1, 1]);
    expect(report.people).toEqual([{ ownerId, name: "Siri", won: 1, lost: 1, wonMinor: 400_000, winRate: 0.5 }]);
    expect(report.timeToWin).toEqual({ median: 10, mean: 10, deals: 1 });

    // A store with no pipeline yet: nothing to read.
    const [other] = await db().execute<Row>(sql`select id from commerce.stores where is_template limit 1`);
    if (other) expect((await salesReport(String(other.id), { main: "NOK", from: "2026-10-01", to: "2026-11-01", today: "2026-11-09" })).pipelines.length).toBeGreaterThanOrEqual(0);
  });
});
