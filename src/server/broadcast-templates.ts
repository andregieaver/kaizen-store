import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isBroadcastTemplateKey, OWN_TEMPLATES_MAX, templateContent } from "@/lib/broadcast-templates";
import { broadcastContentSchema, type BroadcastContent } from "@/lib/broadcasts";

import { audit } from "./auth";
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
