import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * Themes from outside (wave 7 unit J, D344) as the database holds them: a submission starts waiting and moves only forward, is kept as it was
 * submitted, a decision once made stays, only a theme's author submits an update of it, and a theme from outside has no price. A new install
 * no longer follows its theme's updates by itself (decision 4). Pages sent with a look (D388) are kept as sent and placed once.
 */

let db: PGlite;
let store: string;
let author: string;
let other: string;
let theme: string;

const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
const LOOK = JSON.stringify({ v: 1, theme: {} });

const submit = (kind: "theme" | "update", account: string, preset: string | null = null) =>
  scalar<string>(
    `insert into commerce.theme_submissions (account_id, store_id, kind, preset_id, title, author_name, snapshot)
     values ($1, $2, $3, $4, 'Fjord', 'Ada', $5::jsonb) returning id`,
    [account, store, kind, preset, LOOK],
  );

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "outside-a");
  author = await scalar<string>("insert into commerce.accounts (email, name) values ('ada@example.com', 'Ada') returning id");
  other = await scalar<string>("insert into commerce.accounts (email, name) values ('bo@example.com', 'Bo') returning id");
  theme = await scalar<string>(
    "insert into commerce.design_presets (title, snapshot, author_id, author_name) values ('Fjord', $1::jsonb, $2, 'Ada') returning id",
    [LOOK, author],
  );
});

afterAll(async () => {
  await db.close();
});

describe("a submission", () => {
  it("starts waiting, with no decision and no theme of its own yet", async () => {
    await rejects(
      "insert into commerce.theme_submissions (account_id, store_id, kind, title, author_name, snapshot, status) values ($1, $2, 'theme', 'X', 'Ada', $3::jsonb, 'reviewing')",
      [author, store, LOOK],
      /theme_submissions\.new/,
    );
    await rejects(
      "insert into commerce.theme_submissions (account_id, store_id, kind, preset_id, title, author_name, snapshot) values ($1, $2, 'theme', $3, 'X', 'Ada', $4::jsonb)",
      [author, store, theme, LOOK],
      /theme_submissions\.new_theme/,
    );
  });

  it("of an update comes only from the theme's author", async () => {
    await rejects(
      "insert into commerce.theme_submissions (account_id, store_id, kind, title, author_name, snapshot) values ($1, $2, 'update', 'X', 'Ada', $3::jsonb)",
      [author, store, LOOK],
      /theme_submissions\.author|theme_submissions_update_preset/,
    );
    await expect(submit("update", other, theme)).rejects.toThrow(/theme_submissions\.author/);
    expect(await submit("update", author, theme)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("is kept as it was submitted, and its theme is set once", async () => {
    const id = await submit("theme", author);
    await rejects("update commerce.theme_submissions set snapshot = '{\"v\": 2}'::jsonb where id = $1", [id], /theme_submissions\.fixed/);
    await rejects("update commerce.theme_submissions set author_name = 'Someone' where id = $1", [id], /theme_submissions\.fixed/);
    await db.query("update commerce.theme_submissions set status = 'reviewing', preset_id = $2 where id = $1", [id, theme]);
    const second = await scalar<string>("insert into commerce.design_presets (title, snapshot) values ('Other', $1::jsonb) returning id", [LOOK]);
    await rejects("update commerce.theme_submissions set preset_id = $2 where id = $1", [id, second], /theme_submissions\.preset/);
  });

  it("moves only forward, a rejection says why, and a decision stays", async () => {
    const id = await submit("theme", author);
    await rejects("update commerce.theme_submissions set status = 'approved' where id = $1", [id], /theme_submissions\.status/);
    await rejects("update commerce.theme_submissions set status = 'rejected' where id = $1", [id], /theme_submissions_rejected_reason/);
    await db.query("update commerce.theme_submissions set status = 'rejected', reason = 'Too close to Harbour.', decided_at = now() where id = $1", [id]);
    await rejects("update commerce.theme_submissions set status = 'waiting' where id = $1", [id], /theme_submissions\.status/);
    await rejects("update commerce.theme_submissions set reason = 'Other words' where id = $1", [id], /theme_submissions\.decided/);
    // An approval names the theme it made.
    const open = await submit("theme", author);
    await db.query("update commerce.theme_submissions set status = 'reviewing' where id = $1", [open]);
    await rejects("update commerce.theme_submissions set status = 'approved' where id = $1", [open], /theme_submissions\.approved/);
  });
});

describe("its own pages (D388)", () => {
  it("are kept as they were sent, and the store they are placed in is set once, only for a submission with pages", async () => {
    const pages = JSON.stringify([{ title: "Our story", slug: "our-story", front: true, content: {} }]);
    const id = await scalar<string>(
      `insert into commerce.theme_submissions (account_id, store_id, kind, title, author_name, snapshot, pages)
       values ($1, $2, 'theme', 'Fjord', 'Ada', $3::jsonb, $4::jsonb) returning id`,
      [author, store, LOOK, pages],
    );
    await rejects("update commerce.theme_submissions set pages = '[]'::jsonb where id = $1", [id], /theme_submissions\.fixed/);
    const content = await createInvoiceStore(db, "outside-pages");
    await db.query("update commerce.stores set starter = true where id = $1", [content]);
    const starter = await scalar<string>("insert into commerce.store_starters (store_id, title, category) values ($1, 'Fjord', 'other') returning id", [content]);
    await rejects(
      `insert into commerce.theme_submissions (account_id, store_id, kind, title, author_name, snapshot, pages, content_starter_id)
       values ($1, $2, 'theme', 'X', 'Ada', $3::jsonb, $4::jsonb, $5)`,
      [author, store, LOOK, pages, starter],
      /theme_submissions\.content/,
    );
    await db.query("update commerce.theme_submissions set status = 'reviewing', content_starter_id = $2 where id = $1", [id, starter]);
    await rejects("update commerce.theme_submissions set content_starter_id = null where id = $1", [id], /theme_submissions\.content/);
    // A submission of the look only has no pages to place.
    const lookOnly = await submit("theme", author);
    await rejects("update commerce.theme_submissions set content_starter_id = $2 where id = $1", [lookOnly, starter], /theme_submissions\.content/);
  });
});

describe("a theme from outside", () => {
  it("names its author by both id and name, or neither", async () => {
    await rejects("insert into commerce.design_presets (title, snapshot, author_id) values ('X', $1::jsonb, $2)", [LOOK, author], /design_presets_author/);
    await rejects("insert into commerce.design_presets (title, snapshot, author_name) values ('X', $1::jsonb, 'Ada')", [LOOK], /design_presets_author/);
  });

  it("has no price until a revenue share is decided", async () => {
    await rejects("insert into commerce.theme_prices (preset_id, currency, amount_minor) values ($1, 'NOK', 9900)", [theme], /theme_prices\.author_free/);
    const own = await scalar<string>("insert into commerce.design_presets (title, snapshot) values ('Own', $1::jsonb) returning id", [LOOK]);
    await db.query("insert into commerce.theme_prices (preset_id, currency, amount_minor) values ($1, 'NOK', 9900)", [own]);
  });
});

describe("a new install (decision 4)", () => {
  it("waits for the owner to update it", async () => {
    const install = await scalar<string>("insert into commerce.store_theme_installs (store_id, title, look) values ($1, 'Fjord', '{}'::jsonb) returning id", [store]);
    expect(await scalar<boolean>("select follows_updates from commerce.store_theme_installs where id = $1", [install])).toBe(false);
  });
});
