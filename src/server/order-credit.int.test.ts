import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const { creditBySource, orderCredit, sendCredit } = await import("./order-credit");

type Row = Record<string, unknown>;

/**
 * Orders after a message, by one rule (email plan M1.4, D761), against a real database: an order counts once, for the latest email or text
 * that reached its buyer within seven days before it, whichever sender it came from; an order outside the window, an unpaid one and one by
 * someone the store never wrote to count for nothing.
 */

const run = Date.now().toString(36);
let storeId: string;
let n = 0;
const day = 86_400_000;
const now = Date.now();
const ago = (days: number) => new Date(now - days * day);

async function subscriber(email: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.marketing_subscribers (store_id, email, locale, market_code, status, source, consent_text, consented_at, token)
    values (${storeId}::uuid, ${email}, 'nb-NO', 'NO', 'subscribed', 'account', 'Yes please', now(), ${randomBytes(32).toString("base64url")})
    returning id
  `);
  return String(row.id);
}

async function order(email: string, at: Date, paid = true, total = 10_000): Promise<string> {
  n += 1;
  return db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
        discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at)
      values (${storeId}::uuid, ${`oc${run}-${n}`}, 'NO', 'NOK', 'nb-NO', ${email}, ${paid ? "paid" : "pending_payment"}::commerce.order_status, ${total}, 0, 0, 2000,
        ${total}, '{}'::jsonb, '{"name":"Ola"}'::jsonb, ${at.toISOString()}::timestamptz)
      returning id
    `);
    if (paid) {
      await tx.execute(sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
        values (${storeId}::uuid, ${String(row.id)}::uuid, 'stripe', ${`cs_oc${run}_${n}`}, ${total}, 'NOK', 'captured')
      `);
    }
    return String(row.id);
  });
}

/** A sent broadcast that reached `emails` at `at`. */
async function broadcast(emails: string[], subscribers: string[], at: Date): Promise<string> {
  const [b] = await db().execute<Row>(sql`
    insert into commerce.broadcasts (store_id, title, audience, content) values (${storeId}::uuid, ${`B ${run} ${n}`}, 'everyone', '{}'::jsonb) returning id
  `);
  const id = String(b.id);
  await db().execute(sql`update commerce.broadcasts set status = 'sending', started_at = ${at.toISOString()}::timestamptz, recipient_count = ${emails.length} where id = ${id}::uuid`);
  for (const [i, email] of emails.entries()) {
    await db().execute(sql`
      insert into commerce.broadcast_recipients (store_id, broadcast_id, subscriber_id, email, locale, market_code)
      values (${storeId}::uuid, ${id}::uuid, ${subscribers[i]}::uuid, ${email}, 'nb-NO', 'NO')
    `);
    // A recipient starts queued and is then sent, as the table's rules allow.
    await db().execute(sql`
      update commerce.broadcast_recipients set status = 'sent', sent_at = ${at.toISOString()}::timestamptz
       where broadcast_id = ${id}::uuid and subscriber_id = ${subscribers[i]}::uuid
    `);
  }
  await db().execute(sql`update commerce.broadcasts set status = 'sent', finished_at = ${at.toISOString()}::timestamptz where id = ${id}::uuid`);
  return id;
}

async function automation(subscriberId: string, kind: string, at: Date): Promise<void> {
  n += 1;
  await db().execute(sql`
    insert into commerce.automation_sends (store_id, key, kind, subscriber_id, outcome, created_at)
    values (${storeId}::uuid, ${`oc-${run}-${n}`}, ${kind}, ${subscriberId}::uuid, 'sent', ${at.toISOString()}::timestamptz)
  `);
}

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`credit-${run}@example.com`}, 'Kari', 'Credit') returning id
  `);
  const [made] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`credit-${run}`}, 'Credit', null) as id`);
  storeId = String(made.id);
});

afterAll(async () => {
  await closeDb();
});

describe("orders after a message (D761)", () => {
  it("credits each order once, to the latest message its buyer got before it, across broadcasts and automations", async () => {
    const ola = `ola-${run}@example.com`;
    const kari = `kari-${run}@example.com`;
    const nils = `nils-${run}@example.com`;
    const [olaId, kariId] = [await subscriber(ola), await subscriber(kari)];

    const news = await broadcast([ola, kari], [olaId, kariId], ago(10));
    // Ola: the broadcast, then a win-back email two days later; his order a day after that goes to the win-back email.
    await automation(olaId, "win_back", ago(8));
    await order(ola, ago(7));
    // Kari: only the broadcast; one order within the week (counted) and one after it (not).
    await order(kari, ago(9), true, 25_000);
    await order(kari, ago(1));
    // Kari's unpaid order and Nils's order, whom the store never wrote to, count for nothing.
    await order(kari, ago(9.5), false);
    await order(nils, ago(9));

    const credit = await orderCredit(storeId, ago(30), new Date(now));
    expect(credit.get(`broadcast:${news}`)).toEqual({ orders: 1, minor: { NOK: 25_000 } });
    expect(credit.get("automation:win_back")).toEqual({ orders: 1, minor: { NOK: 10_000 } });
    expect([...credit.values()].reduce((sum, c) => sum + c.orders, 0)).toBe(2);

    // A broadcast's report: from its start to a week after it ended.
    expect(await sendCredit(storeId, `broadcast:${news}`, ago(10).toISOString(), ago(10).toISOString())).toEqual({ orders: 1, minor: { NOK: 25_000 } });
    // Analytics → Marketing: the same orders, summed per sender kind.
    const sums = await creditBySource(storeId, ago(30), new Date(now));
    expect(sums.broadcast.orders).toBe(1);
    expect(sums.automation.orders).toBe(1);
    expect(sums.text.orders).toBe(0);
  });

  it("counts nothing for a send that has not started", async () => {
    expect(await sendCredit(storeId, "broadcast:none", null, null)).toEqual({ orders: 0, minor: {} });
  });
});
