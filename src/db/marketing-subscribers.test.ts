/* eslint-disable @typescript-eslint/no-explicit-any -- rows are JSON and the tests read them as such */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mayMove, SUBSCRIBER_STATUSES } from "@/lib/marketing-consent";

import { createInvoiceStore, one as q1, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * The subscriber list (wave 5 unit A, D295, `docs/wave-5-marketing.md` 3.1): the status rules, the history the database writes for every change,
 * and that history kept, against every migration applied to a real Postgres (PGlite).
 */

let db: PGlite;
let store: string;
let other: string;

const one = <T = Record<string, any>>(sql: string, params: unknown[] = []) => q1<T>(db, sql, params);
const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "subs-a");
  other = await createInvoiceStore(db, "subs-b");
});

afterAll(async () => {
  await db.close();
});

let n = 0;
const token = () => `${"t".repeat(40)}${String(++n).padStart(3, "0")}`;
const hash = () => (n++).toString(16).padStart(64, "0");

async function subscriber(status: "pending" | "subscribed", email = `p${++n}@example.com`, storeId = store) {
  return scalar<string>(
    `insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token, confirm_hash, confirm_until)
     values ($1, $2, 'nb', $3, 'form', 'Send me news', now(), $4, $5, $6) returning id`,
    [storeId, email, status, token(), status === "pending" ? hash() : null, status === "pending" ? new Date(Date.now() + 86_400_000).toISOString() : null],
  );
}

const events = (id: string) =>
  db.query<{ kind: string; source: string; consent_text: string | null }>(
    "select kind, source, consent_text from commerce.marketing_consent_events where subscriber_id = $1 order by id",
    [id],
  ).then((r) => r.rows);

