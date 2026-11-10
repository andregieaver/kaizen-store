import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { db } from "@/db/client";

type Row = Record<string, unknown>;

/**
 * One event delivered many times at the same moment is worked on once (D529, code review FV6): the claim is decided by the
 * database, on a real Postgres with a connection per delivery, which the unit tests' single connection cannot show.
 */
describe("a webhook event delivered twice at once", () => {
  const eventId = `evt_claim_race_${Date.now()}`;
  const claim = async (storeId: string) => {
    const [row] = await db().execute<Row>(sql`
      select commerce.claim_webhook_event(${storeId}::uuid, 'stripe', ${eventId}, 'checkout.session.completed', '{}'::jsonb) as mine
    `);
    return row.mine === true;
  };

  it("is claimed by exactly one delivery, and every delivery is counted", async () => {
    const [store] = await db().execute<Row>(sql`select id from commerce.stores order by created_at limit 1`);
    const storeId = String(store.id);

    const answers = await Promise.all(Array.from({ length: 12 }, () => claim(storeId)));
    expect(answers.filter(Boolean)).toHaveLength(1);

    const [row] = await db().execute<Row>(sql`
      select attempts, claimed_at is not null as claimed from commerce.webhook_events where store_id = ${storeId}::uuid and event_id = ${eventId}
    `);
    expect(row).toMatchObject({ attempts: 11, claimed: true });

    // Given up after a failure, the retry takes it, once.
    await db().execute(sql`update commerce.webhook_events set claimed_at = null where store_id = ${storeId}::uuid and event_id = ${eventId}`);
    const retries = await Promise.all(Array.from({ length: 6 }, () => claim(storeId)));
    expect(retries.filter(Boolean)).toHaveLength(1);

    await db().execute(sql`delete from commerce.webhook_events where store_id = ${storeId}::uuid and event_id = ${eventId}`);
  });
});
