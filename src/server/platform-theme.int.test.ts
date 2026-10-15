import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { templateSettings } from "@/lib/theme";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const themes = await import("./themes");
const navigation = await import("./platform-navigation");
const elements = await import("./theme-elements");
const fixtures = await import("./trust-fixtures");

/**
 * Kaizen's own theme (D235): the platform's page builder has the store builder's Theme tab and saved colours, kept in
 * `platform_settings.theme` in a store's shape, Minimal until changed (what Kaizen's site always looked like), with Kaizen's
 * own fonts laid over it, and laid under Kaizen's pages' parts as a store's theme is under its pages'.
 */

let admin: Account;
let before: unknown;

beforeAll(async () => {
  admin = await fixtures.makeAccount(`theme-admin-${Date.now().toString(36)}`, { platformAdmin: true });
  const [row] = await db().execute<Record<string, unknown>>(sql`select theme from commerce.platform_settings where id`);
  before = row?.theme ?? null;
  await db().execute(sql`update commerce.platform_settings set theme = null where id`);
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set theme = ${before === null ? null : JSON.stringify(before)}::jsonb where id`);
  await closeDb();
});

describe("Kaizena Flow's theme", () => {
  it("is Minimal with Kaizena Flow's own fonts until it is changed", () => {
    const fonts = { body: { family: "Inter" } } as never;
    const theme = navigation.platformTheme(null, fonts);
    expect(theme.base).toBe("minimal");
    expect(theme.settings).toEqual({ ...templateSettings("minimal"), fonts });
  });

  it("keeps what the Theme tab sends, and Kaizena Flow's pages are drawn over it", async () => {
    const tab = { elements: { h2: { typography: { text: { color: "#123456" } } } }, maxWidth: 1200, background: { light: "#fafaf9", dark: "#0a0a0a" } };
    const saved = await themes.savePlatformThemeTab(admin, tab);
    expect(saved, JSON.stringify(saved)).toMatchObject({ ok: true });
    const theme = await navigation.getPlatformTheme();
    expect(theme.settings.layout.maxWidth).toBe(1200);
    expect(theme.settings.light.background).toBe("#fafaf9");
    expect(await elements.themeElementsFor(null)).toMatchObject({ h2: { typography: { text: { color: "#123456" } } } });
    const [entry] = await db().execute<Record<string, unknown>>(sql`
      select action, store_id from commerce.audit_log where account_id = ${admin.id}::uuid order by created_at desc limit 1`);
    expect(entry).toMatchObject({ action: "platform.theme_updated", store_id: null });
  });

  it("keeps saved colours without touching the rest, and refuses what a store's would refuse", async () => {
    const saved = await themes.savePlatformThemeLibrary(admin, { colours: [{ id: "c1", name: "Ink", color: "#101010" }], gradients: [] });
    expect(saved.ok).toBe(true);
    const theme = await navigation.getPlatformTheme();
    expect(theme.settings.library?.colours).toHaveLength(1);
    expect(theme.settings.layout.maxWidth).toBe(1200);
    expect((await themes.savePlatformThemeTab(admin, { maxWidth: 10, background: { light: "#ffffff", dark: "#000000" } })).ok).toBe(false);
    expect((await themes.savePlatformThemeLibrary(admin, { colours: [{ id: "c2", name: "Bad", color: "red" }], gradients: [] })).ok).toBe(false);
  });
});
