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

describe("keeping a sandbox (D457 S2)", () => {
  /** A pending request from a sandbox, as Keep this store makes one. */
  async function keepRequest(sandbox: string | null, email: string): Promise<string> {
    const { id } = await one<{ id: string }>(
      "insert into commerce.access_requests (email, name, store_name, sandbox_id) values ($1, 'Kari', 'Kari Keramikk', $2) returning id",
      [email, sandbox],
    );
    return id;
  }

  it("hands the store, its address and name, to the person who asked, and keeps the sandbox", async () => {
    const { sandbox, store } = await makeSandbox();
    const request = await keepRequest(sandbox, "kari@example.com");
    const { id } = await one<{ id: string }>("select commerce.adopt_sandbox($1, 'kari-keramikk', 'Kari Keramikk', null) as id", [request]);
    expect(id).toBe(store);
    const row = await one<Record<string, unknown>>(
      `select s.slug, s.name, s.sandbox, s.private_mode, s.status, commerce.store_is_active(s.id) as active,
              (select array_agg(a.email) from commerce.store_members m join commerce.accounts a on a.id = m.account_id where m.store_id = s.id) as members,
              (select m.role from commerce.store_members m join commerce.accounts a on a.id = m.account_id where m.store_id = s.id and a.email = 'kari@example.com') as role,
              x.state, x.ended_at is not null as ended, r.status as request, r.store_id = s.id as request_store
         from commerce.stores s join commerce.sandboxes x on x.store_id = s.id join commerce.access_requests r on r.id = $2
        where s.id = $1`,
      [store, request],
    );
    expect(row).toEqual({
      slug: "kari-keramikk",
      name: "Kari Keramikk",
      sandbox: false,
      private_mode: true,
      status: "active",
      active: true,
      members: ["kari@example.com"],
      role: "owner",
      state: "kept",
      ended: true,
      request: "approved",
      request_store: true,
    });
    // Once kept, never a sandbox again, and its own members may be added.
    await refused("update commerce.stores set sandbox = true where id = $1", [store], /stores\.sandbox_fixed/);
    await refused("select commerce.adopt_sandbox($1, 'kari-2', 'Kari', null)", [request], /already approved/);
  });

  it("refuses a request that names no sandbox, or one that has ended", async () => {
    await refused("select commerce.adopt_sandbox($1, 'no-sandbox', 'X', null)", [await keepRequest(null, "none@example.com")], /sandboxes\.not_named/);
    const { sandbox } = await makeSandbox();
    const request = await keepRequest(sandbox, "late@example.com");
    await one("select commerce.expire_sandbox($1)", [sandbox]);
    await refused("select commerce.adopt_sandbox($1, 'too-late', 'X', null)", [request], /sandboxes\.not_open/);
    const { sandbox: due } = await makeSandbox();
    const dueRequest = await keepRequest(due, "due@example.com");
    await db.query("update commerce.sandboxes set expires_at = now() - interval '1 minute' where id = $1", [due]);
    await refused("select commerce.adopt_sandbox($1, 'past-time', 'X', null)", [dueRequest], /sandboxes\.not_open/);
  });

  it("refuses a disabled account, and changes nothing then", async () => {
    await db.query("insert into commerce.accounts (email, disabled_at) values ('gone@example.com', now())");
    const { sandbox, store } = await makeSandbox();
    const request = await keepRequest(sandbox, "gone@example.com");
    await refused("select commerce.adopt_sandbox($1, 'gone-shop', 'X', null)", [request], /disabled/);
    const row = await one<Record<string, unknown>>("select s.sandbox, x.state from commerce.stores s join commerce.sandboxes x on x.store_id = s.id where s.id = $1", [store]);
    expect(row).toEqual({ sandbox: true, state: "open" });
  });

  it("is the only way out: the store's flag and address stay as they are without it", async () => {
    const { store } = await makeSandbox();
    await refused("update commerce.stores set sandbox = false, slug = 'free-shop' where id = $1", [store], /stores\.sandbox_fixed/);
  });
});

describe("a sandbox's allowances (D457 S3)", () => {
  it("are the platform's settings, as limit overrides made with it, and go when the sandbox is kept", async () => {
    await db.query("update commerce.platform_settings set sandbox_ai_micros = 250000, sandbox_storage_bytes = 20000000");
    const { sandbox, store } = await makeSandbox();
    const limits = async () =>
      (await db.query<{ key: string; value: number }>("select key, value::int from commerce.limit_overrides where store_id = $1 order by key", [store])).rows;
    expect(await limits()).toEqual([
      { key: "ai_cost_month_micros", value: 250000 },
      { key: "storage_bytes", value: 20000000 },
    ]);
    const { id: request } = await one<{ id: string }>(
      "insert into commerce.access_requests (email, name, store_name, sandbox_id) values ('allowance@example.com', 'Ola', 'Ola', $1) returning id",
      [sandbox],
    );
    await one("select commerce.adopt_sandbox($1, 'ola-butikk', 'Ola', null)", [request]);
    expect(await limits()).toEqual([]);
    await db.query("update commerce.platform_settings set sandbox_ai_micros = default, sandbox_storage_bytes = default");
  });

  it("keeps the platform's settings within bounds", async () => {
    await refused("update commerce.platform_settings set sandbox_ai_micros = -1", [], /platform_settings_sandbox_ai/);
    await refused("update commerce.platform_settings set sandbox_storage_bytes = 2000000000", [], /platform_settings_sandbox_storage/);
  });
});

