import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

// Email is only kept (`logged`), never sent, without Resend's settings.
delete process.env.RESEND_API_KEY;

const journey = await import("./owner-journey");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let storeId = "";
let ownerId = "";
let ownerEmail = "";

/** The journey's emails kept for the store, by step. */
async function sent(): Promise<string[]> {
  const rows = await db().execute<Row>(sql`
    select idempotency_key from commerce.email_messages where idempotency_key like ${`owner-journey:%:${storeId}`} order by idempotency_key
  `);
  return rows.map((r) => String(r.idempotency_key).split(":")[1]);
}

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`oj-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`oj-${run}`}, 'Lysbutikken', null) as id`);
  storeId = String(created.id);
  const [owner] = await db().execute<Row>(sql`
    select a.id, a.email from commerce.store_members m join commerce.accounts a on a.id = m.account_id where m.store_id = ${storeId}::uuid and m.role = 'owner' limit 1
  `);
  ownerId = String(owner.id);
  ownerEmail = String(owner.email);
  await db().execute(sql`update commerce.accounts set admin_locale = 'nb-NO' where id = ${ownerId}::uuid`);
});

/**
 * Runs the job until nothing more goes, as the dispatcher's later runs would: other tests' stores share the database, and one run sends
 * at most fifty, ordered by store, so this store's emails may wait for a later run.
 */
async function drain() {
  for (let i = 0; i < 50 && (await journey.sendOwnerJourney()) > 0; i++);
}

afterAll(async () => {
  await closeDb();
});

/** Owners guided from trial to plan (email plan M4.5, D886): each step once per store, to its owner, while they have not turned them off. */
describe("the owner journey", () => {
  it("sends the trial's start and the store's opening once each, in the owner's language", async () => {
    await db().execute(sql`
      insert into commerce.store_billing (store_id, trial_ends_at) values (${storeId}::uuid, now() + interval '13 days 23 hours')
      on conflict (store_id) do update set trial_ends_at = excluded.trial_ends_at
    `);
    await db().execute(sql`update commerce.stores set setup_completed_at = now() where id = ${storeId}::uuid`);
    await drain();
    expect(await sent()).toEqual(["store_published", "trial_started"]);
    const [welcome] = await db().execute<Row>(sql`select to_address, subject, kind, text from commerce.email_messages where idempotency_key = ${`owner-journey:trial_started:${storeId}`}`);
    expect(welcome).toMatchObject({ to_address: ownerEmail, kind: "platform.owner_journey" });
    expect(String(welcome.subject)).toContain("Lysbutikken");
    expect(String(welcome.text)).toContain("Sjekklisten");
    expect(String(welcome.text)).toContain(`/admin/oj-${run}/billing`);
    // Again: nothing more.
    await drain();
    expect(await sent()).toEqual(["store_published", "trial_started"]);
  });

  it("sends the first paid order, the trial's end two to three days before, and the store's pause", async () => {
    await db().execute(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, subtotal_minor, tax_minor, total_minor, billing_address, shipping_address, status)
      values (${storeId}::uuid, ${`OJ-${run}`}, 'NO', 'NOK', 'nb-NO', 'kunde@example.com', 12000, 2400, 12000, '{}'::jsonb, '{}'::jsonb, 'paid')
    `);
    await db().execute(sql`update commerce.store_billing set trial_ends_at = now() + interval '2 days 12 hours' where store_id = ${storeId}::uuid`);
    await drain();
    expect(await sent()).toEqual(["first_order", "store_published", "trial_ending", "trial_started"]);
    await db().execute(sql`update commerce.store_billing set trial_ends_at = now() - interval '1 hour', trial_paused_at = now() where store_id = ${storeId}::uuid`);
    await drain();
    expect(await sent()).toContain("store_paused");
  });

  it("sends nothing to an owner who turned them off under Billing", async () => {
    await journey.setOwnerJourneyOff(ownerId, true);
    expect(await journey.ownerJourneyOff(ownerId)).toBe(true);
    await db().execute(sql`update commerce.store_billing set status = 'active', mode = 'live' where store_id = ${storeId}::uuid`);
    await drain();
    expect(await sent()).not.toContain("plan_paid");
    await journey.setOwnerJourneyOff(ownerId, false);
    await drain();
    expect(await sent()).toContain("plan_paid");
  });
});
