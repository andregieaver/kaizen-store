import { sql } from "drizzle-orm";

import { db } from "@/db/client";

type Row = Record<string, unknown>;

/** Test fixtures for D314's integration tests: a real store made the way an approval makes one, with its owner. */
export async function makeCapacityStore(name: string, run: string): Promise<{ id: string; slug: string; owner: string; email: string }> {
  const email = `capacity-${name}-${run}@example.com`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${email}, ${name}, ${name}) returning id
  `);
  const slug = `capacity-${name}-${run}`;
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${name}, null) as id`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${email}`);
  return { id: String(store.id), slug, owner: String(owner.id), email };
}

/** A usage row as the meter or the drain would write it. */
export async function putUsage(storeId: string | null, day: string, metric: string, value: number): Promise<void> {
  await db().execute(sql`
    insert into commerce.store_usage_daily (store_id, day, metric, value) values (${storeId}::uuid, ${day}::date, ${metric}, ${value})
    on conflict (store_id, day, metric) do update set value = excluded.value
  `);
}
