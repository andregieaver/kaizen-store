import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/** Broadcasts (wave 5 unit C, D297, `docs/wave-5-marketing.md` 5): the life of a broadcast and its recipients, as the database holds them. */

let db: PGlite;
let store: string;
let other: string;
let subscriber: string;

const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
const token = (c: string) => c.repeat(43);

async function draft(storeId = store): Promise<string> {
  return scalar<string>("insert into commerce.broadcasts (store_id, title) values ($1, 'Autumn news') returning id", [storeId]);
}

async function start(id: string) {
  await db.query("update commerce.broadcasts set status = 'sending', started_at = now(), recipient_count = 1 where id = $1", [id]);
}

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "bc-a");
  other = await createInvoiceStore(db, "bc-b");
  subscriber = await scalar<string>(
    `insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token)
     values ($1, 'kari@example.com', 'nb-NO', 'subscribed', 'account', 'Yes', now(), $2) returning id`,
    [store, token("a")],
  );
});

afterAll(async () => {
  await db.close();
});

describe("broadcasts", () => {
  it("start as drafts and move only along their life", async () => {
    await rejects("insert into commerce.broadcasts (store_id, title, status) values ($1, 'x', 'sent')", [store], /starts as a draft/);
    const id = await draft();
    await rejects("update commerce.broadcasts set status = 'sent', started_at = now(), finished_at = now() where id = $1", [id], /draft cannot become sent/);
    await rejects("update commerce.broadcasts set status = 'scheduled' where id = $1", [id], /needs its time/);
    await db.query("update commerce.broadcasts set status = 'scheduled', scheduled_for = now() + interval '1 day' where id = $1", [id]);
    await db.query("update commerce.broadcasts set status = 'draft' where id = $1", [id]);
    await rejects("update commerce.broadcasts set status = 'sending' where id = $1", [id], /needs its start/);
    await start(id);
    await rejects("update commerce.broadcasts set status = 'draft' where id = $1", [id], /sending cannot become draft/);
    await rejects("update commerce.broadcasts set status = 'sent' where id = $1", [id], /needs its end/);
    await db.query("update commerce.broadcasts set status = 'sent', finished_at = now() where id = $1", [id]);
    await rejects("update commerce.broadcasts set status = 'cancelled' where id = $1", [id], /sent cannot become cancelled/);
    await rejects("update commerce.broadcasts set recipient_count = 9 where id = $1", [id], /broadcasts.fixed/);
  });

  it("keep their words and audience once a send starts, and only drafts are deleted", async () => {
    const id = await draft();
    await db.query(`update commerce.broadcasts set content = '{"nb-NO": {"subject": "Hei", "preview": "", "blocks": []}}' where id = $1`, [id]);
    await start(id);
    await rejects("update commerce.broadcasts set content = '{}' where id = $1", [id], /broadcasts.fixed/);
    await rejects("update commerce.broadcasts set title = 'Other' where id = $1", [id], /broadcasts.fixed/);
    // The report's figures may still be written.
    await db.query(`update commerce.broadcasts set counts = '{"sent": 1}' where id = $1`, [id]);
    await rejects("delete from commerce.broadcasts where id = $1", [id], /only a draft is deleted/);
    const gone = await draft();
    await db.query("delete from commerce.broadcasts where id = $1", [gone]);
    expect(await scalar<number>("select count(*)::int from commerce.broadcasts where id = $1", [gone])).toBe(0);
  });

  it("use only their own store's segment, and a deleted segment clears it even after a send", async () => {
    const rules = JSON.stringify({ match: "all", conditions: [] });
    const theirs = await scalar<string>("insert into commerce.segments (store_id, title, rules) values ($1, 'Theirs', $2) returning id", [other, rules]);
    const id = await draft();
    await rejects("update commerce.broadcasts set audience = 'segment', segment_id = $2 where id = $1", [id, theirs], /another store/);
    const ours = await scalar<string>("insert into commerce.segments (store_id, title, rules) values ($1, 'Ours', $2) returning id", [store, rules]);
    await db.query("update commerce.broadcasts set audience = 'segment', segment_id = $2 where id = $1", [id, ours]);
    await start(id);
    await db.query("delete from commerce.segments where id = $1", [ours]);
    expect(await scalar("select segment_id from commerce.broadcasts where id = $1", [id])).toBeNull();
  });
});

describe("broadcast recipients", () => {
  it("are frozen only while sending, once per subscriber, and move only from queued", async () => {
    const id = await draft();
    const insert = "insert into commerce.broadcast_recipients (store_id, broadcast_id, subscriber_id, email, locale) values ($1, $2, $3, 'kari@example.com', 'nb-NO')";
    await rejects(insert, [store, id, subscriber], /frozen only when a send starts/);
    await start(id);
    await db.query(insert, [store, id, subscriber]);
    await rejects(insert, [store, id, subscriber], /duplicate key/);
    await rejects("update commerce.broadcast_recipients set email = 'ola@example.com' where broadcast_id = $1", [id], /stays the address/);
    await rejects("update commerce.broadcast_recipients set status = 'skipped' where broadcast_id = $1", [id], /says why/);
    await db.query("update commerce.broadcast_recipients set status = 'sent', sent_at = now() where broadcast_id = $1", [id]);
    await rejects("update commerce.broadcast_recipients set status = 'queued' where broadcast_id = $1", [id], /sent cannot become queued/);
  });

  it("go with their subscriber, and clicks keep only a link and a count", async () => {
    const id = await draft();
    const gone = await scalar<string>(
      `insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token)
       values ($1, 'ola@example.com', 'en-GB', 'subscribed', 'account', 'Yes', now(), $2) returning id`,
      [store, token("b")],
    );
    await start(id);
    await db.query("insert into commerce.broadcast_recipients (store_id, broadcast_id, subscriber_id, email, locale) values ($1, $2, $3, 'ola@example.com', 'en-GB')", [store, id, gone]);
    await db.query("delete from commerce.marketing_subscribers where id = $1", [gone]);
    expect(await scalar<number>("select count(*)::int from commerce.broadcast_recipients where subscriber_id = $1", [gone])).toBe(0);
    await db.query("insert into commerce.broadcast_link_clicks (store_id, broadcast_id, link, clicks) values ($1, $2, 'nb-NO.2', 1)", [store, id]);
    await rejects("insert into commerce.broadcast_link_clicks (store_id, broadcast_id, link) values ($1, $2, 'nb-NO-2')", [store, id], /broadcast_link_clicks_link/);
  });
});
