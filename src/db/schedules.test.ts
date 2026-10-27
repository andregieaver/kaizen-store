import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * Changes by the clock and links to share (wave 7 unit F, D340) as the database holds them: a schedule's way back is settled once and only
 * after its publish; a theme's plan names its own store's install; a preview link opens one of its own store's pages or themes, keeps its
 * token's hash and expiry as made (30 days at most) and is revoked once; a version of the look is never changed.
 */

let db: PGlite;
let store: string;
let other: string;
let page: string;
let otherPage: string;
let custom: string;
let second: string;
let otherInstall: string;
let account: string;

const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
const HASH = "a".repeat(64);

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "sched-a");
  other = await createInvoiceStore(db, "sched-b");
  page = await scalar<string>("insert into commerce.pages (store_id, type, slug, draft) values ($1, 'page', 'sale', '{}'::jsonb) returning id", [store]);
  otherPage = await scalar<string>("insert into commerce.pages (store_id, type, slug, draft) values ($1, 'page', 'about', '{}'::jsonb) returning id", [other]);
  custom = await scalar<string>("select id from commerce.store_theme_installs where store_id = $1 and live", [store]);
  second = await scalar<string>("insert into commerce.store_theme_installs (store_id, title, look) values ($1, 'Calm', '{}'::jsonb) returning id", [store]);
  otherInstall = await scalar<string>("select id from commerce.store_theme_installs where store_id = $1 and live", [other]);
  account = await scalar<string>("insert into commerce.accounts (email, name) values ('sched@example.com', 'Kari') returning id");
});

afterAll(async () => {
  await db.close();
});

describe("a page's way back", () => {
  it("has a time exactly when it has a state, after the publish", async () => {
    await rejects("insert into commerce.page_schedules (store_id, page_id, publish_at, revert_at) values ($1, $2, now() + interval '1 day', now() + interval '2 days')", [store, page], /page_schedules_revert/);
    await rejects(
      "insert into commerce.page_schedules (store_id, page_id, publish_at, revert_at, revert_status) values ($1, $2, now() + interval '1 day', now(), 'waiting')",
      [store, page],
      /page_schedules_revert/,
    );
  });

  it("runs only after its publish, is settled once, and is fixed once the publish ran", async () => {
    const id = await scalar<string>(
      "insert into commerce.page_schedules (store_id, page_id, publish_at, revert_at, revert_status) values ($1, $2, now() + interval '1 day', now() + interval '2 days', 'waiting') returning id",
      [store, page],
    );
    await rejects("update commerce.page_schedules set revert_status = 'done' where id = $1", [id], /page_schedules\.revert_order/);
    // A publish that did not happen leaves no way back waiting.
    await rejects("update commerce.page_schedules set status = 'failed', done_at = now() where id = $1", [id], /page_schedules\.revert_orphan/);
    await db.query("update commerce.page_schedules set status = 'done', done_at = now(), before_content = '{}'::jsonb, published_hash = 'x' where id = $1", [id]);
    await rejects("update commerce.page_schedules set revert_at = revert_at + interval '1 day' where id = $1", [id], /page_schedules\.revert_fixed/);
    await rejects("update commerce.page_schedules set published_hash = 'y' where id = $1", [id], /page_schedules\.revert_fixed/);
    await db.query("update commerce.page_schedules set revert_status = 'done', reverted_at = now() where id = $1", [id]);
    await rejects("update commerce.page_schedules set revert_status = 'waiting' where id = $1", [id], /page_schedules\.revert_settled/);
  });

  it("waits once a page", async () => {
    await db.query(
      "insert into commerce.page_schedules (store_id, page_id, publish_at, status, done_at, revert_at, revert_status) values ($1, $2, now() - interval '1 hour', 'done', now(), now() + interval '1 day', 'waiting')",
      [store, page],
    );
    await rejects(
      "insert into commerce.page_schedules (store_id, page_id, publish_at, status, done_at, revert_at, revert_status) values ($1, $2, now() - interval '1 hour', 'done', now(), now() + interval '2 days', 'waiting')",
      [store, page],
      /page_schedules_one_revert_idx/,
    );
  });
});

