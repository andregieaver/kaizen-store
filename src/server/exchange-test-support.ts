import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import type { OrderActor } from "./order-actor";

type Row = Record<string, unknown>;
type Propose = typeof import("./exchanges").proposeExchange;

/**
 * Tests only (integration): proposes an exchange as staff would. A voluntary return gets a link to share; a withdrawal return cannot (D239 review finding:
 * its proposal goes only by email to the order's own address, so only the customer can press Confirm), so its link is read from the newest proposal email,
 * as the customer would open it. Answers `proposeExchange()`'s result with `link` set either way.
 */
export async function proposeForTest(propose: Propose, storeId: string, actor: OrderActor, returnId: string, input: unknown): Promise<Awaited<ReturnType<Propose>>> {
  const [ret] = await db().execute<Row>(sql`select kind, order_id from commerce.returns where store_id = ${storeId}::uuid and id = ${returnId}::uuid`);
  const withdrawal = ret?.kind === "withdrawal";
  const proposed = await propose(storeId, actor, returnId, input, { createLink: !withdrawal });
  if (!proposed.ok || !withdrawal) return proposed;
  const [mail] = await db().execute<Row>(sql`
    select text from commerce.email_messages where store_id = ${storeId}::uuid and order_id = ${String(ret.order_id)}::uuid and kind = 'return.exchange_proposed'
    order by created_at desc limit 1
  `);
  const found = mail ? /(https?:\/\/\S*\/account\/exchange\/[A-Za-z0-9_-]+)/.exec(String(mail.text)) : null;
  if (!found) throw new Error(`no proposal email with a link for return ${returnId}`);
  return { ...proposed, link: found[1] };
}
