import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { runOwnerTool, preflightOwnerTool } = await import("./owner-tools");
const { getStore } = await import("./stores");
const search = await import("./search");

type Row = Record<string, unknown>;
// The answers are read as the model reads them: loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

/**
 * The AI manager's search tools (wave 6 unit F3, D324, `docs/wave-6-catalogue.md` F.3), run as the assistant runs them: what the Search page would
 * refuse is refused before a yes is asked, a kept change goes through the page's own writers, and a member without the Settings keys gets nothing.
 */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let slug: string;
let otherSlug: string;
let account: Account;

async function makeStore(name: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'T', 'T') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'T', null)`);
  return name;
}

const ctx = async (storeSlug: string, holder: { role: "owner" | "admin"; permissions?: string[] } = { role: "owner" }) => ({
  account,
  store: (await getStore(storeSlug))!,
  invalidate: () => {},
  holder: holder as never,
});

beforeAll(async () => {
  slug = await makeStore(`stools-${run}`);
  otherSlug = await makeStore(`stools-other-${run}`);
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`stools-account-${run}@example.com`}, 'S') returning id, email`);
  account = { id: String(row.id), email: String(row.email), name: "S" } as Account;
});

afterAll(async () => {
  await closeDb();
});

describe("the search tools", () => {
  it("refuse before a yes what the Search page would refuse", async () => {
    const c = await ctx(slug);
    await expect(preflightOwnerTool(c, "save_search_synonym", { language: "de-DE", kind: "both", words: ["a1", "b1"] })).rejects.toThrow(/store's languages/);
    await expect(preflightOwnerTool(c, "save_search_synonym", { language: "nb-NO", kind: "both", words: ["sofa"] })).rejects.toThrow(/2 to 20/);
    await expect(preflightOwnerTool(c, "save_search_rule", { action: "pin", product: "no-such-product", searches: ["x"] })).rejects.toThrow(/no product/);
    await expect(preflightOwnerTool(c, "save_search_rule", { action: "boost", category: "no-such" })).rejects.toThrow(/no category/);
    await expect(preflightOwnerTool(c, "save_search_rule", { action: "redirect", page: "https://example.org/x", searches: ["salg"] })).rejects.toThrow(/page of the store/);
    await expect(preflightOwnerTool(c, "delete_search_merchandising", { rule: "00000000-0000-4000-8000-000000000001" })).rejects.toThrow(/not the store's/);
    await expect(preflightOwnerTool(c, "save_search_rule", { action: "pin", product: "demo-notatbok", searches: ["kopp"] })).resolves.toBeUndefined();
  });

  it("change what shoppers find through the page's own writers, and read it back in sentences", async () => {
    const c = await ctx(slug);
    expect(await runOwnerTool(c, "save_search_synonym", { language: "nb-NO", kind: "both", words: ["skvulpefat", "keramikkopp"] })).toMatchObject({ id: expect.any(String) });
    expect(await runOwnerTool(c, "save_search_rule", { action: "pin", product: "demo-notatbok", searches: ["skvulpefat"] })).toMatchObject({ id: expect.any(String) });
    const found = await search.searchProducts({ storeId: c.store.id, market: no }, "skvulpefat", null, null);
    expect(found.products.slice(0, 2).map((p) => p.handle)).toEqual(["demo-notatbok", "demo-keramikkopp"]);
    const read = (await runOwnerTool(c, "search_merchandising", {})) as Answer;
    expect(read.synonyms).toEqual([expect.objectContaining({ language: "nb-NO", line: "skvulpefat = keramikkopp" })]);
    expect(read.rules).toEqual([expect.objectContaining({ action: "pin", line: expect.stringMatching(/^Put ".+" first for searches containing "skvulpefat"\.$/) })]);
    expect(read.admin).toBe(`/admin/${slug}/search`);
    // Removing it, and another store sees none of it.
    expect(await runOwnerTool(c, "delete_search_merchandising", { rule: read.rules[0].id })).toMatchObject({ done: expect.any(String) });
    const other = (await runOwnerTool(await ctx(otherSlug), "search_merchandising", {})) as Answer;
    expect(other.synonyms).toEqual([]);
    expect(other.rules).toEqual([]);
  });

  it("answer a member only what the Settings keys allow", async () => {
    const reader = await ctx(slug, { role: "admin", permissions: ["settings:read"] });
    await expect(runOwnerTool(reader, "search_merchandising", {})).resolves.toMatchObject({ admin: expect.any(String) });
    await expect(runOwnerTool(reader, "save_search_synonym", { language: "nb-NO", kind: "both", words: ["a1", "b1"] })).rejects.toThrow();
    const none = await ctx(slug, { role: "admin", permissions: ["orders:read"] });
    await expect(runOwnerTool(none, "search_merchandising", {})).rejects.toThrow();
  });
});
