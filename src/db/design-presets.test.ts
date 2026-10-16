import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * Design profiles (D176, D177, docs/design-profiles.md): the rules the database holds. A profile carries a snapshot of version 1 or 2 within
 * its size, is deleted only while unused (else archived, never published while archived) and is no template's recommendation after; its
 * workspace is a hidden store of its own, fixed once set; a use of one is history (never deleted, only marked restored, once); a store
 * template may recommend one, and an access request may carry one.
 */
let db: PGlite;
let store: string;
let account: string;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

async function refused(sql: string, params: unknown[], reason: RegExp): Promise<void> {
  await expect(db.query(sql, params)).rejects.toThrow(reason);
}

const SNAPSHOT = JSON.stringify({ v: 1, theme: { base: "minimal", settings: {} }, header: null, footer: null, productLayout: null, css: "" });

async function preset(title = "Nordic calm"): Promise<string> {
  const { id } = await one<{ id: string }>("insert into commerce.design_presets (title, snapshot) values ($1, $2::jsonb) returning id", [title, SNAPSHOT]);
  return id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  ({ id: store } = await one<{ id: string }>("insert into commerce.stores (slug, name) values ('design-store', 'Design') returning id"));
  ({ id: account } = await one<{ id: string }>("insert into commerce.accounts (email) values ('designer@example.com') returning id"));
});

afterAll(async () => {
  await db.close();
});

