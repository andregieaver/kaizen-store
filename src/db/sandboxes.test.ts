import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * The page builder's sandbox (D457, docs/builder-sandbox.md): the rules the database holds. A sandbox is a store `make_sandbox()` copies
 * from the source `starter_source()` decides, owned by the disabled sandbox account, private, never open for jobs or orders, with only that
 * account as member and no domain or payment provider; its row keeps its store and pass, moves only forward and is never deleted;
 * `expire_sandbox()` ends it and closes its store.
 */
let db: PGlite;
let template: string;
let counter = 0;

const PASS = "a".repeat(64);

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

async function refused(sql: string, params: unknown[], reason: RegExp): Promise<void> {
  await expect(db.query(sql, params)).rejects.toThrow(reason);
}

/** A fresh sandbox's id and its store's, at the next free `try-` address. */
async function makeSandbox(days = 7): Promise<{ sandbox: string; store: string; slug: string }> {
  counter += 1;
  const slug = `try-${String(counter).padStart(8, "0")}`;
  const { id: sandbox } = await one<{ id: string }>("select commerce.make_sandbox(null, $1, $2, $3) as id", [slug, PASS, days]);
  const { store_id: store } = await one<{ store_id: string }>("select store_id from commerce.sandboxes where id = $1", [sandbox]);
  return { sandbox, store, slug };
}

/** An order (status `pending_payment`), or a copied one (`paid`) when `$3` names its original. */
const orderInsert = `insert into commerce.orders (store_id, number, market_code, currency, locale, email,
  subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, copied_from, status)
  values ($1, $2, 'NO', 'NOK', 'nb-NO', 'a@example.com', 1000, 0, 0, 200, 1000, '{}', '{}', $3::uuid,
    case when $3::uuid is null then 'pending_payment' else 'paid' end::commerce.order_status)`;