describe("a theme's plan", () => {
  it("names one of its own store's installs and starts waiting", async () => {
    await rejects("insert into commerce.theme_schedules (store_id, install_id, live_at) values ($1, $2, now())", [store, otherInstall], /theme_schedules\.install/);
    await rejects("insert into commerce.theme_schedules (store_id, install_id, live_at, status) values ($1, $2, now(), 'done')", [store, second], /theme_schedules\.new/);
    await rejects("insert into commerce.theme_schedules (store_id, install_id, live_at, revert_at) values ($1, $2, now(), now() + interval '1 day')", [store, second], /theme_schedules\.new/);
  });

  it("waits once a store, writes the theme before when it runs, and is settled once", async () => {
    const id = await scalar<string>(
      "insert into commerce.theme_schedules (store_id, install_id, live_at, revert_at, revert_status, scheduled_by) values ($1, $2, now(), now() + interval '1 day', 'waiting', $3) returning id",
      [store, second, account],
    );
    await rejects("insert into commerce.theme_schedules (store_id, install_id, live_at) values ($1, $2, now())", [store, second], /theme_schedules_one_waiting_idx/);
    await rejects("update commerce.theme_schedules set before_install_id = $2 where id = $1", [id, otherInstall], /theme_schedules\.before/);
    await rejects("update commerce.theme_schedules set install_id = $2 where id = $1", [id, custom], /theme_schedules\.fixed/);
    await db.query("update commerce.theme_schedules set status = 'done', done_at = now(), before_install_id = $2 where id = $1", [id, custom]);
    await rejects("update commerce.theme_schedules set before_install_id = $2 where id = $1", [id, second], /theme_schedules\.before/);
    await rejects("update commerce.theme_schedules set status = 'cancelled' where id = $1", [id], /theme_schedules\.settled/);
    await db.query("update commerce.theme_schedules set revert_status = 'failed', revert_problem = 'x', reverted_at = now() where id = $1", [id]);
    await rejects("update commerce.theme_schedules set revert_status = 'done' where id = $1", [id], /theme_schedules\.revert_settled/);
  });

  it("keeps its record when its theme is removed", async () => {
    const third = await scalar<string>("insert into commerce.store_theme_installs (store_id, title, look) values ($1, 'Bold', '{}'::jsonb) returning id", [store]);
    const id = await scalar<string>("insert into commerce.theme_schedules (store_id, install_id, live_at) values ($1, $2, now() + interval '1 day') returning id", [store, third]);
    await db.query("delete from commerce.store_theme_installs where id = $1", [third]);
    expect(await scalar<string | null>("select install_id from commerce.theme_schedules where id = $1", [id])).toBeNull();
  });
});

describe("a preview link", () => {
  const insert = (storeId: string, pageId: string | null, installId: string | null, hash: string, days = "7 days") =>
    db.query(
      `insert into commerce.preview_links (store_id, page_id, install_id, token_hash, expires_at, created_by) values ($1, $2, $3, $4, now() + interval '${days}', $5) returning id`,
      [storeId, pageId, installId, hash, account],
    );

  it("opens one of its own store's pages or installed themes, never both, never another's", async () => {
    await rejects("insert into commerce.preview_links (store_id, page_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '1 day')", [store, otherPage, "b".repeat(64)], /preview_links/);
    await expect(insert(store, null, otherInstall, "c".repeat(64))).rejects.toThrow(/preview_links\.install/);
    await expect(insert(store, page, second, "d".repeat(64))).rejects.toThrow(/preview_links_target/);
    await expect(insert(store, null, null, "d".repeat(64))).rejects.toThrow(/preview_links_target/);
    const header = await scalar<string>("insert into commerce.pages (store_id, type, slug, draft) values ($1, 'header', 'top', '{}'::jsonb) returning id", [store]);
    await expect(insert(store, header, null, "e".repeat(64))).rejects.toThrow(/preview_links\.page/);
  });

  it("keeps a hash, never a token, and works 30 days at most", async () => {
    await expect(insert(store, page, null, "pv_not-a-hash")).rejects.toThrow(/preview_links_token/);
    await expect(insert(store, page, null, "f".repeat(64), "31 days")).rejects.toThrow(/preview_links_expiry/);
    await insert(store, page, null, HASH, "30 days");
    await expect(insert(store, null, second, HASH)).rejects.toThrow(/preview_links_token_idx/);
  });

  it("stays as it was made, and is revoked once for good", async () => {
    const id = await scalar<string>("select id from commerce.preview_links where token_hash = $1", [HASH]);
    await rejects("update commerce.preview_links set expires_at = expires_at + interval '1 day' where id = $1", [id], /preview_links\.fixed/);
    await rejects("update commerce.preview_links set page_id = null, install_id = $2 where id = $1", [id, second], /preview_links\.fixed/);
    await db.query("update commerce.preview_links set revoked_at = now(), revoked_by = $2 where id = $1", [id, account]);
    await rejects("update commerce.preview_links set revoked_at = null where id = $1", [id], /preview_links\.revoked/);
  });

  it("goes with its page and its theme", async () => {
    const gone = await scalar<string>("insert into commerce.pages (store_id, type, slug, draft) values ($1, 'article', 'gone', '{}'::jsonb) returning id", [store]);
    await insert(store, gone, null, "1".repeat(64));
    await db.query("delete from commerce.pages where id = $1", [gone]);
    expect(await scalar<number>("select count(*)::int from commerce.preview_links where token_hash = $1", ["1".repeat(64)])).toBe(0);
  });
});

describe("a version of the look", () => {
  it("is the theme as kept, never changed; only an account deleted since is let go of", async () => {
    const id = await scalar<string>("insert into commerce.look_versions (store_id, kind, theme, created_by) values ($1, 'design', '{\"base\":\"minimal\"}'::jsonb, $2) returning id", [store, account]);
    await rejects("insert into commerce.look_versions (store_id, kind, theme) values ($1, 'other', '{}'::jsonb)", [store], /look_versions_kind/);
    await rejects("insert into commerce.look_versions (store_id, kind, theme) values ($1, 'design', '[]'::jsonb)", [store], /look_versions_theme/);
    await rejects("update commerce.look_versions set theme = '{}'::jsonb where id = $1", [id], /look_versions\.fixed/);
    await rejects("update commerce.look_versions set kind = 'theme_tab' where id = $1", [id], /look_versions\.fixed/);
    await db.query("update commerce.look_versions set created_by = null where id = $1", [id]);
  });
});
