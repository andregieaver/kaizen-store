import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";

import type { Principal } from "./owner-assistant";
import { col, typedRow } from "./typed-rows";

/**
 * Stopping a turn of the AI manager on purpose (PSI AGT-03). A turn no longer stops when its page closes or loses its connection: it
 * finishes and is kept, so it shows when the conversation is opened again. Stop is said instead: the person's own conversation is marked
 * (`stop_requested_at`), and the turn's route, which polls the mark, stops the turn at its next check. Any of the function's instances may
 * receive the press, so the mark is in the database.
 */

/** Marks the person's own conversation as asked to stop; false when it is not theirs here. */
export async function requestStop(principal: Principal, conversationId: string): Promise<boolean> {
  const done = await db().execute(sql`
    update commerce.assistant_conversations set stop_requested_at = now()
    where id = ${conversationId}::uuid and account_id = ${principal.account.id}::uuid
      and store_id is not distinct from ${principal.store?.id ?? null}::uuid and source = 'admin'
    returning id
  `);
  return done.length > 0;
}

/** Whether Stop was pressed in the conversation after `since` (the turn's start). */
export async function stopRequestedSince(conversationId: string, since: Date): Promise<boolean> {
  const row = await typedRow(
    z.object({ stopped: col.bool }),
    sql`select coalesce(stop_requested_at > ${since.toISOString()}::timestamptz, false) as stopped from commerce.assistant_conversations where id = ${conversationId}::uuid`,
  );
  return row?.stopped ?? false;
}

/** How often a running turn asks whether Stop was pressed. */
export const STOP_POLL_MS = 1500;
