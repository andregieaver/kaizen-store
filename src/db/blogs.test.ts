import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/** Blogs, comments and schedules (wave 7 unit G, D341) as the database holds them: every store has its first blog, rules keep rows whole. */

let db: PGlite;
let store: string;
let other: string;
let article: string;
let otherPage: string;

const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "blog-a");
  other = await createInvoiceStore(db, "blog-b");
  article = await scalar<string>(
    "insert into commerce.pages (store_id, type, slug, draft, published, published_at) values ($1, 'article', 'hello', '{}'::jsonb, '{}'::jsonb, now()) returning id",
    [store],
  );
  otherPage = await scalar<string>("insert into commerce.pages (store_id, type, slug, draft) values ($1, 'page', 'about', '{}'::jsonb) returning id", [other]);
});

afterAll(async () => {
  await db.close();
});

describe("blogs", () => {
  it("gives every store its first blog at /blog from its first moment, and only one", async () => {
    expect(await scalar<number>("select count(*)::int from commerce.blogs where store_id = $1 and main and handle = 'blog'", [store])).toBe(1);
    await rejects("insert into commerce.blogs (store_id, handle, main) values ($1, 'second', true)", [store], /blogs_one_main_idx/);
  });

  it("keeps addresses well formed and the store's own, and the first blog the first", async () => {
    await rejects("insert into commerce.blogs (store_id, handle) values ($1, 'Our News')", [store], /blogs_handle_format/);
    await db.query("insert into commerce.blogs (store_id, handle) values ($1, 'news')", [store]);
    await rejects("insert into commerce.blogs (store_id, handle) values ($1, 'news')", [store], /blogs_store_handle_key/);
    await rejects("insert into commerce.blogs (store_id, handle, comments) values ($1, 'tips', 'sometimes')", [store], /blogs_comments/);
    await rejects("update commerce.blogs set main = false where store_id = $1 and main", [store], /blogs\.fixed/);
  });

  it("lists another blog on one of its own store's pages only, never the first blog's (that is the blog place)", async () => {
    await rejects("update commerce.blogs set listing_page_id = $2 where store_id = $1 and handle = 'news'", [store, otherPage], /blogs\.listing_page/);
    const own = await scalar<string>("insert into commerce.pages (store_id, type, slug, draft) values ($1, 'page', 'news-page', '{}'::jsonb) returning id", [store]);
    await db.query("update commerce.blogs set listing_page_id = $2 where store_id = $1 and handle = 'news'", [store, own]);
    await rejects("update commerce.blogs set listing_page_id = $2 where store_id = $1 and main", [store, own], /blogs_main_lists_by_role/);
  });
});

describe("comments", () => {
  const insert = (storeId: string, pageId: string, status = "pending") =>
    db.query(
      "insert into commerce.blog_comments (store_id, page_id, name, body, body_hash, locale, status) values ($1, $2, 'Kari', 'Hei', 'h', 'nb-NO', $3) returning id",
      [storeId, pageId, status],
    );

  it("belong to an article of their own store", async () => {
    await rejects("insert into commerce.blog_comments (store_id, page_id, name, body, body_hash, locale) values ($1, $2, 'Kari', 'Hei', 'h', 'nb-NO')", [other, article], /blog_comments_page_fk/);
    await insert(store, article);
  });

  it("are kept as the visitor wrote them, and a decided one never waits again", async () => {
    const { rows } = await insert(store, article);
    const id = (rows[0] as { id: string }).id;
    await rejects("update commerce.blog_comments set body = 'Changed' where id = $1", [id], /blog_comments\.fixed/);
    await db.query("update commerce.blog_comments set status = 'approved', decided_at = now() where id = $1", [id]);
    await rejects("update commerce.blog_comments set status = 'pending' where id = $1", [id], /blog_comments\.decided/);
    await rejects("update commerce.blog_comments set status = 'shown' where id = $1", [id], /blog_comments_status/);
  });

  it("go with their article", async () => {
    const page = await scalar<string>("insert into commerce.pages (store_id, type, slug, draft) values ($1, 'article', 'bye', '{}'::jsonb) returning id", [store]);
    await insert(store, page);
    await db.query("delete from commerce.pages where id = $1", [page]);
    expect(await scalar<number>("select count(*)::int from commerce.blog_comments where page_id = $1", [page])).toBe(0);
  });
});

describe("schedules", () => {
  it("hold one waiting schedule a page, of its own store, and keep a settled one as it ended", async () => {
    await rejects("insert into commerce.page_schedules (store_id, page_id, publish_at) values ($1, $2, now())", [other, article], /page_schedules_page_fk/);
    const id = await scalar<string>("insert into commerce.page_schedules (store_id, page_id, publish_at) values ($1, $2, now() + interval '1 day') returning id", [store, article]);
    await rejects("insert into commerce.page_schedules (store_id, page_id, publish_at) values ($1, $2, now())", [store, article], /page_schedules_one_waiting_idx/);
    await db.query("update commerce.page_schedules set status = 'done', done_at = now() where id = $1", [id]);
    await rejects("update commerce.page_schedules set status = 'waiting' where id = $1", [id], /page_schedules\.settled/);
    // A new one may wait once the last has run.
    await db.query("insert into commerce.page_schedules (store_id, page_id, publish_at) values ($1, $2, now() + interval '2 days')", [store, article]);
  });
});
