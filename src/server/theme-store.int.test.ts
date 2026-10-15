import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const { syncLaunchThemes } = await import("./launch-themes");
const designs = await import("./design-presets");
const store = await import("./theme-store");

/**
 * The theme store's data (`docs/theme-phase-3.md` step 1): launch themes listed at their key, an admin's listing saved at once and refused
 * for an address another theme has, and the store's reads showing only published, unarchived themes with an address, with a changelog.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const deps = { installFonts: async () => ({ ok: true as const }) };
let admin: Account;

beforeAll(async () => {
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`store-${run}@example.com`}, 'Lister', true) returning id, email`);
  admin = { id: String(row.id), email: String(row.email), name: "Lister", platformAdmin: true } as Account;
  expect((await syncLaunchThemes(admin, deps)).problems).toEqual([]);
});

afterAll(async () => {
  await closeDb();
});

describe("the theme store's data", () => {
  it("lists the launch themes at their keys, with their listings", async () => {
    const cards = await store.themeStoreCards();
    const calm = cards.find((card) => card.slug === "calm");
    expect(calm?.title).toBe("Calm");
    expect(cards.find((card) => card.slug === "hearth")?.listing).toEqual({ kinds: ["food", "home", "crafts"], styles: ["warm", "classic"] });
    expect(calm?.features).toContain("dark");
  });

  it("draws a theme's page with what it includes and its changelog, and nothing for an unknown address", async () => {
    const page = await store.themeStorePage("fjord");
    expect(page?.sectionStyles).toEqual(expect.arrayContaining(["Plain", "Hero", "Quote"]));
    expect(page?.changelog.at(-1)?.lines).toEqual(["The first version."]);
    expect(page?.version).toBeGreaterThanOrEqual(1);
    expect(await store.themeStorePage(`nothing-${run}`)).toBeNull();
  });

  it("saves an admin's listing, refuses another theme's address, and shows a theme only while it is published", async () => {
    const made = await designs.createDesign(admin, { details: { title: `Listed ${run}`, summary: "", description: "", pictureUrl: null }, origin: { kind: "scratch" } }, deps);
    if (!made.ok) throw new Error(made.problems.join(" "));
    expect(await designs.saveThemeListing(admin, made.id, "calm", { kinds: [], styles: [] })).toEqual({ ok: false, problems: ["Another theme has that address. Choose another."] });
    const slug = `listed-${run}`;
    expect(await designs.saveThemeListing(admin, made.id, slug, { kinds: ["food"], styles: ["warm"] })).toEqual({ ok: true });
    // Not published yet: not in the store.
    expect((await store.themeStoreCards()).some((card) => card.slug === slug)).toBe(false);
    expect((await designs.publishDesign(admin, made.id)).ok).toBe(true);
    expect((await store.themeStoreCards()).find((card) => card.slug === slug)?.listing).toEqual({ kinds: ["food"], styles: ["warm"] });
    // Unpublished: gone again.
    expect((await designs.unpublishDesign(admin, made.id)).ok).toBe(true);
    expect(await store.themeStorePage(slug)).toBeNull();
  });
});
