import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { makeStore, ownerOf, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { grantTrial, pausedAfter, settleTrials, trialPausedAt, TRIAL_DAYS } = await import("./store-trial");
const { setPrivateMode, privateState } = await import("./private-mode");
const { completeSetup } = await import("./setup");
const { addDrillOwner, DRILL_OWNER_DAYS } = await import("./live-drills");
const { passMembership } = await import("./auth");

type Row = Record<string, unknown>;

/**
 * A store's free trial and its end (D420): a trial is started once, an open store whose trial ended with no plan is made private (and its
 * owner cannot make it public, or open it, until a plan starts), and the job makes it public again once a plan has started. And the admin
 * who asks for a Dream Factory drill works in its store for a while.
 */

let fx: Fixture;

beforeAll(async () => {
  fx = await makeStore("store-trial");
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const billing = async () => {
  const [row] = await db().execute<Row>(sql`select trial_ends_at, trial_paused_at, status from commerce.store_billing where store_id = ${fx.storeId}::uuid`);
  return row;
};

describe("the free trial (D420)", () => {
  it("starts once, for a store with no trial and no plan", async () => {
    expect(await grantTrial(fx.storeId, fx.ownerId, "dream_factory")).toBe(true);
    const first = await billing();
    const days = (new Date(String(first.trial_ends_at)).getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(TRIAL_DAYS);
    // Starting the Dream Factory again never gives a second trial.
    expect(await grantTrial(fx.storeId, fx.ownerId, "dream_factory")).toBe(false);
    expect(String((await billing()).trial_ends_at)).toBe(String(first.trial_ends_at));
  });

  it("leaves an open store public while the trial runs", async () => {
    await db().execute(sql`update commerce.stores set setup_completed_at = now(), private_mode = false where id = ${fx.storeId}::uuid`);
    await settleTrials();
    expect((await privateState(fx.storeId))?.private).toBe(false);
    expect(await trialPausedAt(fx.storeId)).toBeNull();
  });

  it("makes an open store private when its trial ends with no plan, and keeps it so until a plan starts", async () => {
    await db().execute(sql`update commerce.store_billing set trial_ends_at = now() - interval '1 minute' where store_id = ${fx.storeId}::uuid`);
    const settled = await settleTrials();
    expect(settled.paused).toBeGreaterThanOrEqual(1);
    expect((await privateState(fx.storeId))?.private).toBe(true);
    expect(await trialPausedAt(fx.storeId)).toBeInstanceOf(Date);
    expect(await pausedAfter(fx.storeId)).toBe("trial");

    const owner = await ownerOf(fx);
    expect(await setPrivateMode(owner, false)).toEqual({ ok: false, problem: "trial_ended" });
    // Opening again (the wizard, or the AI manager's open_store) is refused too.
    await db().execute(sql`update commerce.stores set setup_completed_at = null where id = ${fx.storeId}::uuid`);
    const opened = await completeSetup(await ownerOf(fx));
    expect(opened).toMatchObject({ ok: false });
    await db().execute(sql`update commerce.stores set setup_completed_at = now() where id = ${fx.storeId}::uuid`);
    // A second run changes nothing.
    await settleTrials();
    expect((await privateState(fx.storeId))?.private).toBe(true);
  });

  it("makes it public again once a plan has started, and only a store it made private", async () => {
    await db().execute(sql`update commerce.store_billing set status = 'active' where store_id = ${fx.storeId}::uuid`);
    const settled = await settleTrials();
    expect(settled.reopened).toBeGreaterThanOrEqual(1);
    expect((await privateState(fx.storeId))?.private).toBe(false);
    expect(await trialPausedAt(fx.storeId)).toBeNull();

    // A store its owner made private on a plan is not touched.
    const owner = await ownerOf(fx);
    expect(await setPrivateMode(owner, true)).toEqual({ ok: true });
    await settleTrials();
    expect((await privateState(fx.storeId))?.private).toBe(true);

    const actions = await db().execute<Row>(sql`
      select details->>'via' as via from commerce.audit_log where store_id = ${fx.storeId}::uuid and action = 'store.private_mode' and details ? 'via'
      order by created_at
    `);
    expect(actions.map((a) => a.via)).toEqual(["trial_ended", "plan_started"]);
  });

  it("makes it private again when a cancelled plan ends, and says the plan ended (decided 5 November 2026)", async () => {
    expect(await pausedAfter(fx.storeId)).toBeNull();
    await db().execute(sql`update commerce.stores set private_mode = false where id = ${fx.storeId}::uuid`);
    // The owner cancelled; Stripe ends the subscription when the period does.
    await db().execute(sql`update commerce.store_billing set subscription_id = 'sub_trial_then_cancelled', status = 'canceled' where store_id = ${fx.storeId}::uuid`);
    const settled = await settleTrials();
    expect(settled.paused).toBeGreaterThanOrEqual(1);
    expect((await privateState(fx.storeId))?.private).toBe(true);
    expect(await pausedAfter(fx.storeId)).toBe("plan");
    // A plan again makes it public, as after the trial.
    await db().execute(sql`update commerce.store_billing set status = 'active' where store_id = ${fx.storeId}::uuid`);
    await settleTrials();
    expect((await privateState(fx.storeId))?.private).toBe(false);
    expect(await pausedAfter(fx.storeId)).toBeNull();
  });
});

describe("the Dream Factory drill's store (D420)", () => {
  it("lets the platform admin who asked work in it for a while as an owner, and nobody else", async () => {
    const [admin] = await db().execute<Row>(sql`
      insert into commerce.accounts (email, name, platform_admin) values (${`drill-admin-${fx.slug}@example.com`}, 'Admin', true) returning id
    `);
    const [plain] = await db().execute<Row>(sql`
      insert into commerce.accounts (email, name) values (${`drill-plain-${fx.slug}@example.com`}, 'Plain') returning id
    `);
    expect(await addDrillOwner(fx.slug, String(plain.id))).toBe(false);
    expect(await addDrillOwner(fx.slug, null)).toBe(false);
    expect(await addDrillOwner(fx.slug, String(admin.id))).toBe(true);
    expect(await addDrillOwner(fx.slug, String(admin.id))).toBe(false);

    const member = await passMembership(fx.slug, String(admin.id));
    expect(member?.role).toBe("owner");
    const [row] = await db().execute<Row>(sql`
      select expires_at from commerce.store_members where store_id = ${fx.storeId}::uuid and account_id = ${String(admin.id)}::uuid
    `);
    expect(Math.round((new Date(String(row.expires_at)).getTime() - Date.now()) / 86_400_000)).toBe(DRILL_OWNER_DAYS);
    // The test account stays the store's first owner.
    const [first] = await db().execute<Row>(sql`
      select account_id from commerce.store_members where store_id = ${fx.storeId}::uuid and role = 'owner' order by created_at limit 1
    `);
    expect(String(first.account_id)).toBe(fx.ownerId);
    // Once the time is up, they no longer work there.
    await db().execute(sql`update commerce.store_members set expires_at = now() - interval '1 minute' where store_id = ${fx.storeId}::uuid and account_id = ${String(admin.id)}::uuid`);
    expect(await passMembership(fx.slug, String(admin.id))).toBeNull();
  });
});
