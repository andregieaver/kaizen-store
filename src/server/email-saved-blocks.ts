import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { SAVED_BLOCK_NAME_MAX, SAVED_BLOCKS_MAX, type SavedBlock } from "@/lib/broadcasts";
import { broadcastBlockSchema } from "@/lib/broadcasts-schema";

import { audit } from "./auth";
import { emailPictureProblem } from "./marketing-email";
import { owned } from "./owned";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store's saved email blocks (email plan M4.1), the only writer of `commerce.email_saved_blocks`: one block of an email kept by name to
 * add again (a footer, columns, the social links), at most `SAVED_BLOCKS_MAX`. Written by staff with `marketing:write` (checked by the
 * caller) and audited `email_block.*`; a picture in one is the store's own library's, as in any email. Kaizena Flow's own emails are its
 * house store's (D467), so the platform has them too.
 */

const ROW = z.object({ id: col.uuid, name: col.text, block: z.unknown() });

/** The store's saved blocks, newest first; a row that is no longer a block (the schema moved on) is left out. */
export async function listSavedBlocks(storeId: string): Promise<SavedBlock[]> {
  const rows = await typedRows(ROW, sql`select id, name, block from commerce.email_saved_blocks where ${owned(storeId)} order by created_at desc, id limit ${SAVED_BLOCKS_MAX}`);
  return rows.flatMap((r) => {
    const block = broadcastBlockSchema.safeParse(r.block);
    return block.success ? [{ id: r.id, name: r.name, block: block.data }] : [];
  });
}

export type SaveBlockProblem = "name" | "block" | "full" | "picture";

/** Saves one block by name; the block is checked as an email's would be. */
export async function saveBlock(storeId: string, accountId: string, name: string, input: unknown): Promise<{ ok: true; id: string } | { ok: false; problem: SaveBlockProblem }> {
  const title = name.trim().slice(0, SAVED_BLOCK_NAME_MAX);
  if (!title) return { ok: false, problem: "name" };
  const block = broadcastBlockSchema.safeParse(input);
  if (!block.success) return { ok: false, problem: "block" };
  if (await emailPictureProblem(storeId, { x: { subject: "", preview: "", blocks: [block.data] } })) return { ok: false, problem: "picture" };
  const count = await typedRow(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.email_saved_blocks where ${owned(storeId)}`);
  if ((count?.n ?? 0) >= SAVED_BLOCKS_MAX) return { ok: false, problem: "full" };
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.email_saved_blocks (store_id, name, block, created_by) values (${storeId}::uuid, ${title}, ${JSON.stringify(block.data)}::jsonb, ${accountId}::uuid) returning id`,
  );
  if (!row) return { ok: false, problem: "block" };
  await audit(accountId, storeId, "email_block.saved", { block: row.id, type: block.data.type }, { area: "marketing", target: { type: "email_block", id: row.id } });
  return { ok: true, id: row.id };
}

/** Deletes one of the store's saved blocks. */
export async function deleteSavedBlock(storeId: string, accountId: string, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const gone = await typedRows(z.object({ id: col.uuid }), sql`delete from commerce.email_saved_blocks where ${owned(storeId)} and id = ${id}::uuid returning id`);
  if (gone.length === 0) return false;
  await audit(accountId, storeId, "email_block.deleted", { block: id }, { area: "marketing", target: { type: "email_block", id } });
  return true;
}
