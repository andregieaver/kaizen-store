import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { passMembership } = await import("./auth");
const { dreamShowcase } = await import("./dream-showcase");

/** What a Dream Factory run has made so far (D419), read from a real store's records: only what was made since the run began, only its own. */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);

async function newStore(name: string, email: string): Promise<{ id: string; slug: string; owner: string }> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${email}, 'Kari', ${name}) returning id
  `);
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${run}`;
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${name}, null) as id`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where lower(email) = lower(${email})`);
  return { id: String(store.id), slug, owner: String(owner.id) };
}

let started: Date;
let mine: { id: string; slug: string; owner: string };
let other: { id: string; slug: string; owner: string };

beforeAll(async () => {
  started = new Date(Date.now() - 1000);
  // Each store is a copy of the Standard store, made after the run "began": its products and pages count as made by it.
  mine = await newStore("Showcase mine", `showcase-${run}@example.com`);
  other = await newStore("Showcase other", `showcase-other-${run}@example.com`);
  await db().execute(sql`
    insert into commerce.research_notes (store_id, topic, finding, sources) values
      (${mine.id}::uuid, 'Ceramics in Norway', 'Handmade mugs sell at 300 to 600 kroner.', array['https://www.example.com/a', 'https://example.com/b', 'not an address']),
      (${other.id}::uuid, 'Not mine', 'Another store''s note.', '{}')
  `);
  await db().execute(sql`
    insert into commerce.assistant_goals (store_id, title) values (${mine.id}::uuid, 'First ten orders'), (${mine.id}::uuid, 'Dropped goal')
  `);
  await db().execute(sql`update commerce.assistant_goals set status = 'dropped' where store_id = ${mine.id}::uuid and title = 'Dropped goal'`);
  // The brand step's marks are named after the brand's name, not the store's address (`makeBrandMarks()`).
  await db().execute(sql`
    insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes)
    select ${mine.id}::uuid, 'image', 'https://cdn.example.com/' || ${run} || '/' || name, 'media', ${run} || '/' || name, name, 'image/png', 1000
    from unnest(array['leire-logo.png', 'leire-logo-dark.png', 'leire-icon.png']) as name
  `);
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("what a Dream Factory run has made (D419)", () => {
  it("reads the store's own notes, products, pages and goals made since the run began", async () => {
    const member = (await passMembership(mine.slug, mine.owner))!;
    const show = await dreamShowcase(member.store, { createdAt: started });

    expect(show.notes).toEqual([{ topic: "Ceramics in Norway", finding: "Handmade mugs sell at 300 to 600 kroner.", sites: ["example.com"], at: expect.any(String) }]);
    expect(show.goals).toEqual(["First ten orders"]);
    expect(show.marks).toMatchObject({ logo: `https://cdn.example.com/${run}/leire-logo.png`, icon: `https://cdn.example.com/${run}/leire-icon.png` });
    expect(show.feed.some((item) => item.kind === "mark")).toBe(true);
    expect(show.productCount).toBeGreaterThan(0);
    expect(show.products.length).toBe(Math.min(show.productCount, 8));
    for (const product of show.products) {
      expect(product.title).not.toBe("");
      if (product.price !== null) expect(product.price).toMatch(/\d/);
    }
    expect(show.feed.length).toBeGreaterThan(0);
    expect(show.feed.length).toBeLessThanOrEqual(8);
    expect([...show.feed].sort((a, b) => b.at.localeCompare(a.at))).toEqual(show.feed);
    expect(show.feed.some((item) => item.label === "Not mine")).toBe(false);
  });

  it("shows nothing made before the run began", async () => {
    const member = (await passMembership(mine.slug, mine.owner))!;
    const show = await dreamShowcase(member.store, { createdAt: new Date(Date.now() + 60_000) });
    expect(show).toMatchObject({ notes: [], products: [], productCount: 0, goals: [], legal: [], feed: [], look: null, marks: { logo: null, icon: null } });
  });
});