describe("a subscriber", () => {
  it("starts pending with a link or subscribed, never unsubscribed, and its first event is written", async () => {
    const pending = await subscriber("pending");
    expect(await events(pending)).toEqual([{ kind: "requested", source: "form", consent_text: "Send me news" }]);
    const subscribed = await subscriber("subscribed");
    expect((await events(subscribed)).map((e) => e.kind)).toEqual(["subscribed"]);
    await rejects(
      "insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token, unsubscribe_source) values ($1, 'x@example.com', 'nb', 'unsubscribed', 'form', 'w', now(), $2, 'staff')",
      [store, token()],
      /marketing_subscribers.insert/,
    );
    await rejects(
      "insert into commerce.marketing_subscribers (store_id, email, locale, status, source, consent_text, consented_at, token) values ($1, 'y@example.com', 'nb', 'pending', 'form', 'w', now(), $2)",
      [store, token()],
      /marketing_subscribers.pending/,
    );
  });

  it("is one per store and address, in lower case", async () => {
    await subscriber("subscribed", "same@example.com");
    await expect(subscriber("subscribed", "same@example.com")).rejects.toThrow(/marketing_subscribers_email_idx/);
    await expect(subscriber("subscribed", "Upper@example.com")).rejects.toThrow(/marketing_subscribers_email/);
    // Another store's list is its own.
    await subscriber("subscribed", "same@example.com", other);
  });

  it("moves only as mayMove() says, writing an event for each change", async () => {
    const id = await subscriber("pending");
    await db.query("update commerce.marketing_subscribers set status = 'subscribed', confirmed_at = now() where id = $1", [id]);
    let row = await one("select confirm_hash, confirm_until from commerce.marketing_subscribers where id = $1", [id]);
    expect(row).toEqual({ confirm_hash: null, confirm_until: null });
    await rejects("update commerce.marketing_subscribers set status = 'pending', confirm_hash = $2, confirm_until = now() where id = $1", [id, hash()], /marketing_subscribers.move/);
    await rejects("update commerce.marketing_subscribers set status = 'unsubscribed' where id = $1", [id], /marketing_subscribers.unsubscribed/);
    await db.query("update commerce.marketing_subscribers set status = 'unsubscribed', unsubscribe_source = 'link' where id = $1", [id]);
    row = await one("select unsubscribed_at is not null as left from commerce.marketing_subscribers where id = $1", [id]);
    expect(row.left).toBe(true);
    await rejects("update commerce.marketing_subscribers set unsubscribe_source = 'staff' where id = $1", [id], /marketing_subscribers.left/);
    // Coming back is a new consent, at once or by a new link.
    await db.query(
      "update commerce.marketing_subscribers set status = 'pending', consent_text = 'Again', consented_at = now(), confirm_hash = $2, confirm_until = now() + interval '7 days' where id = $1",
      [id, hash()],
    );
    expect(await events(id)).toEqual([
      { kind: "requested", source: "form", consent_text: "Send me news" },
      { kind: "subscribed", source: "form", consent_text: "Send me news" },
      { kind: "unsubscribed", source: "link", consent_text: null },
      { kind: "requested", source: "form", consent_text: "Again" },
    ]);
    // A second request while waiting is a new event with its new link.
    await db.query("update commerce.marketing_subscribers set confirm_hash = $2 where id = $1", [id, hash()]);
    expect((await events(id)).length).toBe(5);
    // A change of name is no event.
    await db.query("update commerce.marketing_subscribers set name = 'Kari' where id = $1", [id]);
    expect((await events(id)).length).toBe(5);
  });

  it("agrees with mayMove() for every pair", async () => {
    for (const from of SUBSCRIBER_STATUSES) {
      for (const to of SUBSCRIBER_STATUSES) {
        if (from === to) continue;
        const id = await subscriber(from === "pending" ? "pending" : "subscribed");
        if (from === "unsubscribed") await db.query("update commerce.marketing_subscribers set status = 'unsubscribed', unsubscribe_source = 'staff' where id = $1", [id]);
        const moved = await db
          .query(
            "update commerce.marketing_subscribers set status = $2, unsubscribe_source = case when $2 = 'unsubscribed' then 'staff' end, confirm_hash = case when $2 = 'pending' then $3 end, confirm_until = case when $2 = 'pending' then now() end where id = $1",
            [id, to, hash()],
          )
          .then(
            () => true,
            () => false,
          );
        expect([from, to, moved]).toEqual([from, to, mayMove(from, to)]);
      }
    }
  });

  it("keeps its consent, address, token and customer while subscribed", async () => {
    const id = await subscriber("subscribed");
    await rejects("update commerce.marketing_subscribers set consent_text = 'Other' where id = $1", [id], /marketing_subscribers.consent/);
    await rejects("update commerce.marketing_subscribers set email = 'new@example.com' where id = $1", [id], /marketing_subscribers.fixed/);
    await rejects("update commerce.marketing_subscribers set token = $2 where id = $1", [id, token()], /marketing_subscribers.fixed/);
    const customer = await scalar<string>("insert into commerce.customers (store_id, email) values ($1, 'c@example.com') returning id", [store]);
    const second = await scalar<string>("insert into commerce.customers (store_id, email) values ($1, 'd@example.com') returning id", [store]);
    await db.query("update commerce.marketing_subscribers set customer_id = $2 where id = $1", [id, customer]);
    await rejects("update commerce.marketing_subscribers set customer_id = $2 where id = $1", [id, second], /marketing_subscribers.fixed/);
    // Another store's customer cannot be linked.
    const foreign = await scalar<string>("insert into commerce.customers (store_id, email) values ($1, 'e@example.com') returning id", [other]);
    const another = await subscriber("subscribed");
    await rejects("update commerce.marketing_subscribers set customer_id = $2 where id = $1", [another, foreign], /marketing_subscribers_customer_fk/);
  });
});

describe("the consent history", () => {
  it("is written only by the subscribers' rules and never changed", async () => {
    const id = await subscriber("subscribed");
    await rejects("insert into commerce.marketing_consent_events (store_id, subscriber_id, kind, source) values ($1, $2, 'subscribed', 'staff')", [store, id], /marketing_consent_events.writer/);
    await rejects("update commerce.marketing_consent_events set source = 'staff' where subscriber_id = $1", [id], /marketing_consent_events.fixed/);
    await rejects("delete from commerce.marketing_consent_events where subscriber_id = $1", [id], /marketing_consent_events.kept/);
  });

  it("goes with its subscriber", async () => {
    const id = await subscriber("pending");
    await db.query("delete from commerce.marketing_subscribers where id = $1", [id]);
    expect(await events(id)).toEqual([]);
  });
});