describe("purging a sandbox (D457 S3)", () => {
  /** What a visitor leaves in a sandbox, in the tables whose guards keep rows for ever elsewhere, and a picture and some AI. */
  async function useSandbox(store: string): Promise<void> {
    const { id: product } = await one<{ id: string }>("insert into commerce.products (store_id, handle, tax_code) values ($1, 'mug', 'txcd_99999999') returning id", [store]);
    const { id: variant } = await one<{ id: string }>("insert into commerce.product_variants (store_id, product_id, sku) values ($1, $2, 'MUG') returning id", [store, product]);
    // Two prices, the first a week back, so the history has a closed one (append-only anywhere else).
    await db.query("select commerce.set_price($1, 'NO', 1000, now() - interval '7 days')", [variant]);
    await db.query("select commerce.set_price($1, 'NO', 900)", [variant]);
    const { id: location } = await one<{ id: string }>("insert into commerce.inventory_locations (store_id, name, country) values ($1, 'Oslo', 'NO') returning id", [store]);
    // The level's first stock is written as a movement, which is kept for 24 months anywhere else.
    await db.query("insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values ($1, $2, $3, 4)", [store, variant, location]);
    await db.query(
      "insert into commerce.pages (store_id, type, slug, draft) values ($1, 'page', 'mitt', '{\"title\":\"Mitt\"}'::jsonb)",
      [store],
    );
    await db.query("update commerce.stores set custom_css = '.mine { color: red }' where id = $1", [store]);
    await db.query(
      "insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes) values ($1, 'image', $2, 'product-images', $3, 'mine.jpg', 'image/jpeg', 10)",
      [store, `https://example.com/${store}/mine.jpg`, `${store}/mine.jpg`],
    );
    await db.query("insert into commerce.audit_log (store_id, account_id, action, details) values ($1, commerce.sandbox_account(), 'store.page_saved', '{\"title\":\"Mitt\"}')", [store]);
    await db.query("insert into commerce.ai_usage (store_id, source, provider, model, kind, feature) values ($1, 'platform', 'openai', 'gpt', 'image', 'picture_make')", [store]);
  }

  /** The rows of a store in every table of `commerce` with a `store_id`, read from the catalogue, so a table added later is counted too. */
  async function rowsLeft(store: string): Promise<Record<string, number>> {
    const { rows: tables } = await db.query<{ name: string }>(
      `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'commerce'
         join pg_attribute a on a.attrelid = c.oid and a.attname = 'store_id' and not a.attisdropped
        where c.relkind in ('r', 'p') and not c.relispartition order by 1`,
    );
    expect(tables.length).toBeGreaterThan(200);
    const left: Record<string, number> = {};
    for (const { name } of tables) {
      const { n } = await one<{ n: number }>(`select count(*)::int as n from commerce.${name} where store_id = $1`, [store]);
      if (n > 0) left[name] = n;
    }
    return left;
  }

  it("refuses a sandbox that is open, kept or purged, and any store that is not a sandbox", async () => {
    const { sandbox } = await makeSandbox();
    await refused("select commerce.purge_sandbox($1)", [sandbox], /sandboxes\.not_expired/);
    await refused("select commerce.purge_sandbox($1)", [template], /sandboxes\.not_expired/);
    await one("select commerce.expire_sandbox($1)", [sandbox]);
    await one("select commerce.purge_sandbox($1)", [sandbox]);
    await refused("select commerce.purge_sandbox($1)", [sandbox], /sandboxes\.not_expired/);
  });

  it("leaves nothing of the store but its sandbox row, its AI's cost and a bare tombstone", async () => {
    const { sandbox, store } = await makeSandbox();
    await useSandbox(store);
    const before = await rowsLeft(store);
    // The tables whose guards keep their rows for ever anywhere else.
    for (const table of ["prices", "inventory_movements", "store_members", "audit_log", "pages", "media", "limit_overrides"]) expect(before[table], table).toBeGreaterThan(0);
    await one("select commerce.expire_sandbox($1)", [sandbox]);
    const { deleted } = await one<{ deleted: number }>("select commerce.purge_sandbox($1) as deleted", [sandbox]);
    expect(deleted).toBeGreaterThan(10);
    expect(await rowsLeft(store)).toEqual({ sandboxes: 1, ai_usage: 1 });
    const row = await one<Record<string, unknown>>(
      `select x.state, x.purged_at is not null as purged, s.slug like 'try-%' as address, s.status, s.sandbox, s.private_mode, s.custom_css, s.theme,
              s.front_page_id, s.header_menu_id
         from commerce.sandboxes x join commerce.stores s on s.id = x.store_id where x.id = $1`,
      [sandbox],
    );
    expect(row).toEqual({ state: "purged", purged: true, address: true, status: "closed", sandbox: true, private_mode: true, custom_css: "", theme: {}, front_page_id: null, header_menu_id: null });
    // Its row stays: the funnel's record that it was.
    await refused("delete from commerce.sandboxes where id = $1", [sandbox], /sandboxes\.no_delete/);
  });

  it("bends the guards for that store only, and only while it purges an expired sandbox", async () => {
    const { sandbox: open, store: openStore } = await makeSandbox();
    await useSandbox(openStore);
    const { store: other } = await makeSandbox();
    await useSandbox(other);
    await db.query("update commerce.sandboxes set state = 'expired', ended_at = now() where store_id = $1", [other]);
    await db.query("update commerce.stores set status = 'closed' where id = $1", [other]);
    // The setting names an open sandbox's store: its prices, movements and audit entries stay.
    await db.query("begin");
    await db.query("select set_config('commerce.sandbox_purge', $1, true)", [openStore]);
    await refused("delete from commerce.prices where store_id = $1", [openStore], /append-only/);
    await db.query("rollback");
    // It names an expired one's store, but the rows are another store's.
    await db.query("begin");
    await db.query("select set_config('commerce.sandbox_purge', $1, true)", [other]);
    await refused("delete from commerce.audit_log where store_id = $1", [openStore], /append-only/);
    await db.query("rollback");
    // Without the setting, an expired sandbox's guards hold as anywhere.
    await refused("delete from commerce.inventory_movements where store_id = $1", [other], /append-only/);
    await refused("delete from commerce.store_members where store_id = $1", [other], /keep at least one active owner/);
    expect(await one<{ state: string }>("select state from commerce.sandboxes where id = $1", [open])).toEqual({ state: "open" });
  });

  it("is the retention rule's to time: seeded at a week after the last visit", async () => {
    const rule = await one<Record<string, unknown>>("select period_value, period_unit, enforced_by from commerce.retention_rules where kind = 'sandboxes'");
    expect(rule).toEqual({ period_value: 7, period_unit: "days", enforced_by: "runRetention: sandboxes" });
  });
});

