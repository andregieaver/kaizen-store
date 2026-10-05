import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { makeStore, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); }, permanentRedirect: () => { throw new Error("NEXT_REDIRECT"); }, redirect: () => { throw new Error("NEXT_REDIRECT"); } }));

const { termMetadata } = await import("@/app/s/[store]/[market]/term-listing");

/**
 * The category's page as search engines and shares meet it (wave 2, second run, D168, `docs/wave-2-redirects.md` 2.4.1, 6.3 S3): the SEO title and description of
 * the market's language as written (the title without the store's name), else the name and the store's description as before, never another language's text;
 * the share tags carry the same; the canonical is the page's own address and every country and language view of it is an alternate.
 */

let fx: Fixture;
const label = "termmeta";

beforeAll(async () => {
  fx = await makeStore(label);
  await db().execute(sql`
    update commerce.terms
       set seo = ${JSON.stringify({ "sv-SE": { title: "Hem och kök", description: "Allt för hemmet." }, "nb-NO": { title: "", description: "Alt til hjemmet." } })}::jsonb
     where store_id = ${fx.storeId}::uuid and kind = 'category' and slug = 'hjem'`);
});

afterAll(async () => {
  await closeDb();
});

const metadata = (market: string) => termMetadata("category", Promise.resolve({ store: fx.slug, market, slug: "hjem" }));
const titleOf = (m: Awaited<ReturnType<typeof metadata>>) => m.title;

describe("a category's page metadata", () => {
  it("uses the language's own title as written (no store name) and its description, in the share tags too", async () => {
    const swedish = await metadata("se");
    expect(titleOf(swedish)).toEqual({ absolute: "Hem och kök" });
    expect(swedish.description).toBe("Allt för hemmet.");
    expect(swedish.openGraph?.title).toBe("Hem och kök");
    expect(swedish.openGraph?.description).toBe("Allt för hemmet.");
    expect(swedish.twitter?.title).toBe("Hem och kök");
  });

  it("falls back to the name (the layout's template adds the store) for a language with no title, and takes only the text the language has", async () => {
    const norwegian = await metadata("no");
    expect(titleOf(norwegian)).toBe("Hjem");
    // The Norwegian description is the owner's own; the Swedish title and description never reach a Norwegian page.
    expect(norwegian.description).toBe("Alt til hjemmet.");
    expect(JSON.stringify(norwegian)).not.toContain("Hem och kök");
    expect(JSON.stringify(norwegian)).not.toContain("Allt för hemmet.");
    // Danish has nothing: the name, and the store's own description, not another language's.
    const danish = await metadata("dk");
    expect(titleOf(danish)).toBe("Hjem");
    expect(JSON.stringify(danish)).not.toContain("Alt til hjemmet.");
    expect(JSON.stringify(danish)).not.toContain("Allt för hemmet.");
  });

  it("names its own address as the canonical and every country and language view as an alternate", async () => {
    const swedish = await metadata("se");
    expect(swedish.alternates?.canonical).toBe(`/s/${fx.slug}/se/category/hjem`);
    const languages = swedish.alternates?.languages as Record<string, string>;
    expect(languages["sv-SE"]).toBe(`/s/${fx.slug}/se/category/hjem`);
    expect(languages["nb-NO"]).toBe(`/s/${fx.slug}/no/category/hjem`);
    expect(languages["da-DK"]).toBe(`/s/${fx.slug}/dk/category/hjem`);
    expect(languages["x-default"]).toBeDefined();
  });

  it("gives nothing for a category that is not there", async () => {
    expect(await termMetadata("category", Promise.resolve({ store: fx.slug, market: "no", slug: "finnes-ikke" }))).toEqual({});
    expect(await termMetadata("tag", Promise.resolve({ store: fx.slug, market: "no", slug: "hjem" }))).toEqual({});
  });
});
