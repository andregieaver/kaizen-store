import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { LOOK_VERSIONS_KEPT } from "@/lib/look-versions";
import { templateSettings, type StoreTheme } from "@/lib/theme";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { saveStoreTheme, saveThemeTab } = await import("./themes");
const { keepLookVersion, listLookVersions, readLookVersion } = await import("./look-versions");

type Row = Record<string, unknown>;

/**
 * Versions of the live look (wave 7 unit F, D340): each save of the store's theme keeps the theme it left, with what saved it and who, in
 * the same transaction; the same theme twice is kept once; the newest 50 stay; a version is read only by its own store, as a theme the
 * editor can hold. Nothing here changes what visitors see.
 */

const run = Date.now().toString(36);
let owner: Account;
let storeId: string;
let otherId: string;

const minimal = (accent: string): StoreTheme => {
  const settings = templateSettings("minimal");
  return { base: "minimal", savedId: null, settings: { ...settings, light: { ...settings.light, accent } } };
};

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`looks-${run}@example.com`}, 'Kari') returning id, email`);
  owner = { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false };
  storeId = String((await db().execute<Row>(sql`insert into commerce.stores (slug, name) values (${`looks-${run}`}, 'Looks') returning id`))[0].id);
  otherId = String((await db().execute<Row>(sql`insert into commerce.stores (slug, name) values (${`looks-other-${run}`}, 'Other') returning id`))[0].id);
});

afterAll(async () => {
  await closeDb();
});

describe("versions of the live look", () => {
  it("are kept by each save, with what saved it and who, once for the same theme", async () => {
    expect(await saveStoreTheme(owner, storeId, minimal("#112233"))).toMatchObject({ ok: true });
    expect(await saveStoreTheme(owner, storeId, minimal("#112233"))).toMatchObject({ ok: true });
    expect(await saveStoreTheme(owner, storeId, minimal("#445566"))).toMatchObject({ ok: true });
    const current = minimal("#445566");
    expect(await saveThemeTab(owner, { id: storeId, theme: current }, { sections: {}, maxWidth: 1100, background: { light: "#fafafa", dark: "#111111" }, hover: undefined })).toMatchObject({ ok: true });
    const versions = await listLookVersions(storeId);
    expect(versions.map((v) => [v.kind, v.by])).toEqual([
      ["theme_tab", "Kari"],
      ["design", "Kari"],
      ["design", "Kari"],
    ]);
    const first = await readLookVersion(storeId, versions[2].id);
    expect(first?.settings.light.accent).toBe("#112233");
    expect((await readLookVersion(storeId, versions[0].id))?.settings.layout.maxWidth).toBe(1100);
  });

  it("are read only by their own store, and a refused save keeps none", async () => {
    const [newest] = await listLookVersions(storeId);
    expect(await readLookVersion(otherId, newest.id)).toBeNull();
    expect(await listLookVersions(otherId)).toEqual([]);
    const before = (await listLookVersions(storeId)).length;
    expect((await saveStoreTheme(owner, storeId, { ...minimal("#000000"), settings: { ...minimal("#000000").settings, light: { ...minimal("#000000").settings.light, text: "red" } } })).ok).toBe(false);
    expect((await listLookVersions(storeId)).length).toBe(before);
  });

  it(`keep the newest ${LOOK_VERSIONS_KEPT}`, async () => {
    await db().transaction(async (tx) => {
      for (let i = 0; i < LOOK_VERSIONS_KEPT + 3; i++) {
        await keepLookVersion(tx, { store: otherId, kind: "colours", theme: minimal(`#0000${(i + 16).toString(16).padStart(2, "0")}`), account: owner.id });
      }
    });
    const versions = await listLookVersions(otherId);
    expect(versions.length).toBe(LOOK_VERSIONS_KEPT);
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.look_versions where store_id = ${otherId}::uuid`);
    expect(Number(n)).toBe(LOOK_VERSIONS_KEPT);
    expect((await readLookVersion(otherId, versions[0].id))?.settings.light.accent).toBe(`#0000${(LOOK_VERSIONS_KEPT + 2 + 16).toString(16).padStart(2, "0")}`);
  });
});