describe("premium themes in a sandbox (D457 S4)", () => {
  const SNAP = '{"v":1,"theme":{"base":"minimal","settings":{}},"header":null,"footer":null,"productLayout":null,"css":""}';

  async function theme(title: string, price: number | null): Promise<string> {
    const { id } = await one<{ id: string }>("insert into commerce.design_presets (title, snapshot, published) values ($1, $2::jsonb, true) returning id", [title, SNAP]);
    if (price !== null) await db.query("insert into commerce.theme_prices (preset_id, currency, amount_minor) values ($1, 'EUR', $2)", [id, price]);
    return id;
  }

  /** A theme made live on the store as the app does: the live one put away, the new one live. */
  async function goLive(store: string, preset: string): Promise<void> {
    const { id } = await one<{ id: string }>(
      "insert into commerce.store_theme_installs (store_id, preset_id, title, look) values ($1, $2, 'A theme', '{}'::jsonb) returning id",
      [store, preset],
    );
    await db.query("update commerce.store_theme_installs set live = false, look = '{}'::jsonb where store_id = $1 and live", [store]);
    await db.query("update commerce.store_theme_installs set live = true, look = null, switched_at = now() where id = $1", [id]);
  }

  const purchases = async (store: string) =>
    (await db.query<Record<string, unknown>>("select preset_id, status, currency, amount_minor::int as amount from commerce.theme_purchases where store_id = $1", [store])).rows;

  async function keep(sandbox: string, slug: string): Promise<void> {
    const { id } = await one<{ id: string }>(
      "insert into commerce.access_requests (email, name, store_name, sandbox_id) values ($1, 'Ola', 'Ola', $2) returning id",
      [`${slug}@example.com`, sandbox],
    );
    await one("select commerce.adopt_sandbox($1, $2, 'Ola', null)", [id, slug]);
  }

  it("owes nothing for a premium theme while it is a sandbox, so its purge meets no purchase", async () => {
    const premium = await theme("Gilded", 4900);
    const { sandbox, store } = await makeSandbox();
    await goLive(store, premium);
    expect(await purchases(store)).toEqual([]);
    await one("select commerce.expire_sandbox($1)", [sandbox]);
    await one("select commerce.purge_sandbox($1)", [sandbox]);
    expect((await one<{ state: string }>("select state from commerce.sandboxes where id = $1", [sandbox])).state).toBe("purged");
  });

  it("owes the premium theme live in it once it is kept, as a store that has not opened does, and nothing for a free one", async () => {
    const premium = await theme("Velvet", 5900);
    const free = await theme("Plain", null);
    const { sandbox, store } = await makeSandbox();
    await goLive(store, premium);
    await keep(sandbox, "velvet-shop");
    expect(await purchases(store)).toEqual([{ preset_id: premium, status: "owed", currency: "EUR", amount: 5900 }]);
    const { sandbox: plain, store: plainStore } = await makeSandbox();
    await goLive(plainStore, free);
    await keep(plain, "plain-shop");
    expect(await purchases(plainStore)).toEqual([]);
  });
});
