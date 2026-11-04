import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";

import { col, typedRow } from "./typed-rows";

/**
 * The chat's limits (D81): a visitor's messages per ten minutes and a site's per day, counted in `commerce.chat_usage` before any model is
 * asked. Apart from `chat-agent.ts` (which re-exports them) so another agent's route, the docs guide's (D444), counts its turns the same way
 * without loading the store chat's tools.
 */

/** A visitor's messages per ten minutes. */
export const VISITOR_LIMIT = 30;

/** A visitor as the limits know them: a hash of their address, changing daily, so it names no one. */
export function visitorKey(address: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(`${address}|${day}|kaizen-chat`).digest("hex").slice(0, 32);
}

/**
 * Counts a visitor's message, unless they or the site are past their limit: `busy` (the visitor) or `closed` (the site, for today). `scope`
 * names another agent's own counters on the same site (the docs guide's, `guide:`, D444), so its limits are its own.
 */
export async function takeChatTurn(storeId: string | null, visitor: string, dailyLimit: number, scope = ""): Promise<"ok" | "busy" | "closed"> {
  const count = async (bucket: string, window: ReturnType<typeof sql>) => {
    const row = await typedRow(
      z.object({ count: col.int }),
      sql`
        insert into commerce.chat_usage (store_id, bucket, "window", count)
        values (${storeId}::uuid, ${bucket}, ${window}, 1)
        on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
        returning count
      `,
      db(),
    );
    return row?.count ?? 0;
  };
  if ((await count(`${scope}v:${visitor}`, sql`date_bin('10 minutes', now(), '2000-01-01')`)) > VISITOR_LIMIT) return "busy";
  if ((await count(`${scope}day`, sql`date_trunc('day', now())`)) > dailyLimit) return "closed";
  return "ok";
}

/** Forgets counts older than two days (the five-minute cron). */
export async function pruneChatUsage(): Promise<number> {
  const rows = await db().execute(sql`delete from commerce.chat_usage where "window" < now() - interval '2 days' returning 1`);
  return rows.length;
}
