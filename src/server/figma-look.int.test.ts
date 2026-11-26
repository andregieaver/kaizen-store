import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseStoreTheme } from "@/lib/theme-schema";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));
// Saving the look checks its fonts are ready (`checkStoreTheme()` → `installFonts()`), which downloaded Inter and Space Grotesk from
// Google Fonts: the test failed main's run 1992 when that download did (D803). `install` below stands in for the typefaces already.
vi.mock("./fonts", async (original) => ({ ...(await original<typeof import("./fonts")>()), installFonts: async () => ({ ok: true }) }));

const { importFigmaLook } = await import("./figma-look");
const { installLook, liveLook, switchToInstall } = await import("./theme-installs");
const { newStore } = await import("./inventory-test-support");

/**
 * A look from a Figma file (D898 F3): a look in the store's theme library, never live, readable in both palettes, its typefaces installed
 * or stood in for; brought again, the same look while it is not live, and a new one beside it once the owner has made it live.
 */

let store: Awaited<ReturnType<typeof newStore>>;

const colours = (primary: string) => [
  { name: "Brand/Primary", color: primary },
  { name: "Background/Default", color: "#f7f3ea" },
  { name: "Text/Default", color: "#c9c3ba" },
  { name: "bg/page", color: "#14110f", mode: "Dark" },
];
const text = [
  { name: "H1", family: "Fancy Grotesk Pro", style: "Bold", size: 64, line: 72 },
  { name: "Body", family: "Inter", style: "Regular", size: 16 },
];
const install = async (family: string) => ({ ok: true as const, family: family === "Fancy Grotesk Pro" ? "Space Grotesk" : family });
const owner = () => ({ account: store.member.account, storeId: store.storeId });

beforeAll(async () => {
  store = await newStore("figmalook");
});

afterAll(async () => {
  await closeDb();
});

describe("a look from a Figma file (D898 F3)", () => {
  it("adds a readable look to the theme library and leaves the live look as it was", async () => {
    const before = await liveLook(store.storeId);
    const made = await importFigmaLook(owner(), { file: "Spring shop", colours: colours("#1f6f5c"), text }, { install });
    if (!made.ok) throw new Error(made.problem);
    expect(made).toMatchObject({ title: "Spring shop (Figma)", created: true });
    expect(made.summary).toContain("Visitors see nothing of it until you make it live.");
    expect(made.notes.some((n) => n.includes("Fancy Grotesk Pro") && n.includes("Space Grotesk"))).toBe(true);
    expect(made.notes.some((n) => n.startsWith("Text/Default is darker"))).toBe(true);

    const kept = await installLook(store.storeId, made.id);
    expect(kept?.live).toBe(false);
    const settings = parseStoreTheme(kept?.look.theme).settings;
    expect(settings).toMatchObject({ mode: "auto", fonts: { heading: "Space Grotesk", body: "Inter" } });
    expect(settings.light.background).toBe("#f7f3ea");
    expect(settings.dark.background).toBe("#14110f");
    expect(settings.library?.colours.map((c) => c.name)).toContain("bg/page (dark)");
    expect(settings.elements?.h1?.typography?.text?.size).toEqual({ value: 64, unit: "px" });

    const after = await liveLook(store.storeId);
    expect(after?.theme).toEqual(before?.theme);
    const [audit] = await db().execute<{ n: number }>(sql`
      select count(*)::int as n from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'store.theme_designed'`);
    expect(audit.n).toBe(1);
  });

  it("brings the same look up to date while it is not live, and makes a new one once it is", async () => {
    const first = await importFigmaLook(owner(), { file: "Autumn", colours: colours("#1f6f5c"), text }, { install });
    if (!first.ok) throw new Error(first.problem);
    const again = await importFigmaLook(owner(), { file: "Autumn", install: first.id, colours: colours("#8a3b12"), text }, { install });
    expect(again).toMatchObject({ ok: true, id: first.id, created: false });
    const saved = parseStoreTheme((await installLook(store.storeId, first.id))?.look.theme).settings.library?.colours.filter((c) => c.name === "Brand/Primary");
    expect(saved?.map((c) => c.color)).toEqual(["#8a3b12"]);

    const live = await switchToInstall(store.storeId, first.id, store.member.account.id);
    expect(live.ok).toBe(true);
    const beside = await importFigmaLook(owner(), { file: "Autumn", install: first.id, colours: colours("#225588"), text }, { install });
    if (!beside.ok) throw new Error(beside.problem);
    expect(beside.created).toBe(true);
    expect(beside.id).not.toBe(first.id);
    expect(beside.notes[0]).toContain("is live, so this is a new look beside it");
    expect(parseStoreTheme((await liveLook(store.storeId))?.theme).settings.library?.colours.find((c) => c.name === "Brand/Primary")?.color).toBe("#8a3b12");
  });

  it("refuses a file with nothing to bring, and what is not a file's styles", async () => {
    expect(await importFigmaLook(owner(), { colours: [], text: [] }, { install })).toMatchObject({ ok: false });
    expect(await importFigmaLook(owner(), { colours: [{ name: "x", color: "red" }], text: [] }, { install })).toMatchObject({ ok: false });
  });
});