beforeAll(async () => {
  db = await createTestDatabase();
  ({ id: template } = await one<{ id: string }>("insert into commerce.stores (slug, name, is_template) values ('tpl-sandbox', 'Nordlys', true) returning id"));
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = 'NO'`,
    [template],
  );
});

afterAll(async () => {
  await db.close();
});

describe("the sandbox account (D457)", () => {
  it("exists once, disabled, at an address no mail reaches", async () => {
    const account = await one<{ id: string; email: string; disabled: boolean }>(
      "select id, email, disabled_at is not null as disabled from commerce.accounts where id = commerce.sandbox_account()",
    );
    expect(account).toMatchObject({ email: "sandbox@kaizenaflow.invalid", disabled: true });
  });
});

describe("making a sandbox", () => {
  it("copies the Standard store into a private store the sandbox account owns, not open for jobs", async () => {
    const { sandbox, store, slug } = await makeSandbox();
    const row = await one<Record<string, unknown>>(
      `select s.slug, s.name, s.sandbox, s.private_mode, s.status, s.starter, s.is_template, commerce.store_is_active(s.id) as active,
              (select array_agg(m.account_id) from commerce.store_members m where m.store_id = s.id) = array[commerce.sandbox_account()] as owned,
              (select count(*)::int from commerce.markets m where m.store_id = s.id) as markets
         from commerce.stores s where s.id = $1`,
      [store],
    );
    expect(row).toMatchObject({ slug, name: "Nordlys", sandbox: true, private_mode: true, status: "active", starter: false, is_template: false, active: false, owned: true, markets: 1 });
    const kept = await one<Record<string, unknown>>(
      `select state, source_store_id = $2 as from_template, expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute' as week
         from commerce.sandboxes where id = $1`,
      [sandbox, template],
    );
    expect(kept).toEqual({ state: "open", from_template: true, week: true });
  });

  it("refuses an address that is not try- and eight letters or digits, and a time outside 1 to 30 days", async () => {
    await refused("select commerce.make_sandbox(null, 'my-store', $1, 7)", [PASS], /sandboxes\.address/);
    await refused("select commerce.make_sandbox(null, 'try-ABCDEFGH', $1, 7)", [PASS], /sandboxes\.address/);
    await refused("select commerce.make_sandbox(null, 'try-12345678', $1, 0)", [PASS], /sandboxes\.time/);
    await refused("select commerce.make_sandbox(null, 'try-12345678', $1, 31)", [PASS], /sandboxes\.time/);
    await refused("select commerce.make_sandbox(null, 'try-12345678', 'not-a-hash', 7)", [], /sandboxes_pass_hash/);
  });

  it("copies only what starter_source() offers", async () => {
    await refused("select commerce.make_sandbox($1, 'try-87654321', $2, 7)", [crypto.randomUUID(), PASS], /store_starters\.not_offered/);
  });
});

describe("a sandbox store's rules", () => {
  it("takes no order, a copied one neither", async () => {
    const { store } = await makeSandbox();
    await refused(orderInsert, [store, "1001", null], /orders\.store_sandbox/);
    await refused(orderInsert, [store, "C-1", crypto.randomUUID()], /orders\.store_sandbox/);
  });

  it("is made only by make_sandbox() and stays one", async () => {
    const { store } = await makeSandbox();
    await refused("insert into commerce.stores (slug, name, sandbox) values ('try-zzzzzzzz', 'X', true)", [], /stores\.sandbox_fixed/);
    await refused("update commerce.stores set sandbox = false where id = $1", [store], /stores\.sandbox_fixed/);
    await refused("update commerce.stores set sandbox = true where id = $1", [template], /stores\.sandbox_fixed/);
  });

  it("stays private, serves no agents, buys no domain and keeps its address", async () => {
    const { store } = await makeSandbox();
    await refused("update commerce.stores set private_mode = false where id = $1", [store], /stores\.sandbox_private/);
    await refused("update commerce.stores set shopping_agents = true where id = $1", [store], /stores\.sandbox_closed_doors/);
    await refused("update commerce.stores set domain_buying = true where id = $1", [store], /stores\.sandbox_closed_doors/);
    await refused("update commerce.stores set slug = 'try-yyyyyyyy' where id = $1", [store], /stores\.sandbox_address/);
  });

  it("is never a template or a store template, and only at a try- address", async () => {
    const { store } = await makeSandbox();
    await refused("update commerce.stores set starter = true where id = $1", [store], /stores_sandbox_not_template/);
  });

  it("has no member but the sandbox account, and no domain or payment provider", async () => {
    const { store } = await makeSandbox();
    const { id: person } = await one<{ id: string }>("insert into commerce.accounts (email) values ('person@example.com') returning id");
    await refused("insert into commerce.store_members (store_id, account_id, role) values ($1, $2, 'owner')", [store, person], /store_members\.sandbox/);
    await refused("insert into commerce.store_domains (store_id, hostname, token) values ($1, 'shop.example.com', 't')", [store], /store_domains\.sandbox/);
    await refused("insert into commerce.payment_providers (store_id, provider) values ($1, 'stripe')", [store], /payment_providers\.sandbox/);
  });
});

describe("a sandbox's row", () => {
  it("describes a sandbox store only", async () => {
    await refused("insert into commerce.sandboxes (store_id, pass_hash, expires_at) values ($1, $2, now() + interval '1 day')", [template, PASS], /sandboxes\.not_sandbox/);
  });

  it("keeps its store, source, pass and first times, and is never deleted", async () => {
    const { sandbox } = await makeSandbox();
    await refused("update commerce.sandboxes set pass_hash = $2 where id = $1", [sandbox, "b".repeat(64)], /sandboxes\.fixed/);
    await refused("update commerce.sandboxes set source_store_id = null where id = $1", [sandbox], /sandboxes\.fixed/);
    await db.query("update commerce.sandboxes set first_change_at = now() where id = $1", [sandbox]);
    await refused("update commerce.sandboxes set first_change_at = null where id = $1", [sandbox], /sandboxes\.fixed/);
    await refused("delete from commerce.sandboxes where id = $1", [sandbox], /sandboxes\.no_delete/);
  });

  it("lasts 30 days at most", async () => {
    const { sandbox } = await makeSandbox();
    await refused("update commerce.sandboxes set expires_at = created_at + interval '31 days' where id = $1", [sandbox], /sandboxes_time/);
  });

  it("moves only forward: open to expired or kept, expired to purged", async () => {
    const { sandbox } = await makeSandbox();
    await refused("update commerce.sandboxes set state = 'purged', ended_at = now() where id = $1", [sandbox], /sandboxes\.state_step/);
    await refused("update commerce.sandboxes set state = 'expired' where id = $1", [sandbox], /sandboxes_ended/);
    expect((await one<{ ended: boolean }>("select commerce.expire_sandbox($1) as ended", [sandbox])).ended).toBe(true);
    await refused("update commerce.sandboxes set state = 'open', ended_at = null where id = $1", [sandbox], /sandboxes\.state_step/);
  });
});

describe("ending a sandbox", () => {
  it("expires its row once and closes its store", async () => {
    const { sandbox, store } = await makeSandbox();
    expect((await one<{ ended: boolean }>("select commerce.expire_sandbox($1) as ended", [sandbox])).ended).toBe(true);
    expect((await one<{ ended: boolean }>("select commerce.expire_sandbox($1) as ended", [sandbox])).ended).toBe(false);
    const row = await one<Record<string, unknown>>(
      `select x.state, x.ended_at is not null as ended, s.status, s.status_reason, s.closed_at is not null as closed
         from commerce.sandboxes x join commerce.stores s on s.id = x.store_id where x.id = $1`,
      [sandbox],
    );
    expect(row).toEqual({ state: "expired", ended: true, status: "closed", status_reason: "Sandbox ended", closed: true });
    expect(store).toBeTruthy();
  });
});
