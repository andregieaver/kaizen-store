import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { PREVIEW_LINKS_PER_TARGET, PREVIEW_MAX_DAYS, type PreviewLinkItem } from "@/lib/preview-links";
import { isPreviewToken, newPreviewToken, previewTokenHash } from "@/lib/preview-token";

import { audit, type Account } from "./auth";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Preview links (wave 7 unit F, D340, `docs/wave-7-storefront.md` F): the only writer of `commerce.preview_links`. A link opens one page's or
 * article's draft, or one installed theme on the store's pages, for anyone who has it, without signing in, until it expires (at most 30
 * days) or is revoked. The token is made here and handed back once; the database keeps only its SHA-256, so neither the list nor a leak of
 * the table can open anything. `previewLinkOf()` is the one reader of a token.
 */

/** What a link opens: a page's or article's draft, or an installed theme. */
export type PreviewTarget = { page: string; type: "page" | "article" } | { install: string };

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
/** The condition that names a link's page or theme; `alias` the table's name in the query, if it has one. */
const targetOf = (target: PreviewTarget, alias = "") =>
  "page" in target ? sql`${sql.raw(alias)}page_id = ${target.page}::uuid` : sql`${sql.raw(alias)}install_id = ${target.install}::uuid`;

export type MadeLink = { ok: true; id: string; token: string; expiresAt: string } | { ok: false; problem: "missing" | "too_many" };

/** Makes a link to one of the store's pages, articles or installed themes, good for `days` (1 to 30). The token is in the answer only. */
export async function makePreviewLink(account: Account, storeId: string, target: PreviewTarget, days: number): Promise<MadeLink> {
  const id = "page" in target ? target.page : target.install;
  if (!isUuid(id) || !Number.isInteger(days) || days < 1 || days > PREVIEW_MAX_DAYS) return { ok: false, problem: "missing" };
  const exists = await typedRow(
    z.object({ ok: col.bool }),
    "page" in target
      ? sql`select true as ok from commerce.pages where id = ${id}::uuid and store_id = ${storeId}::uuid and type = ${target.type}`
      : sql`select true as ok from commerce.store_theme_installs where id = ${id}::uuid and store_id = ${storeId}::uuid`,
  );
  if (!exists) return { ok: false, problem: "missing" };
  const live = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.preview_links where store_id = ${storeId}::uuid and ${targetOf(target)} and revoked_at is null and expires_at > now()`,
  );
  if ((live?.n ?? 0) >= PREVIEW_LINKS_PER_TARGET) return { ok: false, problem: "too_many" };
  const token = newPreviewToken();
  const row = await typedRow(
    z.object({ id: col.uuid, expires_at: col.timestamp }),
    sql`
      insert into commerce.preview_links (store_id, page_id, install_id, token_hash, expires_at, created_by)
      values (${storeId}::uuid, ${"page" in target ? id : null}::uuid, ${"install" in target ? id : null}::uuid, ${previewTokenHash(token)},
        now() + make_interval(days => ${days}::int), ${account.id}::uuid)
      returning id, expires_at
    `,
  );
  await audit(account.id, storeId, "store.preview_link_made", { link: row!.id, days, ...("page" in target ? { page: id } : { install: id }) }, {
    area: "website",
    target: "page" in target ? { type: target.type, id } : { type: "theme_install", id },
  });
  return { ok: true, id: row!.id, token, expiresAt: row!.expires_at };
}

/** Revokes one of the store's links to a page or theme; true when it was still open. */
export async function revokePreviewLink(account: Account, storeId: string, target: PreviewTarget, linkId: string): Promise<boolean> {
  if (!isUuid(linkId)) return false;
  const rows = await db().execute(sql`
    update commerce.preview_links set revoked_at = now(), revoked_by = ${account.id}::uuid
    where id = ${linkId}::uuid and store_id = ${storeId}::uuid and ${targetOf(target)} and revoked_at is null
    returning id
  `);
  if (rows.length === 0) return false;
  await audit(account.id, storeId, "store.preview_link_revoked", { link: linkId }, { area: "website" });
  return true;
}

/** A page's or theme's links of the last 60 days, newest first: when made, by whom, until when, and whether still good. */
export async function listPreviewLinks(storeId: string, target: PreviewTarget): Promise<PreviewLinkItem[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, created_at: col.timestamp, expires_at: col.timestamp, by: col.textOrNull, live: col.bool, revoked_at: col.timestampOrNull }),
    sql`
      select l.id, l.created_at, l.expires_at, nullif(a.name, '') as by, (l.revoked_at is null and l.expires_at > now()) as live, l.revoked_at
      from commerce.preview_links l
      left join commerce.accounts a on a.id = l.created_by
      where l.store_id = ${storeId}::uuid and ${targetOf(target, "l.")} and l.created_at > now() - interval '60 days'
      order by l.created_at desc, l.id desc
      limit 30
    `,
  );
  return rows.map((r) => ({ id: r.id, createdAt: r.created_at, expiresAt: r.expires_at, by: r.by, live: r.live, revokedAt: r.revoked_at }));
}

/** What a good token opens: its store, and the page (with its kind) or the installed theme. */
export type PreviewOpen = { storeId: string; storeSlug: string; expiresAt: string } & (
  | { kind: "page"; pageId: string; type: "page" | "article" }
  | { kind: "theme"; installId: string }
);

/**
 * The one reader of a token: what it opens while it is good (not revoked, not expired) and its store is open (not suspended or closed).
 * Anything else is null, whatever the reason, so a visitor learns nothing from a wrong token.
 */
export async function previewLinkOf(token: unknown): Promise<PreviewOpen | null> {
  if (!isPreviewToken(token)) return null;
  const row = await typedRow(
    z.object({ store_id: col.uuid, slug: col.text, page_id: col.uuid.nullable(), install_id: col.uuid.nullable(), type: col.textOrNull, expires_at: col.timestamp }),
    sql`
      select l.store_id, s.slug, l.page_id, l.install_id, p.type, l.expires_at
      from commerce.preview_links l
      join commerce.stores s on s.id = l.store_id
      left join commerce.pages p on p.id = l.page_id and p.store_id = l.store_id
      where l.token_hash = ${previewTokenHash(token)} and l.revoked_at is null and l.expires_at > now() and s.status = 'active'
    `,
  );
  if (!row) return null;
  if (row.page_id && (row.type === "page" || row.type === "article")) {
    return { storeId: row.store_id, storeSlug: row.slug, expiresAt: row.expires_at, kind: "page", pageId: row.page_id, type: row.type };
  }
  if (row.install_id) return { storeId: row.store_id, storeSlug: row.slug, expiresAt: row.expires_at, kind: "theme", installId: row.install_id };
  return null;
}
