import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * Design profiles (D176, D177, docs/design-profiles.md): the rules the database holds. A profile carries a snapshot of version 1 within its
 * size, is deleted only while unused (else archived, never published while archived) and is no template's recommendation after; its
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

  it("hold a snapshot of version 1 only, as an object, and keep their details within their limits", async () => {
    await refused("insert into commerce.design_presets (title, snapshot) values ('x', '{\"v\":2}'::jsonb)", [], /design_presets_snapshot/);
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
