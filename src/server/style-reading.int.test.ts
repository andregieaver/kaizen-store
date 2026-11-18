import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { styleOver } from "@/lib/style-reading";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));

const { styleReading } = await import("./style-reading");

const run = Date.now().toString(36);
let storeId: string;

const addPage = async (slug: string, published: unknown) => {
  const [page] = await db().execute<Row>(sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at)
    values (${storeId}::uuid, 'page', ${slug}, '{"rows":[]}'::jsonb, ${published === null ? null : JSON.stringify(published)}::jsonb, ${published === null ? null : sql`now()`})
    returning id
  `);
  return String(page.id);
};
const mine = async () => (await styleReading()).find((r) => r.storeId === storeId);

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`style-${run}@example.com`}, 'Owner', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`style-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
});

afterAll(async () => {
  await closeDb();
});

describe("the style text owners add (step 1.23)", () => {
  it("marks a store with 25,000 characters of its own CSS", async () => {
    await db().execute(sql`update commerce.stores set custom_css = ${"a{color:red}".repeat(2084)} where id = ${storeId}::uuid`);
    const row = await mine();
    expect(row?.cssBytes).toBeGreaterThanOrEqual(25_000);
    expect(row && styleOver(row)).toBe(true);
  });

  it("adds the header's CSS to the sum", async () => {
    const before = (await mine())?.cssBytes ?? 0;
    const header = await db().execute<Row>(sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at)
      values (${storeId}::uuid, 'header', ${`top-${run}`}, '{"rows":[]}'::jsonb, ${JSON.stringify({ css: "x".repeat(3000), rows: [] })}::jsonb, now())
      returning id
    `);
    await db().execute(sql`update commerce.stores set header_id = ${String(header[0].id)}::uuid where id = ${storeId}::uuid`);
    expect((await mine())?.cssBytes).toBe(before + 3000);
  });

  it("counts published pages, and those with a motion effect, and no draft", async () => {
    // A new store starts with pages of its own: count what these three add.
    const before = await mine();
    await addPage(`moving-${run}`, { rows: [{ columns: [{ blocks: [{ type: "heading", motion: { enter: { effect: "fade" } } }] }] }] });
    await addPage(`still-${run}`, { rows: [{ columns: [{ blocks: [{ type: "heading" }] }] }] });
    await addPage(`draft-${run}`, null);
    const row = await mine();
    expect(row?.pages).toBe((before?.pages ?? 0) + 2);
    expect(row?.motionPages).toBe((before?.motionPages ?? 0) + 1);
  });

  it("holds one row for Kaizena Flow's own site", async () => {
    const own = (await styleReading()).filter((r) => r.storeId === null);
    expect(own).toHaveLength(1);
  });
});
