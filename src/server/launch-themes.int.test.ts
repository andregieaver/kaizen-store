import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { LAUNCH_THEMES } from "@/lib/launch-themes";
import { CORE_SECTION_STYLES } from "@/lib/section-styles";

import type { Account } from "./auth";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const { syncLaunchThemes, launchThemeStates } = await import("./launch-themes");
const designs = await import("./design-presets");

/**
 * Kaizena Flow's launch themes (D246): the platform's sync makes and publishes each from the code, checked; a second press changes nothing;
 * a newer version in the code is published as a new version with its notes; a theme made from scratch gets the core section styles, so it
 * passes the checks, and one that fails them is refused at Publish.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const deps = { installFonts: async () => ({ ok: true as const }) };
let admin: Account;

beforeAll(async () => {
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`launch-${run}@example.com`}, 'Launcher', true) returning id, email`);
  admin = { id: String(row.id), email: String(row.email), name: "Launcher", platformAdmin: true } as Account;
});

afterAll(async () => {
  await closeDb();
});

const presetOf = async (key: string) =>
  (await db().execute<Row>(sql`select id, published, launch_version, snapshot from commerce.design_presets where launch_key = ${key}`))[0];

describe("syncLaunchThemes()", () => {
  it("makes and publishes every launch theme, each with the core section styles", async () => {
    const result = await syncLaunchThemes(admin, deps);
    expect(result.problems).toEqual([]);
    for (const theme of LAUNCH_THEMES) {
      const row = await presetOf(theme.key);
      expect(row?.published, theme.title).toBe(true);
      expect(Number(row?.launch_version)).toBeGreaterThanOrEqual(theme.version);
      const styles = Object.keys((row?.snapshot as { theme: { settings: { sectionStyles: Record<string, unknown> } } }).theme.settings.sectionStyles);
      for (const name of CORE_SECTION_STYLES) expect(styles).toContain(name);
      const [version] = await db().execute<Row>(sql`select count(*)::int as n from commerce.design_preset_versions where preset_id = ${String(row?.id)}::uuid`);
      expect(Number(version.n)).toBeGreaterThanOrEqual(1);
    }
    const states = await launchThemeStates();
    expect(states.every((state) => state.published !== null && state.published >= state.version)).toBe(true);
  });

  it("changes nothing on a second press", async () => {
    const result = await syncLaunchThemes(admin, deps);
    expect(result.made).toEqual([]);
    expect(result.updated).toEqual([]);
    expect(result.current).toHaveLength(LAUNCH_THEMES.length);
  });

  it("publishes a newer version from the code, with its notes as What's new", async () => {
    const theme = LAUNCH_THEMES[0] as { key: string; version: number; notes: string | null; snapshot: { theme: { settings: { light: { accent: string } } } } };
    const before = await presetOf(theme.key);
    const saved = { version: theme.version, notes: theme.notes, accent: theme.snapshot.theme.settings.light.accent };
    try {
      theme.version = Number(before?.launch_version) + 1;
      theme.notes = "A deeper accent.";
      theme.snapshot.theme.settings.light.accent = "#0a0a0a";
      const result = await syncLaunchThemes(admin, deps);
      expect(result.problems).toEqual([]);
      expect(result.updated).toEqual([LAUNCH_THEMES[0].title]);
      const after = await presetOf(theme.key);
      expect(Number(after?.launch_version)).toBe(theme.version);
      const [latest] = await db().execute<Row>(sql`
        select notes, snapshot->'theme'->'settings'->'light'->>'accent' as accent from commerce.design_preset_versions
         where preset_id = ${String(after?.id)}::uuid order by number desc limit 1
      `);
      expect(latest.notes).toBe("A deeper accent.");
      expect(latest.accent).toBe("#0a0a0a");
    } finally {
      theme.version = saved.version;
      theme.notes = saved.notes;
      theme.snapshot.theme.settings.light.accent = saved.accent;
    }
  });
});

describe("the checks at Publish", () => {
  it("lets a theme made from scratch through, with the core section styles filled in", async () => {
    const made = await designs.createDesign(admin, { details: { title: `Scratch ${run}`, summary: "", description: "", pictureUrl: null }, origin: { kind: "scratch" } }, deps);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const design = await designs.getDesign(made.id);
    const checks = design && (await designs.designChecks(design));
    expect(checks?.blocking).toBe(0);
    expect((await designs.publishDesign(admin, made.id)).ok).toBe(true);
  });

  it("refuses a version that does not pass, saying what to fix", async () => {
    const made = await designs.createDesign(admin, { details: { title: `Unreadable ${run}`, summary: "", description: "", pictureUrl: null }, origin: { kind: "scratch" } }, deps);
    if (!made.ok) throw new Error(made.problems.join(" "));
    const snapshot = structuredClone(LAUNCH_THEMES[0].snapshot);
    snapshot.theme.settings.light = { ...snapshot.theme.settings.light, text: "#dddddd" };
    snapshot.theme.settings.mode = "light";
    expect((await designs.writeDesignLook(admin, made.id, snapshot, deps)).ok).toBe(true);
    const result = await designs.publishDesign(admin, made.id);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems[0]).toMatch(/theme checks.*Text on the background/);
    const [versions] = await db().execute<Row>(sql`select count(*)::int as n from commerce.design_preset_versions where preset_id = ${made.id}::uuid`);
    expect(Number(versions.n)).toBe(0);
  });
});
