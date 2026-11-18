import "server-only";

import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { CLICK_DAYS, personRef, readPersonRef } from "@/lib/email-clicks";
import { parseKey } from "@/lib/secret-box";
import { log } from "@/server/log";
import { textList } from "@/server/sql-arrays";
import { col, typedRows } from "@/server/typed-rows";

/**
 * Clicks kept per person (email plan M1.3, D754): the only writer of `commerce.email_clicks`. A press is kept only for a subscriber still on the
 * store's list (status `subscribed`): one who left is counted per link and nothing more. Nothing here throws into a press: the browser always
 * goes on to the link.
 */

/** The key the references are signed with, derived from the settings key; null without it (presses are then counted per link only). */
const clickKey = (): Buffer | null => {
  const secret = parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
  return secret ? createHmac("sha256", secret).update("kaizen:email-click").digest() : null;
};

/** The reference for one recipient's links, or null without the key. */
export function clickRef(broadcastId: string, subscriberId: string): string | null {
  const key = clickKey();
  return key ? personRef(key, broadcastId, subscriberId) : null;
}

/** Keeps a press by the subscriber the reference names, when it is genuine and they are still on the store's list. Never throws. */
export async function keepClick(storeId: string, broadcastId: string, link: string, ref: string | null): Promise<boolean> {
  try {
    const key = clickKey();
    const subscriberId = key ? readPersonRef(key, broadcastId, ref) : null;
    if (!subscriberId) return false;
    const rows = await db().execute(sql`
      insert into commerce.email_clicks (store_id, subscriber_id, broadcast_id, link)
      select s.store_id, s.id, ${broadcastId}::uuid, ${link} from commerce.marketing_subscribers s
       where s.store_id = ${storeId}::uuid and s.id = ${subscriberId}::uuid and s.status = 'subscribed'
      returning id
    `);
    return rows.length > 0;
  } catch (error) {
    log("error", "email_clicks.keep_failed", { storeId, broadcastId }, error);
    return false;
  }
}

/**
 * The delete of presses older than 180 days, as a statement for a `with` (a data-changing `with` runs once whether read or not): the daily
 * prune of broadcasts' recipients carries it, so the daily route makes no statement more (`pruneBroadcastRecipients()`).
 */
export const emailClicksPrune = () => sql`delete from commerce.email_clicks where clicked_at < now() - make_interval(days => ${CLICK_DAYS})`;

const clickRow = z.object({
  broadcast: col.text,
  link: col.text,
  clicked_at: col.timestamp,
});

/** A person's presses for their export: the broadcast's name, the link's key and when, by the subscriber rows the person's addresses or account own. */
export async function clicksOf(
  storeId: string,
  addresses: string[],
  customerId: string | null,
): Promise<{ broadcast: string; link: string; clickedAt: string }[]> {
  const rows = await typedRows(
    clickRow,
    sql`select b.title as broadcast, c.link, c.clicked_at from commerce.email_clicks c
          join commerce.marketing_subscribers m on m.store_id = c.store_id and m.id = c.subscriber_id
          join commerce.broadcasts b on b.store_id = c.store_id and b.id = c.broadcast_id
         where c.store_id = ${storeId}::uuid
           and (lower(m.email) = any(${textList(addresses)}) or m.customer_id = ${customerId}::uuid)
         order by c.clicked_at`,
  );
  return rows.map((r) => ({
    broadcast: r.broadcast,
    link: r.link,
    clickedAt: r.clicked_at,
  }));
}
