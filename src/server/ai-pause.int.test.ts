import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { makeAccount, makeStore } = await import("./trust-fixtures");
const { aiAutonomyPaused, setAiAutonomyPaused } = await import("./ai-pause");
const { runAutopilot } = await import("./autopilot-runner");
const { runEvents } = await import("./autopilot-events");
const { runGoalReviews } = await import("./autopilot-reviews");
const { runFollowUps } = await import("./follow-up-runner");
const { runLegalUpkeep } = await import("./legal-writer");
const { advanceDreamRuns } = await import("./dream-factory");

type Row = Record<string, unknown>;

/**
 * The platform-wide pause of every AI that acts on its own (PSI AST-07): while a platform admin has it on, each runner does nothing at its
 * next run and leaves what it would have taken where it was; the switch is audited.
 */

let admin: Awaited<ReturnType<typeof makeAccount>>;

beforeAll(async () => {
  admin = await makeAccount("ai-pause-admin", { platformAdmin: true });
});

afterAll(async () => {
  await setAiAutonomyPaused(admin, false);
  await closeDb();
});

describe("pausing every AI that acts on its own", () => {
  it("is off until a platform admin turns it on, and each turn is audited", async () => {
    await setAiAutonomyPaused(admin, false);
    expect(await aiAutonomyPaused()).toBe(false);
    await setAiAutonomyPaused(admin, true);
    expect(await aiAutonomyPaused()).toBe(true);
    const [entry] = await db().execute<Row>(sql`
      select details from commerce.audit_log where account_id = ${admin.id}::uuid and action = 'platform.ai_autonomy_paused' order by created_at desc limit 1`);
    expect(entry.details).toMatchObject({ paused: true });
  });

  it("makes every runner do nothing while on, and leaves a due Dream Factory run unclaimed", async () => {
    await setAiAutonomyPaused(admin, true);
    const store = await makeStore("ai-pause-dream");
    const [run] = await db().execute<Row>(sql`
      insert into commerce.dream_runs (store_id, prompt, test, status) values (${store.id}::uuid, 'A shop for hand-thrown ceramic mugs from Bergen', true, 'running')
      returning id`);
    const never = () => {
      throw new Error("a paused runner must not work");
    };

    expect(await advanceDreamRuns({ deadline: Date.now() + 10_000, deps: { turn: never } as never, storeId: store.id })).toEqual({ moved: 0, failed: 0 });
    const [after] = await db().execute<Row>(sql`select claimed_until from commerce.dream_runs where id = ${String(run.id)}::uuid`);
    expect(after.claimed_until).toBeNull();

    expect(await runAutopilot({ turn: never } as never)).toEqual({ done: 0, waiting: 0, asking: 0, retried: 0, paused: 0 });
    expect(await runEvents({ turn: never } as never)).toEqual({ found: 0, done: 0, planned: 0, started: 0, skipped: 0, failed: 0 });
    expect(await runGoalReviews({ turn: never } as never)).toEqual({ planned: 0, started: 0, nothing: 0, skipped: 0, failed: 0 });
    expect(await runFollowUps({ turn: never } as never)).toEqual({ answered: 0, retried: 0, failed: 0, cancelled: 0, waiting: 0 });
    // The legal writer's upkeep too: a page no person asked for waits (and one a person asks for is written as a draft, never published).
    expect(await runLegalUpkeep()).toEqual({ stores: 0, queued: 0 });

    await db().execute(sql`update commerce.dream_runs set status = 'stopped', finished_at = now() where id = ${String(run.id)}::uuid`);
  });
});
