import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { templateSettings } from "@/lib/theme";

import type { Account } from "./auth";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const { deleteSavedTheme, listSavedThemes, saveSavedTheme, saveStoreTheme } = await import("./themes");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let owner: Account;
let storeId: string;
let otherId: string;

beforeAll(async () => {
  // The Warm theme's fonts, installed as `installFont` leaves them, so nothing is fetched here.
  await db().execute(sql`
    insert into commerce.fonts (family, slug, category, css, bytes) values
      ('Playfair Display', 'playfair-display', 'serif', '.kf-playfair-display {}', 1),
      ('Lora', 'lora', 'serif', '.kf-lora {}', 1)
    on conflict do nothing
  `);
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`themes-${run}@example.com`}, 'Owner') returning id, email
  `);
  owner = { id: String(account.id), email: String(account.email), name: "Owner", platformAdmin: false };
  const [store] = await db().execute<Row>(sql`insert into commerce.stores (slug, name) values (${`themes-${run}`}, 'Themes') returning id`);
  const [other] = await db().execute<Row>(sql`insert into commerce.stores (slug, name) values (${`themes-other-${run}`}, 'Other') returning id`);
  storeId = String(store.id);
  otherId = String(other.id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.fonts where css in ('.kf-playfair-display {}', '.kf-lora {}')`);
  await closeDb();
});

describe("design themes (D60)", () => {
  it("puts a template on the storefront, changed or not, and refuses what it cannot draw", async () => {
    // A store without a theme shows Minimal.
    expect((await getStore(`themes-${run}`))?.theme).toEqual({ base: "minimal", savedId: null, settings: templateSettings("minimal") });

    const warm = templateSettings("warm");
    const changed = { ...warm, light: { ...warm.light, accent: "#123456" } };
    expect(await saveStoreTheme(owner, storeId, { base: "warm", savedId: null, settings: changed })).toMatchObject({ ok: true });
    const store = await getStore(`themes-${run}`);
    expect(store?.theme.settings.light.accent).toBe("#123456");
    expect(store?.fonts).toEqual({ heading: "Playfair Display", body: "Lora" });

    expect(
      await saveStoreTheme(owner, storeId, { base: "warm", savedId: null, settings: { ...warm, light: { ...warm.light, text: "red" } } }),
    ).toEqual({ ok: false, problems: ["A colour is written as # and six hex digits, like #1f2937."] });
    expect(
      await saveStoreTheme(owner, storeId, { base: "warm", savedId: null, settings: { ...warm, fonts: { heading: "Comic Sans MS" } } }),
    ).toEqual({ ok: false, problems: ["Comic Sans MS is not in Google Fonts."] });
    expect(await saveStoreTheme(owner, storeId, { base: "gothic", savedId: null, settings: warm })).toMatchObject({ ok: false });
  });

  it("saves themes under a name, updates and deletes them, each store its own", async () => {
    const settings = templateSettings("warm");
    const first = await saveSavedTheme(owner, storeId, { id: null, name: "Autumn", base: "warm", settings });
    if (!first.ok) throw new Error(first.problems.join(" "));
    expect(await saveSavedTheme(owner, storeId, { id: null, name: "autumn", base: "warm", settings })).toEqual({
      ok: false,
      problems: ["The store already has a theme called “autumn”. Choose another name."],
    });
    // Another store may use the name; neither sees the other's.
    expect(await saveSavedTheme(owner, otherId, { id: null, name: "Autumn", base: "minimal", settings: templateSettings("minimal") })).toMatchObject({
      ok: true,
    });
    const darker = { ...settings, mode: "dark" as const };
    expect(await saveSavedTheme(owner, storeId, { id: first.theme.id, name: "Autumn nights", base: "warm", settings: darker })).toMatchObject({
      ok: true,
    });
    expect((await listSavedThemes(storeId)).map((t) => [t.name, t.settings.mode])).toEqual([["Autumn nights", "dark"]]);
    // An id from another store's saved themes does not update it.
    const [others] = await listSavedThemes(otherId);
    expect(await saveSavedTheme(owner, storeId, { id: others.id, name: "Hijack", base: "warm", settings })).toEqual({
      ok: false,
      problems: ["That theme is gone. Save it as a new one."],
    });

    // On the store, tied to the saved theme; another store's saved theme cannot be tied.
    expect(await saveStoreTheme(owner, storeId, { base: "warm", savedId: first.theme.id, settings: darker })).toMatchObject({
      ok: true,
      theme: { savedId: first.theme.id },
    });
    expect(await saveStoreTheme(owner, storeId, { base: "warm", savedId: others.id, settings: darker })).toMatchObject({
      ok: true,
      theme: { savedId: null },
    });
    await saveStoreTheme(owner, storeId, { base: "warm", savedId: first.theme.id, settings: darker });

    // Deleting it keeps the look, no longer tied to it.
    expect(await deleteSavedTheme(owner, otherId, first.theme.id)).toBe(false);
    expect(await deleteSavedTheme(owner, storeId, first.theme.id)).toBe(true);
    expect(await listSavedThemes(storeId)).toEqual([]);
    const store = await getStore(`themes-${run}`);
    expect(store?.theme).toMatchObject({ base: "warm", savedId: null, settings: { mode: "dark" } });
  });
});
