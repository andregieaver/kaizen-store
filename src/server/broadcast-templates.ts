import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { completeTemplate, isBroadcastTemplateKey, OWN_TEMPLATES_MAX, templateContent, withProducts } from "@/lib/broadcast-templates";
import { SOCIAL_MAX, type BroadcastContent } from "@/lib/broadcasts";
import { SOCIAL_NETWORKS, socialHref, type SocialNetwork } from "@/lib/social-links";
import { broadcastContentSchema } from "@/lib/broadcasts-schema";

import { audit } from "./auth";
import { campaignFacts } from "./broadcast-facts";
import { listGridProducts } from "./catalog";
import type { Store } from "./stores";
import { getBroadcast } from "./broadcasts";
import { emailPictureProblem } from "./marketing-email";
import { col, typedRows } from "./typed-rows";

type Row = Record<string, unknown>;

/**
 * Broadcast templates (wave 10 unit E, D368): the hand-written ones (`BROADCAST_TEMPLATES`) and a store's own, the only writer of
 * `commerce.broadcast_templates`. An own template is a broadcast's words saved to start the next one from (at most `OWN_TEMPLATES_MAX`),
 * written by staff with `marketing:write` (checked by the caller) and audited `broadcast_template.*`; a picture in it stays the store's own.
 */

export type OwnTemplate = { id: string; title: string; createdAt: string };

/** The store's own templates, newest first. */
export async function listOwnTemplates(storeId: string): Promise<OwnTemplate[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, title: col.text, created_at: col.timestamp }),
    sql`select id, title, created_at from commerce.broadcast_templates where store_id = ${storeId}::uuid order by created_at desc, id`,
  );
  return rows.map((r) => ({ id: r.id, title: r.title, createdAt: r.created_at }));
}

/** Saves a broadcast's words as a template of the store's own. */
export async function saveAsTemplate(
  storeId: string,
  accountId: string,
  broadcastId: string,
  title: string,
): Promise<{ ok: true; id: string } | { ok: false; problem: "unknown" | "title" | "full" | "picture" }> {
  const name = title.trim().slice(0, 120);
  if (!name) return { ok: false, problem: "title" };
  const broadcast = await getBroadcast(storeId, broadcastId);
  if (!broadcast) return { ok: false, problem: "unknown" };
  if (await emailPictureProblem(storeId, broadcast.content)) return { ok: false, problem: "picture" };
  const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.broadcast_templates where store_id = ${storeId}::uuid`);
  if (Number(count?.n ?? 0) >= OWN_TEMPLATES_MAX) return { ok: false, problem: "full" };
  const [row] = await db().execute<Row>(sql`
    insert into commerce.broadcast_templates (store_id, title, content, created_by)
    values (${storeId}::uuid, ${name}, ${JSON.stringify(broadcast.content)}::jsonb, ${accountId}::uuid) returning id
  `);
  const id = String(row.id);
  await audit(accountId, storeId, "broadcast_template.saved", { template: id, from: broadcastId }, { area: "marketing", target: { type: "broadcast_template", id } });
  return { ok: true, id };
}

/** Deletes one of the store's own templates. */
export async function deleteOwnTemplate(storeId: string, accountId: string, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const gone = await db().execute<Row>(sql`delete from commerce.broadcast_templates where store_id = ${storeId}::uuid and id = ${id}::uuid returning id`);
  if (gone.length === 0) return false;
  await audit(accountId, storeId, "broadcast_template.deleted", { template: id }, { area: "marketing", target: { type: "broadcast_template", id } });
  return true;
}

/**
 * The words a new broadcast starts with: a hand-written template by its key (in the store's languages that have it), one of the store's own by
 * its id (only the store's languages kept), or nothing.
 */
export async function startingContent(storeId: string, locales: readonly string[], choice: string | null | undefined): Promise<BroadcastContent> {
  if (!choice) return {};
  if (isBroadcastTemplateKey(choice)) return templateContent(choice, locales);
  if (!z.uuid().safeParse(choice).success) return {};
  const [row] = await db().execute<Row>(sql`select content from commerce.broadcast_templates where store_id = ${storeId}::uuid and id = ${choice}::uuid`);
  const parsed = broadcastContentSchema.safeParse(row?.content ?? {});
  if (!parsed.success) return {};
  const kept = new Set(locales);
  return Object.fromEntries(Object.entries(parsed.data).filter(([locale]) => kept.has(locale)));
}

/** The store's three newest products in its main market, for "New in the shop" (round 10, D633); none when it has no market. */
export async function newestProducts(store: Pick<Store, "id" | "markets">): Promise<{ id: string; handle: string; title: string }[]> {
  const market = store.markets[0];
  if (!market) return [];
  const products = await listGridProducts(store.id, market, { categoryIds: [], tagIds: [], sort: "newest", limit: 3 });
  return products.map((p) => ({ id: p.id, handle: p.handle, title: p.title }));
}

/** Where a new broadcast starts: a template or an own one, and for new products the newest three already in it. */
export async function startingBroadcast(store: Pick<Store, "id" | "markets" | "timeZone">, locales: readonly string[], choice: string | null): Promise<BroadcastContent> {
  const content = await startingContent(store.id, locales, choice);
  // A store's own template is already the whole email it saved; a hand-written one is completed from the store's facts (M4.1).
  if (!isBroadcastTemplateKey(choice)) return content;
  const market = store.markets[0];
  const [products, campaigns, social] = await Promise.all([
    choice === "new_products" ? newestProducts(store) : [],
    choice === "offer" && market ? campaignFacts(store, market) : [],
    siteSocialLinks(store.id),
  ]);
  return completeTemplate(withProducts(content, products), { campaigns, social });
}

/**
 * The social links of the store's site footer as it is published (D91's `socialLinks` blocks), each a network the email knows with its
 * address; the first block's links, at most `SOCIAL_MAX`. None when the footer has none.
 */
export async function siteSocialLinks(storeId: string): Promise<{ network: SocialNetwork; url: string }[]> {
  const rows = await typedRows(
    z.object({ network: col.text, href: col.text }),
    sql`
      select l->>'network' as network, l->>'href' as href
        from commerce.stores s
        join commerce.pages p on p.id = s.footer_id and p.store_id = s.id
        cross join lateral jsonb_path_query(p.published, 'strict $.**? (@.type == "socialLinks").links[*]') l
       where s.id = ${storeId}::uuid and p.published is not null and jsonb_typeof(l) = 'object'
       limit ${SOCIAL_MAX * 2}
    `,
  );
  const seen = new Set<string>();
  return rows
    .flatMap((r) => (r.network in SOCIAL_NETWORKS && r.href.trim() && socialHref(r.network as SocialNetwork, r.href) && !seen.has(r.network) && seen.add(r.network) ? [{ network: r.network as SocialNetwork, url: r.href.trim() }] : []))
    .slice(0, SOCIAL_MAX);
}
