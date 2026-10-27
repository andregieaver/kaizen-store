import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent } from "@/lib/page-content";
import { PREVIEW_LINKS_PER_TARGET } from "@/lib/preview-links";
import { newPreviewToken, previewTokenHash } from "@/lib/preview-token";

import { makeStore, ownerOf, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { savePage } = await import("./pages");
const { listPreviewLinks, makePreviewLink, previewLinkOf, revokePreviewLink } = await import("./preview-links");

type Row = Record<string, unknown>;

/**
 * Preview links (wave 7 unit F, D340): a link opens its own page's draft or its own theme for anyone with it, until it runs out or is
 * revoked, and only while the store is open; the database never holds the token; one store never makes a link to another's page; and the
 * list and the activity log never show a token.
 */

let fx: Fixture;
let other: Fixture;
let page: string;
const run = Date.now().toString(36);

beforeAll(async () => {
  fx = await makeStore("share");
  other = await makeStore("share-other");
  const { account } = await ownerOf(fx);
  const saved = await savePage(account, fx.storeId, null, { ...newPageContent(), title: "Draft", slug: `draft-${run}` }, { publish: false, type: "page" });
  if (!saved.ok) throw new Error(saved.problems.join(" "));
  page = saved.id;
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("a preview link", () => {
  it("opens its page's draft while it works, and nothing once revoked", async () => {
    const { account } = await ownerOf(fx);
    const made = await makePreviewLink(account, fx.storeId, { page, type: "page" }, 7);
    if (!made.ok) throw new Error(made.problem);
    expect(await previewLinkOf(made.token)).toMatchObject({ storeId: fx.storeId, kind: "page", pageId: page, type: "page" });
    // The database holds the hash, never the token.
    const [row] = await db().execute<Row>(sql`select token_hash, expires_at - created_at as span from commerce.preview_links where id = ${made.id}::uuid`);
    expect(row.token_hash).toBe(previewTokenHash(made.token));
    const dump = JSON.stringify(await db().execute(sql`select * from commerce.preview_links where store_id = ${fx.storeId}::uuid`));
    expect(dump).not.toContain(made.token);
    expect(await revokePreviewLink(account, fx.storeId, { page, type: "page" }, made.id)).toBe(true);
    expect(await previewLinkOf(made.token)).toBeNull();
    expect(await revokePreviewLink(account, fx.storeId, { page, type: "page" }, made.id)).toBe(false);
  });

  it("opens nothing once it ran out, for a wrong token, or while the store is not open", async () => {
    const { account } = await ownerOf(fx);
    const token = newPreviewToken();
    await db().execute(sql`
      insert into commerce.preview_links (store_id, page_id, token_hash, expires_at, created_at)
      values (${fx.storeId}::uuid, ${page}::uuid, ${previewTokenHash(token)}, now() - interval '1 day', now() - interval '8 days')
    `);
    expect(await previewLinkOf(token)).toBeNull();
    expect(await previewLinkOf(newPreviewToken())).toBeNull();
    expect(await previewLinkOf("pv_' or 1=1 --")).toBeNull();
    const made = await makePreviewLink(account, fx.storeId, { page, type: "page" }, 1);
    if (!made.ok) throw new Error(made.problem);
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${fx.storeId}::uuid`);
    try {
      expect(await previewLinkOf(made.token)).toBeNull();
    } finally {
      await db().execute(sql`update commerce.stores set status = 'active' where id = ${fx.storeId}::uuid`);
    }
    expect(await previewLinkOf(made.token)).not.toBeNull();
  });

  it("is made only for the store's own page or theme, of a page's own kind, and a few at a time", async () => {
    const { account } = await ownerOf(other);
    expect(await makePreviewLink(account, other.storeId, { page, type: "page" }, 7)).toEqual({ ok: false, problem: "missing" });
    expect(await makePreviewLink(account, fx.storeId, { page, type: "article" }, 7)).toEqual({ ok: false, problem: "missing" });
    expect(await makePreviewLink(account, fx.storeId, { page, type: "page" }, 31)).toEqual({ ok: false, problem: "missing" });
    const [install] = await db().execute<Row>(sql`insert into commerce.store_theme_installs (store_id, title, look) values (${other.storeId}::uuid, 'Calm', '{}'::jsonb) returning id`);
    const theme = await makePreviewLink(account, other.storeId, { install: String(install.id) }, 30);
    if (!theme.ok) throw new Error(theme.problem);
    expect(await previewLinkOf(theme.token)).toMatchObject({ kind: "theme", installId: String(install.id), storeId: other.storeId });
    expect(await makePreviewLink(account, fx.storeId, { install: String(install.id) }, 7)).toEqual({ ok: false, problem: "missing" });
    for (let i = (await listPreviewLinks(other.storeId, { install: String(install.id) })).filter((l) => l.live).length; i < PREVIEW_LINKS_PER_TARGET; i++) {
      expect((await makePreviewLink(account, other.storeId, { install: String(install.id) }, 1)).ok).toBe(true);
    }
    expect(await makePreviewLink(account, other.storeId, { install: String(install.id) }, 1)).toEqual({ ok: false, problem: "too_many" });
  });

  it("is listed and logged without its token", async () => {
    const { account } = await ownerOf(fx);
    const made = await makePreviewLink(account, fx.storeId, { page, type: "page" }, 7);
    if (!made.ok) throw new Error(made.problem);
    const listed = await listPreviewLinks(fx.storeId, { page, type: "page" });
    expect(listed[0]).toMatchObject({ id: made.id, live: true, by: "Kari" });
    expect(JSON.stringify(listed)).not.toContain(made.token);
    const log = JSON.stringify(await db().execute(sql`select * from commerce.audit_log where store_id = ${fx.storeId}::uuid and action like 'store.preview_link_%'`));
    expect(log).toContain(made.id);
    expect(log).not.toContain(made.token);
    // Another store sees none of them.
    expect(await listPreviewLinks(other.storeId, { page, type: "page" })).toEqual([]);
  });
});