describe("design profiles (D176)", () => {
  it("keep their updated time current", async () => {
    const id = await preset();
    const before = await one<{ updated_at: Date }>("select updated_at from commerce.design_presets where id = $1", [id]);
    await db.query("update commerce.design_presets set published = true where id = $1", [id]);
    const after = await one<{ updated_at: Date; published: boolean }>("select updated_at, published from commerce.design_presets where id = $1", [id]);
    expect(after.published).toBe(true);
    expect(new Date(after.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(before.updated_at).getTime());
  });

  it("hold a snapshot of version 1 or 2 only, as an object, and keep their details within their limits", async () => {
    await refused("insert into commerce.design_presets (title, snapshot) values ('x', '{\"v\":3}'::jsonb)", [], /design_presets_snapshot/);
    // Version 2 carries the theme's presets (docs/theme-showcase-phase-1.md).
    await db.query("insert into commerce.design_presets (title, snapshot) values ('x', $1::jsonb)", [SNAPSHOT.replace('"v":1', '"v":2')]);
    await refused("insert into commerce.design_presets (title, snapshot) values ('x', '[1]'::jsonb)", [], /design_presets_snapshot/);
    await refused(
      "insert into commerce.design_presets (title, snapshot) values ('x', jsonb_build_object('v', '1', 'css', repeat('a', 2000001)))",
      [],
      /design_presets_snapshot/,
    );
    await refused("insert into commerce.design_presets (title, snapshot) values ('  ', $1::jsonb)", [SNAPSHOT], /design_presets_title/);
    await refused("insert into commerce.design_presets (title, snapshot, picture_url) values ('x', $1::jsonb, 'javascript:1')", [SNAPSHOT], /design_presets_picture_url/);
    await refused("insert into commerce.design_presets (title, snapshot, summary) values ('x', $1::jsonb, repeat('a', 201))", [SNAPSHOT], /design_presets_summary/);
  });

  it("can be recommended by a store template and chosen on an access request", async () => {
    const id = await preset("Recommended");
    await db.query("update commerce.stores set starter = true where id = $1", [store]);
    const { id: starter } = await one<{ id: string }>(
      "insert into commerce.store_starters (store_id, title, category, recommended_design) values ($1, 'Spa', 'appointments', $2) returning id",
      [store, id],
    );
    expect((await one<{ r: string }>("select recommended_design as r from commerce.store_starters where id = $1", [starter])).r).toBe(id);
    await db.query("insert into commerce.access_requests (email, name, store_name, design_preset_id) values ('kari@example.com', 'Kari', 'Kari', $1)", [id]);
    await refused(
      "insert into commerce.access_requests (email, name, store_name, design_preset_id) values ('ola@example.com', 'Ola', 'Ola', gen_random_uuid())",
      [],
      /foreign key/,
    );
  });
});

describe("a use of a design profile (D176)", () => {
  async function use(): Promise<{ id: string; theme: string }> {
    const presetId = await preset("Used");
    const { id: theme } = await one<{ id: string }>(
      "insert into commerce.store_themes (store_id, name, base, settings) values ($1, 'Before ' || gen_random_uuid(), 'minimal', '{}'::jsonb) returning id",
      [store],
    );
    const { id } = await one<{ id: string }>(
      `insert into commerce.design_preset_uses (store_id, preset_id, previous, saved_theme_id, applied_by)
       values ($1, $2, '{"css": ""}'::jsonb, $3, $4) returning id`,
      [store, presetId, theme, account],
    );
    return { id, theme };
  }

  it("is never deleted, and keeps what it recorded", async () => {
    const { id } = await use();
    await refused("delete from commerce.design_preset_uses where id = $1", [id], /design_preset_uses.kept/);
    await refused("update commerce.design_preset_uses set previous = '{}'::jsonb where id = $1", [id], /design_preset_uses.fixed/);
    await refused("update commerce.design_preset_uses set applied_at = now() - interval '1 day' where id = $1", [id], /design_preset_uses.fixed/);
    await refused("update commerce.design_preset_uses set restored_by = $2 where id = $1", [id, account], /design_preset_uses.fixed/);
    await refused("update commerce.design_preset_uses set previous = '[]'::jsonb where id = $1", [id], /design_preset_uses/);
  });

  it("is marked restored once, and loses its saved theme only when the owner deletes that theme", async () => {
    const { id, theme } = await use();
    await db.query("update commerce.design_preset_uses set restored_at = now(), restored_by = $2 where id = $1", [id, account]);
    await refused("update commerce.design_preset_uses set restored_at = null where id = $1", [id], /design_preset_uses.restored/);
    await refused("update commerce.design_preset_uses set saved_theme_id = gen_random_uuid() where id = $1", [id], /design_preset_uses.fixed/);
    await db.query("delete from commerce.store_themes where id = $1", [theme]);
    expect((await one<{ t: string | null }>("select saved_theme_id as t from commerce.design_preset_uses where id = $1", [id])).t).toBeNull();
  });
});

describe("the life of a design profile (D177)", () => {
  async function starterStore(slug: string): Promise<string> {
    const { id } = await one<{ id: string }>("insert into commerce.stores (slug, name, starter) values ($1, $1, true) returning id", [slug]);
    return id;
  }

  it("is deleted while nothing used it, and a store template recommending it recommends none after (published and drafted)", async () => {
    const id = await preset("Unused");
    const template = await starterStore("rec-template");
    const { id: starter } = await one<{ id: string }>(
      `insert into commerce.store_starters (store_id, title, category, recommended_design, draft)
       values ($1, 'Rec', 'retail', $2::uuid, jsonb_build_object('title', 'Rec', 'category', 'retail', 'recommendedDesign', $3::text)) returning id`,
      [template, id, id],
    );
    await db.query("delete from commerce.design_presets where id = $1", [id]);
    const after = await one<{ recommended_design: string | null; draft: { recommendedDesign: string | null } }>(
      "select recommended_design, draft from commerce.store_starters where id = $1",
      [starter],
    );
    expect(after.recommended_design).toBeNull();
    expect(after.draft.recommendedDesign).toBeNull();
  });

  it("is never deleted once a store applied it or an access request chose it: it is archived instead", async () => {
    const applied = await preset("Applied");
    await db.query(`insert into commerce.design_preset_uses (store_id, preset_id, previous) values ($1, $2, '{}'::jsonb)`, [store, applied]);
    await refused("delete from commerce.design_presets where id = $1", [applied], /design_presets\.used/);
    const chosen = await preset("Chosen");
    await db.query("insert into commerce.access_requests (email, name, store_name, design_preset_id) values ('chooser@example.com', 'C', 'C', $1)", [chosen]);
    await refused("delete from commerce.design_presets where id = $1", [chosen], /design_presets\.requested/);
    await db.query("update commerce.design_presets set archived_at = now() where id = $1", [chosen]);
    await refused("update commerce.design_presets set published = true where id = $1", [chosen], /design_presets_archived_unpublished/);
  });

  it("keeps a draft of its details as an object", async () => {
    const id = await preset("Drafted");
    await db.query(`update commerce.design_presets set draft = '{"title": "Next"}'::jsonb where id = $1`, [id]);
    await refused(`update commerce.design_presets set draft = '[1]'::jsonb where id = $1`, [id], /design_presets_draft/);
  });

  it("has a workspace that is a hidden store of its own, kept once set", async () => {
    const workspace = await starterStore("workspace-one");
    const id = await preset("Workspaced");
    // A real store is no workspace, nor is a store template's store.
    await refused("update commerce.design_presets set workspace_store_id = $2 where id = $1", [id, store], /design_presets\.not_workspace/);
    const template = await starterStore("described-one");
    await db.query("insert into commerce.store_starters (store_id, title, category) values ($1, 'T', 'other')", [template]);
    await refused("update commerce.design_presets set workspace_store_id = $2 where id = $1", [id, template], /design_presets\.not_workspace/);
    await db.query("update commerce.design_presets set workspace_store_id = $2 where id = $1", [id, workspace]);
    const other = await starterStore("workspace-two");
    await refused("update commerce.design_presets set workspace_store_id = $2 where id = $1", [id, other], /design_presets\.workspace_fixed/);
    await refused("update commerce.design_presets set workspace_store_id = null where id = $1", [id], /design_presets\.workspace_fixed/);
    // One profile per workspace; and a workspace never becomes a store template's store.
    await refused("insert into commerce.design_presets (title, snapshot, workspace_store_id) values ('Twin', $1::jsonb, $2)", [SNAPSHOT, workspace], /design_presets_workspace_idx|duplicate/);
    await refused("insert into commerce.store_starters (store_id, title, category) values ($1, 'W', 'other')", [workspace], /store_starters\.not_starter/);
  });
});

describe("themes installed in a store (D241)", () => {
  async function newStore(slug: string): Promise<string> {
    const { id } = await one<{ id: string }>("insert into commerce.stores (slug, name) values ($1, $1) returning id", [slug]);
    return id;
  }
  const LOOK = JSON.stringify({ theme: {}, headerId: null, footerId: null, productLayoutId: null, css: "" });

  it("start with the store's own look as its live Custom install, one live at a time", async () => {
    const id = await newStore("installs-one");
    const rows = (await db.query<{ title: string; live: boolean; look: unknown; preset_id: string | null }>(
      "select title, live, look, preset_id from commerce.store_theme_installs where store_id = $1",
      [id],
    )).rows;
    expect(rows).toEqual([{ title: "Custom", live: true, look: null, preset_id: null }]);
    await refused("insert into commerce.store_theme_installs (store_id, title, live) values ($1, 'Second', true)", [id], /store_theme_installs_live_idx|duplicate/);
    // The live one keeps its look in the store's columns; any other keeps it in the row.
    await refused("insert into commerce.store_theme_installs (store_id, title) values ($1, 'No look')", [id], /store_theme_installs_look/);
    await refused("update commerce.store_theme_installs set look = $2::jsonb where store_id = $1 and live", [id, LOOK], /store_theme_installs_look/);
    await db.query("insert into commerce.store_theme_installs (store_id, title, look) values ($1, 'Put away', $2::jsonb)", [id, LOOK]);
  });

  it("keep what they came from, and the live one is never removed", async () => {
    const id = await newStore("installs-two");
    const presetId = await preset("Installed");
    const { id: put } = await one<{ id: string }>(
      "insert into commerce.store_theme_installs (store_id, preset_id, title, look) values ($1, $2, 'Installed', $3::jsonb) returning id",
      [id, presetId, LOOK],
    );
    await refused("update commerce.store_theme_installs set preset_id = null where id = $1", [put], /store_theme_installs.fixed/);
    await refused("update commerce.store_theme_installs set store_id = $2 where id = $1", [put, store], /store_theme_installs.fixed/);
    await refused("delete from commerce.store_theme_installs where store_id = $1 and live", [id], /store_theme_installs.live/);
    // Switching: the live one is put away with its look, the other made live without one, in one go.
    await db.query("begin");
    await db.query("update commerce.store_theme_installs set live = false, look = $2::jsonb where store_id = $1 and live", [id, LOOK]);
    await db.query("update commerce.store_theme_installs set live = true, look = null where id = $1", [put]);
    await db.query("commit");
    await db.query("delete from commerce.store_theme_installs where store_id = $1 and not live", [id]);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.store_theme_installs where store_id = $1", [id])).n).toBe(1);
    // A theme a store has installed is not deleted.
    await refused("delete from commerce.design_presets where id = $1", [presetId], /foreign key|store_theme_installs/);
  });

  it("are named by a use, which loses the install's id only when it is removed", async () => {
    const id = await newStore("installs-three");
    const presetId = await preset("Used again");
    const { id: install } = await one<{ id: string }>(
      "insert into commerce.store_theme_installs (store_id, preset_id, title, look) values ($1, $2, 'Used again', $3::jsonb) returning id",
      [id, presetId, LOOK],
    );
    const { id: use } = await one<{ id: string }>(
      `insert into commerce.design_preset_uses (store_id, preset_id, previous, previous_install_id) values ($1, $2, '{}'::jsonb, $3) returning id`,
      [id, presetId, install],
    );
    await refused("update commerce.design_preset_uses set install_id = $2 where id = $1", [use, install], /design_preset_uses.fixed/);
    await db.query("delete from commerce.store_theme_installs where id = $1", [install]);
    expect((await one<{ p: string | null }>("select previous_install_id as p from commerce.design_preset_uses where id = $1", [use])).p).toBeNull();
  });
});

describe("a theme's versions (D241)", () => {
  it("are never changed, are numbered from 1 once each, and go only with their theme", async () => {
    const presetId = await preset("Versioned");
    const { id } = await one<{ id: string }>(
      "insert into commerce.design_preset_versions (preset_id, number, snapshot) values ($1, 1, $2::jsonb) returning id",
      [presetId, SNAPSHOT],
    );
    await refused("update commerce.design_preset_versions set snapshot = $2::jsonb where id = $1", [id, SNAPSHOT.replace("minimal", "bold")], /design_preset_versions.fixed/);
    await refused("delete from commerce.design_preset_versions where id = $1", [id], /design_preset_versions.kept/);
    await refused("insert into commerce.design_preset_versions (preset_id, number, snapshot) values ($1, 1, $2::jsonb)", [presetId, SNAPSHOT], /design_preset_versions_number_idx|duplicate/);
    await refused("insert into commerce.design_preset_versions (preset_id, number, snapshot) values ($1, 0, $2::jsonb)", [presetId, SNAPSHOT], /design_preset_versions_number/);
    await db.query("delete from commerce.design_presets where id = $1", [presetId]);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.design_preset_versions where preset_id = $1", [presetId])).n).toBe(0);
  });
});

describe("a theme's presets (docs/theme-showcase-phase-1.md)", () => {
  const THEME = JSON.stringify({ base: "minimal", settings: {} });
  const LOOK = JSON.stringify({ theme: {}, headerId: null, footerId: null, productLayoutId: null, css: "" });

  it("keep their theme and key, at most five besides the theme's own look, and go with their theme", async () => {
    const presetId = await preset("With presets");
    const { id } = await one<{ id: string }>(
      "insert into commerce.design_variations (preset_id, key, name, theme) values ($1, 'coast', 'Coast', $2::jsonb) returning id",
      [presetId, THEME],
    );
    await db.query("update commerce.design_variations set name = 'Coastline', position = 2 where id = $1", [id]);
    await refused("update commerce.design_variations set key = 'shore' where id = $1", [id], /design_variations.fixed/);
    await refused("update commerce.design_variations set preset_id = $2 where id = $1", [id, await preset("Other")], /design_variations.fixed/);
    await refused("insert into commerce.design_variations (preset_id, key, name, theme) values ($1, 'coast', 'Again', $2::jsonb)", [presetId, THEME], /design_variations_key_idx|duplicate/);
    await refused("insert into commerce.design_variations (preset_id, key, name, theme) values ($1, 'Bad Key', 'Bad', $2::jsonb)", [presetId, THEME], /design_variations_key/);
    await refused("insert into commerce.design_variations (preset_id, key, name, theme) values ($1, 'blank', '  ', $2::jsonb)", [presetId, THEME], /design_variations_name/);
    await refused("insert into commerce.design_variations (preset_id, key, name, theme) values ($1, 'list', 'List', '[1]'::jsonb)", [presetId], /design_variations_theme/);
    for (const key of ["two", "three", "four", "five"]) {
      await db.query("insert into commerce.design_variations (preset_id, key, name, theme) values ($1, $2, $2, $3::jsonb)", [presetId, key, THEME]);
    }
    await refused("insert into commerce.design_variations (preset_id, key, name, theme) values ($1, 'six', 'Six', $2::jsonb)", [presetId, THEME], /design_variations.limit/);
    await db.query("delete from commerce.design_variations where id = $1", [id]);
    await db.query("insert into commerce.design_variations (preset_id, key, name, theme) values ($1, 'six', 'Six', $2::jsonb)", [presetId, THEME]);
    await db.query("delete from commerce.design_presets where id = $1", [presetId]);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.design_variations where preset_id = $1", [presetId])).n).toBe(0);
  });

  it("are kept by an install for good", async () => {
    const { id: storeId } = await one<{ id: string }>("insert into commerce.stores (slug, name) values ('variation-installs', 'V') returning id");
    const presetId = await preset("Installed with a preset");
    const { id } = await one<{ id: string }>(
      "insert into commerce.store_theme_installs (store_id, preset_id, title, look, variation) values ($1, $2, 'Coast', $3::jsonb, 'coast') returning id",
      [storeId, presetId, LOOK],
    );
    await refused("update commerce.store_theme_installs set variation = 'shore' where id = $1", [id], /store_theme_installs.variation/);
    await refused("update commerce.store_theme_installs set variation = null where id = $1", [id], /store_theme_installs.variation/);
    const { id: platform } = await one<{ id: string }>(
      "insert into commerce.platform_theme_installs (preset_id, title, look, variation) values ($1, 'Coast', $2::jsonb, 'coast') returning id",
      [presetId, LOOK],
    );
    await refused("update commerce.platform_theme_installs set variation = 'shore' where id = $1", [platform], /platform_theme_installs.variation/);
    await refused("update commerce.platform_theme_installs set variation = null where id = $1", [platform], /platform_theme_installs.variation/);
  });
});
