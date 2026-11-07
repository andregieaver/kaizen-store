import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb } from "@/db/client";
import { newPageContent, type PageBlock, type PageContent } from "@/lib/page-content";

import { makeAccount, makeStore } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const pages = await import("./pages");
const { houseStoreId } = await import("./house-customers");

/**
 * Kaizena Flow's own store serves its site (D484), so the pages copied from the platform's own (D469) keep saving: its header with
 * *Start your store* and its pricing page with the plans. Any other store is still refused both.
 */

const run = Date.now().toString(36);
const fonts = async () => ({ ok: true as const });
const withBlock = (slug: string, block: PageBlock): PageContent => ({
  ...newPageContent(),
  title: slug,
  slug,
  rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [block] }] }],
});
const signUp = { id: "su", type: "site", part: "signUp" } as PageBlock;
const plans: PageBlock = { id: "pl", type: "plans", buttonLabel: "", buttonHref: "/sign-up" };

afterAll(async () => {
  await closeDb();
});

describe("Kaizena Flow's own store's pages", () => {
  it("saves its header with Start your store, and its pricing page with the plans", async () => {
    const house = await houseStoreId();
    expect(house).not.toBeNull();
    // Only platform admins work in Kaizena Flow's own store (D466).
    const account = await makeAccount("house-pages", { platformAdmin: true });
    const header = await pages.savePage(account, house, null, withBlock(`house-header-${run}`, signUp), { publish: false, type: "header", fonts });
    expect(header).toMatchObject({ ok: true });
    const pricing = await pages.savePage(account, house, null, withBlock(`house-pricing-${run}`, plans), { publish: false, type: "page", fonts });
    expect(pricing).toMatchObject({ ok: true });
  });

  it("still refuses both on any other store", async () => {
    const store = await makeStore("not-house");
    const header = await pages.savePage(store.account, store.id, null, withBlock(`header-${run}`, signUp), { publish: true, type: "header", fonts });
    expect(header).toEqual({ ok: false, problems: ["A store's site has no Start your store button."] });
    const pricing = await pages.savePage(store.account, store.id, null, withBlock(`pricing-${run}`, plans), { publish: true, type: "page", fonts });
    expect(pricing).toMatchObject({ ok: false, problems: [expect.stringContaining("Kaizena Flow's own pages")] });
  });
});
