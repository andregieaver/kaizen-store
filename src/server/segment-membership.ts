import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { matches, segmentRulesSchema, type SegmentRules } from "@/lib/segments";

import { listSegments, segmentPeople, type SegmentStore } from "./segments";
import { currentStore } from "./stores";
import { normaliseEmail } from "@/lib/email-address";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * The segments one address is in now, of those given: its facts read once through the segments' one reader (`segmentPeople()` for that
 * address alone, with what the rules ask for, ecosystem plan E3.6, D718) and each segment's rules matched by `matches()`. An address the store
 * does not know is in none.
 */
async function heldBy(store: SegmentStore, email: string, segments: readonly { id: string; rules: SegmentRules }[], now: Date): Promise<Set<string>> {
  const held = new Set<string>();
  if (!email || segments.length === 0) return held;
  const { people } = await segmentPeople(store, now, { emails: [email], rules: segments.map((s) => s.rules) });
  const person = people.find((p) => p.email === email);
  if (!person) return held;
  for (const s of segments) if (matches(s.rules, person, now)) held.add(s.id);
  return held;
}

/**
 * Whether a signed-in buyer is in a segment (D380), for a code or a campaign limited to one: the buyer's own account address read through the
 * segments' one reader (`segmentPeople()` for that address alone), matched by `matches()` now, never a stored list. The cart and `placeOrder()`
 * both ask here, so they agree. A guest is in no segment; a segment whose rules no longer read holds nobody.
 */
export async function segmentsOfBuyer(
  runner: Runner,
  storeId: string,
  customerId: string | null,
  segmentIds: readonly string[],
  now = new Date(),
): Promise<Set<string>> {
  const wanted = [...new Set(segmentIds)];
  if (!customerId || wanted.length === 0) return new Set();
  const [customer] = await runner.execute<Row>(sql`
    select c.email, s.slug from commerce.customers c join commerce.stores s on s.id = c.store_id
    where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid
  `);
  const email = customer?.email ? normaliseEmail(String(customer.email)) : "";
  if (!email) return new Set();
  // The store as it is now, past the page cache: this is asked while an order is placed.
  const store = await currentStore(String(customer.slug));
  if (!store) return new Set();
  const rows = await runner.execute<Row>(sql`
    select id, rules from commerce.segments
    where store_id = ${storeId}::uuid and id in (${sql.join(wanted.map((id) => sql`${id}::uuid`), sql`, `)})
  `);
  const segments = rows.flatMap((row) => {
    const parsed = segmentRulesSchema.safeParse(row.rules);
    return parsed.success ? [{ id: String(row.id), rules: parsed.data }] : [];
  });
  return heldBy(store, email, segments, now);
}

/**
 * The store's saved segments a person is in now (ecosystem plan E2.4, D713), for their customer page: their facts read once through the
 * segments' one reader (`segmentPeople()` for that address alone) and every segment's rules matched against them, by name; never a query a
 * segment. The customer types (RFM) and the newer conditions' facts are read only when a segment asks for them. A segment whose rules no
 * longer read holds nobody. `saved` is how many segments the store has, so a page can say *in none* only where there is one to be in.
 */
export async function segmentsOfPerson(store: SegmentStore, email: string, now = new Date()): Promise<{ saved: number; in: { id: string; name: string }[] }> {
  const address = normaliseEmail(email);
  const saved = await listSegments(store.id);
  const segments = saved.flatMap((s) => (s.rules ? [{ id: s.id, name: s.name, rules: s.rules }] : []));
  const held = await heldBy(store, address, segments, now);
  return { saved: saved.length, in: segments.filter((s) => held.has(s.id)).map(({ id, name }) => ({ id, name })) };
}

/**
 * Which of the given saved segments an address is in now (ecosystem plan E3.6, D718), for a workflow's condition *the customer is in segment
 * X*: only those segments' rules read, then the address alone through `heldBy()`. A segment that is gone, or whose rules no longer read, holds
 * nobody.
 */
export async function segmentsOfAddress(store: SegmentStore, email: string, segmentIds: readonly string[], now = new Date()): Promise<Set<string>> {
  const wanted = new Set(segmentIds);
  const address = normaliseEmail(email);
  if (!address || wanted.size === 0) return new Set();
  const segments = (await listSegments(store.id)).flatMap((s) => (s.rules && wanted.has(s.id) ? [{ id: s.id, rules: s.rules }] : []));
  return heldBy(store, address, segments, now);
}
