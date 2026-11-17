import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { matches, segmentRulesSchema } from "@/lib/segments";

import { listSegments, segmentPeople, type SegmentStore } from "./segments";
import { currentStore } from "./stores";
import { normaliseEmail } from "@/lib/email-address";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

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
  const held = new Set<string>();
  if (!customerId || wanted.length === 0) return held;
  const [customer] = await runner.execute<Row>(sql`
    select c.email, s.slug from commerce.customers c join commerce.stores s on s.id = c.store_id
    where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid
  `);
  const email = customer?.email ? normaliseEmail(String(customer.email)) : "";
  if (!email) return held;
  // The store as it is now, past the page cache: this is asked while an order is placed.
  const store = await currentStore(String(customer.slug));
  if (!store) return held;
  const rows = await runner.execute<Row>(sql`
    select id, rules from commerce.segments
    where store_id = ${storeId}::uuid and id in (${sql.join(wanted.map((id) => sql`${id}::uuid`), sql`, `)})
  `);
  const rules = rows.flatMap((row) => {
    const parsed = segmentRulesSchema.safeParse(row.rules);
    return parsed.success ? [{ id: String(row.id), rules: parsed.data }] : [];
  });
  if (rules.length === 0) return held;
  const rfm = rules.some((r) => r.rules.conditions.some((c) => c.kind === "rfm"));
  const { people } = await segmentPeople(store, now, { emails: [email], rfm });
  const person = people.find((p) => p.email === email);
  if (!person) return held;
  for (const r of rules) if (matches(r.rules, person, now)) held.add(r.id);
  return held;
}

/**
 * The store's saved segments a person is in now (ecosystem plan E2.4, D713), for their customer page: their facts read once through the
 * segments' one reader (`segmentPeople()` for that address alone) and every segment's rules matched against them, by name; never a query a
 * segment. The customer types (RFM) are read only when a segment asks for one. A segment whose rules no longer read holds nobody. `saved` is
 * how many segments the store has, so a page can say *in none* only where there is one to be in.
 */
export async function segmentsOfPerson(store: SegmentStore, email: string, now = new Date()): Promise<{ saved: number; in: { id: string; name: string }[] }> {
  const address = normaliseEmail(email);
  const saved = await listSegments(store.id);
  const segments = saved.flatMap((s) => (s.rules ? [{ id: s.id, name: s.name, rules: s.rules }] : []));
  if (!address || segments.length === 0) return { saved: saved.length, in: [] };
  const rfm = segments.some((s) => s.rules.conditions.some((c) => c.kind === "rfm"));
  const { people } = await segmentPeople(store, now, { emails: [address], rfm });
  const person = people.find((p) => p.email === address);
  return { saved: saved.length, in: person ? segments.filter((s) => matches(s.rules, person, now)).map(({ id, name }) => ({ id, name })) : [] };
}
