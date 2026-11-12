import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { prerenderedShops } = await import("./shop");

/** What the build prerenders (D484, bloat review step 0.3): the template store's markets, and Kaizena Flow's own while its site is served from it. */

let id: string | null = null;

async function switchOff() {
  if (!id) return;
  await db().execute(sql`select commerce.set_site_from_store(false, null)`);
  await db().execute(sql`delete from commerce.accounts where email = 'step03@example.com'`);
  id = null;
}

afterAll(async () => {
  await switchOff();
  await closeDb();
});

describe("prerenderedShops()", () => {
  it("is the template store's markets alone while the switch is off", async () => {
    const shops = await prerenderedShops();
    expect(shops.length).toBeGreaterThan(0);
    expect(shops.some((s) => s.store === "kaizenaflow")).toBe(false);
  });

  it("adds Kaizena Flow's own store's markets while its site is served from it", async () => {
    const before = await prerenderedShops();
    try {
      const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, platform_admin) values ('step03@example.com', true) returning id`);
      id = String(account.id);
      await db().execute(sql`select commerce.set_site_from_store(true, ${id}::uuid)`);
      const shops = await prerenderedShops();
      expect(shops.some((s) => s.store === "kaizenaflow")).toBe(true);
      for (const entry of before) expect(shops).toContainEqual(entry);
    } finally {
      await switchOff();
    }
  });
});
