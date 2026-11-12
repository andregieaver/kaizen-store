import { existsSync, readdirSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Kaizena Flow's site served from its own store (D484, bloat review step 0.3). Needs the build CI's `hosts` job makes, whose seed
 * (`e2e/hosts-seed.mjs`) turns the switch on before `pnpm build`, so the store's pages are built with it.
 */
test.skip(!process.env.E2E_CUSTOM_HOSTS, "needs the hosts job: a build made with the switch on");

let market = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The store's own country market has the bare lower-case code as its slug (src/lib/market-slug.ts).
    const [row] = await sql`
      select lower(m.code) as slug from commerce.markets m join commerce.stores s on s.id = m.store_id
      where s.slug = 'kaizenaflow' and m.active order by (m.code = s.country) desc, m.created_at limit 1`;
    market = String(row.slug);
  } finally {
    await sql.end();
  }
});

test("Kaizena Flow's home answers from its store", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
});

// How a visitor reaches it: the store's market at its address on Kaizena Flow's own host (production answers kaizenaflow.com/no from the
// store). /s/kaizenaflow/<market> itself moves to the store's own host and then back here, which `pnpm start` cannot follow on
// `*.localhost` (its redirect comes back relative), so it is not asked here.
test("the store's market answers on Kaizena Flow's own host", async ({ request }) => {
  const response = await request.get(`/${market}`);
  expect(response.status()).toBe(200);
});

test("a platform route stays the platform's", async ({ request }) => {
  const response = await request.get("/admin/sign-in");
  expect(response.status()).toBe(200);
});

test("the build made the store's pages", () => {
  expect(existsSync(".next/server/app/s/kaizenaflow")).toBe(true);
  expect(readdirSync(".next/server/app/s/kaizenaflow").some((name) => name === market || name.startsWith(`${market}.`))).toBe(true);
});
