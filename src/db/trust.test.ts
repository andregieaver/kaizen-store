import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AUDIT_RETENTION_MONTHS, areaOfAction, explicitAreaOf } from "@/lib/audit";
import { LEGAL_ROLES } from "@/lib/legal-roles";
import { GRANTABLE_PERMISSIONS } from "@/lib/permission-keys";

import { createTestDatabase } from "./testing";

/**
 * Wave 1, trust lane (docs/wave-1-trust.md 3.3): the rules the database itself enforces for legal pages, terms at
 * checkout, accessibility, two-step recovery codes, roles and collaborators, and the activity log, against every
 * migration applied to a real Postgres (PGlite).
 */

let db: PGlite;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

async function makeStore(): Promise<string> {
  counter += 1;
  const { id } = await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ($1, $1, 'NO') returning id", [`trust-${counter}`]);
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = 'NO'`,
    [id],
  );
  return id;
}
async function makeAccount(): Promise<string> {
  counter += 1;
  return (await one<{ id: string }>("insert into commerce.accounts (email) values ($1) returning id", [`trust-${counter}@example.com`])).id;
}
async function makePage(store: string, slug: string, published = true): Promise<string> {
  return (
    await one<{ id: string }>(
      `insert into commerce.pages (store_id, slug, draft, published, published_at, type) values ($1, $2, '{}', ${published ? "'{}', now()" : "null, null"}, 'page') returning id`,
      [store, slug],
    )
  ).id;
}
async function makeOrder(store: string, copiedFrom: string | null = null): Promise<string> {
  counter += 1;
  return (
    await one<{ id: string }>(
      `insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
         discount_minor, tax_minor, total_minor, billing_address, shipping_address, copied_from)
       values ($1, $2, 'NO', 'NOK', 'nb-NO', 'shopper@example.com', 'paid', 1000, 0, 0, 200, 1000, '{}', '{}', $3) returning id`,
      [store, `${copiedFrom ? "C-" : "T-"}${counter}`, copiedFrom],
    )
  ).id;
}
const hash = (n: number) => n.toString(16).padStart(64, "0");
async function makeSnapshot(store: string, role = "terms", locale = "nb-NO", n = 1): Promise<string> {
  return (
    await one<{ id: string }>(
      "insert into commerce.legal_snapshots (store_id, role, locale, title, content, content_hash) values ($1, $2, $3, 'Vilkår', '{\"rows\": []}', $4) returning id",
      [store, role, locale, hash(n)],
    )
  ).id;
}

describe("legal roles in page_roles (1e)", () => {
  it("lets a store choose a published page for each legal role, one role per page", async () => {
    const store = await makeStore();
    for (const role of LEGAL_ROLES) {
      const page = await makePage(store, `legal-${role.replace(/_/g, "-")}`);
      await db.query("insert into commerce.page_roles (store_id, role, page_id) values ($1, $2, $3)", [store, role, page]);
    }
    const again = await makePage(store, "legal-again");
    await rejects("insert into commerce.page_roles (store_id, role, page_id) values ($1, 'terms', $2)", [store, again], /page_roles_pkey|duplicate/);
    const privacy = await one<{ page_id: string }>("select page_id from commerce.page_roles where store_id = $1 and role = 'privacy'", [store]);
    await rejects("insert into commerce.page_roles (store_id, role, page_id) values ($1, 'terms', $2)", [store, privacy.page_id], /page_roles_store_page_key|page_roles_pkey|duplicate/);
    await rejects("insert into commerce.page_roles (store_id, role, page_id) values ($1, 'gdpr', $2)", [store, again], /page_roles_role/);
  });

  it("keeps the old roles", async () => {
    const store = await makeStore();
    const page = await makePage(store, "cart-page");
    await db.query("insert into commerce.page_roles (store_id, role, page_id) values ($1, 'cart', $2)", [store, page]);
  });

  it("refuses another store's page", async () => {
    const a = await makeStore();
    const b = await makeStore();
    const page = await makePage(b, "theirs");
    await rejects("insert into commerce.page_roles (store_id, role, page_id) values ($1, 'terms', $2)", [a, page], /page_roles_page_fk/);
  });

  it("never lets a page holding a legal role be the target of an A/B test", async () => {
    const store = await makeStore();
    const page = await makePage(store, "terms-ab");
    await db.query("insert into commerce.page_roles (store_id, role, page_id) values ($1, 'terms', $2)", [store, page]);
    await rejects(
      "insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, 'x', $2, 'orders')",
      [store, page],
      /experiments\.target_legal/,
    );
    // A page given a legal role after its test was drafted is refused when the test starts.
    const plain = await makePage(store, "plain-ab");
    const variant = (await one<{ id: string }>("insert into commerce.pages (store_id, slug, draft, published, published_at, type) values ($1, 'plain-b', '{}', '{}', now(), 'variant') returning id", [store])).id;
    const test = (await one<{ id: string }>("insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, 'ok', $2, 'orders') returning id", [store, plain])).id;
    await db.query("insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share) values ($1, $2, 'a', 'A', null, 0.5), ($1, $2, 'b', 'B', $3, 0.5)", [store, test, variant]);
    await db.query("insert into commerce.page_roles (store_id, role, page_id) values ($1, 'privacy', $2)", [store, plain]);
    await rejects("update commerce.experiments set status = 'running' where id = $1", [test], /experiments\.target_legal/);
  });

  it("still starts a test of an ordinary page", async () => {
    const store = await makeStore();
    const plain = await makePage(store, "ordinary");
    const variant = (await one<{ id: string }>("insert into commerce.pages (store_id, slug, draft, published, published_at, type) values ($1, 'ordinary-b', '{}', '{}', now(), 'variant') returning id", [store])).id;
    const test = (await one<{ id: string }>("insert into commerce.experiments (store_id, name, target_page_id, primary_goal) values ($1, 'ok', $2, 'orders') returning id", [store, plain])).id;
    await db.query("insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share) values ($1, $2, 'a', 'A', null, 0.5), ($1, $2, 'b', 'B', $3, 0.5)", [store, test, variant]);
    await db.query("update commerce.experiments set status = 'running' where id = $1", [test]);
  });
});

describe("terms at checkout (1e)", () => {
  it("defaults to a link and accepts only the three modes", async () => {
    const store = await makeStore();
    expect(await one("select terms_at_checkout from commerce.stores where id = $1", [store])).toEqual({ terms_at_checkout: "link" });
    for (const mode of ["checkbox", "off", "link"]) await db.query("update commerce.stores set terms_at_checkout = $2 where id = $1", [store, mode]);
    await rejects("update commerce.stores set terms_at_checkout = 'banner' where id = $1", [store], /stores_terms_at_checkout/);
  });

  describe("legal snapshots", () => {
    it("deduplicates by store, role, locale and hash, and checks the role and the hash", async () => {
      const store = await makeStore();
      await makeSnapshot(store, "terms", "nb-NO", 1);
      await rejects(
        "insert into commerce.legal_snapshots (store_id, role, locale, title, content, content_hash) values ($1, 'terms', 'nb-NO', 'x', '{}', $2)",
        [store, hash(1)],
        /legal_snapshots_text_key|duplicate/,
      );
      await makeSnapshot(store, "terms", "nb-NO", 2); // a changed page is a new row
      await makeSnapshot(store, "terms", "sv-SE", 1); // another language is another row
      await makeSnapshot(store, "privacy", "nb-NO", 1); // another role too
      await rejects(
        "insert into commerce.legal_snapshots (store_id, role, locale, title, content, content_hash) values ($1, 'cart', 'nb-NO', 'x', '{}', $2)",
        [store, hash(3)],
        /legal_snapshots_role/,
      );
      await rejects(
        "insert into commerce.legal_snapshots (store_id, role, locale, title, content, content_hash) values ($1, 'terms', 'nb-NO', 'x', '{}', 'not-a-hash')",
        [store],
        /legal_snapshots_hash/,
      );
    });

    it("is never changed or removed", async () => {
      const store = await makeStore();
      const id = await makeSnapshot(store);
      await rejects("update commerce.legal_snapshots set title = 'Changed' where id = $1", [id], /append-only/);
      await rejects("delete from commerce.legal_snapshots where id = $1", [id], /append-only/);
    });

    it("survives the page it came from", async () => {
      const store = await makeStore();
      const page = await makePage(store, "gone");
      await db.query(
        "insert into commerce.legal_snapshots (store_id, role, locale, page_id, title, content, content_hash) values ($1, 'terms', 'nb-NO', $2, 'x', '{}', $3)",
        [store, page, hash(9)],
      );
      await db.query("delete from commerce.pages where id = $1", [page]);
      expect((await one<{ n: number }>("select count(*)::int as n from commerce.legal_snapshots where store_id = $1", [store])).n).toBe(1);
    });
  });

  describe("the record on an order", () => {
    const record = (store: string, order: string, snapshots: unknown, mode = "link") =>
      db.query("insert into commerce.order_terms (order_id, store_id, mode, locale, snapshots) values ($1, $2, $3, 'nb-NO', $4::jsonb)", [order, store, mode, JSON.stringify(snapshots)]);

    it("is written once for an order, naming the snapshots the shopper was shown", async () => {
      const store = await makeStore();
      const order = await makeOrder(store);
      const terms = await makeSnapshot(store, "terms");
      const privacy = await makeSnapshot(store, "privacy");
      await record(store, order, [
        { role: "terms", snapshotId: terms, hash: hash(1), title: "Vilkår" },
        { role: "privacy", snapshotId: privacy, hash: hash(1), title: "Personvern" },
      ], "checkbox");
      const row = await one<{ mode: string; accepted_at: string }>("select mode, accepted_at from commerce.order_terms where order_id = $1", [order]);
      expect(row.mode).toBe("checkbox");
      expect(row.accepted_at).toBeTruthy();
      await rejects("insert into commerce.order_terms (order_id, store_id, mode, locale, snapshots) values ($1, $2, 'link', 'nb-NO', $3::jsonb)", [order, store, JSON.stringify([{ role: "terms", snapshotId: terms }])], /order_terms_pkey|duplicate/);
    });

    it("is never changed or removed", async () => {
      const store = await makeStore();
      const order = await makeOrder(store);
      const terms = await makeSnapshot(store, "terms");
      await record(store, order, [{ role: "terms", snapshotId: terms }]);
      await rejects("update commerce.order_terms set mode = 'checkbox' where order_id = $1", [order], /append-only/);
      await rejects("delete from commerce.order_terms where order_id = $1", [order], /append-only/);
    });

    it("is refused for a copied order", async () => {
      const store = await makeStore();
      const original = await makeOrder(store);
      const copy = await makeOrder(store, original);
      const terms = await makeSnapshot(store, "terms");
      await rejects("insert into commerce.order_terms (order_id, store_id, mode, locale, snapshots) values ($1, $2, 'link', 'nb-NO', $3::jsonb)", [copy, store, JSON.stringify([{ role: "terms", snapshotId: terms }])], /order_terms\.copied/);
    });

    it("keeps to the order's own store and the store's own snapshots", async () => {
      const a = await makeStore();
      const b = await makeStore();
      const order = await makeOrder(a);
      const theirs = await makeSnapshot(b, "terms");
      const mine = await makeSnapshot(a, "terms");
      await rejects("insert into commerce.order_terms (order_id, store_id, mode, locale, snapshots) values ($1, $2, 'link', 'nb-NO', $3::jsonb)", [order, b, JSON.stringify([{ role: "terms", snapshotId: mine }])], /order_terms_order_fk|order_terms\.snapshot/);
      await rejects("insert into commerce.order_terms (order_id, store_id, mode, locale, snapshots) values ($1, $2, 'link', 'nb-NO', $3::jsonb)", [order, a, JSON.stringify([{ role: "terms", snapshotId: theirs }])], /order_terms\.snapshot/);
      // The snapshot must be under the role named for it.
      await rejects("insert into commerce.order_terms (order_id, store_id, mode, locale, snapshots) values ($1, $2, 'link', 'nb-NO', $3::jsonb)", [order, a, JSON.stringify([{ role: "privacy", snapshotId: mine }])], /order_terms\.snapshot/);
    });

    it("checks the mode and holds one or two snapshots", async () => {
      const store = await makeStore();
      const order = await makeOrder(store);
      const terms = await makeSnapshot(store, "terms");
      await rejects("insert into commerce.order_terms (order_id, store_id, mode, locale, snapshots) values ($1, $2, 'off', 'nb-NO', $3::jsonb)", [order, store, JSON.stringify([{ role: "terms", snapshotId: terms }])], /order_terms_mode/);
      await rejects("insert into commerce.order_terms (order_id, store_id, mode, locale, snapshots) values ($1, $2, 'link', 'nb-NO', '[]')", [order, store], /order_terms_snapshots/);
      await rejects("insert into commerce.order_terms (order_id, store_id, mode, locale, snapshots) values ($1, $2, 'link', 'nb-NO', '{}')", [order, store], /order_terms_snapshots/);
    });
  });
});

describe("accessibility settings (1e)", () => {
  it("starts as not assessed and says full only with an assessor and a date", async () => {
    const store = await makeStore();
    await db.query("insert into commerce.accessibility_settings (store_id) values ($1)", [store]);
    expect(await one("select status, microenterprise, known_issues from commerce.accessibility_settings where store_id = $1", [store])).toEqual({
      status: "not_assessed",
      microenterprise: false,
      known_issues: "",
    });
    await rejects("update commerce.accessibility_settings set status = 'full' where store_id = $1", [store], /accessibility_settings_full/);
    await rejects("update commerce.accessibility_settings set status = 'full', assessed_by = '  ' , assessed_on = '2026-09-01' where store_id = $1", [store], /accessibility_settings_full/);
    await rejects("update commerce.accessibility_settings set status = 'full', assessed_by = 'Audit AS' where store_id = $1", [store], /accessibility_settings_full/);
    await db.query("update commerce.accessibility_settings set status = 'full', assessed_by = 'Audit AS', assessed_on = '2026-09-01' where store_id = $1", [store]);
    await db.query("update commerce.accessibility_settings set status = 'partial' where store_id = $1", [store]);
    await rejects("update commerce.accessibility_settings set status = 'perfect' where store_id = $1", [store], /accessibility_settings_status/);
  });

  it("holds one row per store and bounds the free texts", async () => {
    const store = await makeStore();
    await db.query("insert into commerce.accessibility_settings (store_id) values ($1)", [store]);
    await rejects("insert into commerce.accessibility_settings (store_id) values ($1)", [store], /accessibility_settings_pkey|duplicate/);
    await rejects("update commerce.accessibility_settings set known_issues = $2 where store_id = $1", [store, "x".repeat(4001)], /accessibility_settings_known_issues/);
  });
});

describe("recovery codes (1f)", () => {
  const code = async (account: string, n: number, batch = "11111111-1111-1111-1111-111111111111") =>
    (await one<{ id: string }>("insert into commerce.account_recovery_codes (account_id, batch, code_hash) values ($1, $2, $3) returning id", [account, batch, hash(n)])).id;

  it("stores a hash only, once per account", async () => {
    const account = await makeAccount();
    await code(account, 1);
    await rejects("insert into commerce.account_recovery_codes (account_id, batch, code_hash) values ($1, gen_random_uuid(), $2)", [account, hash(1)], /account_recovery_codes_hash_key|duplicate/);
    await rejects("insert into commerce.account_recovery_codes (account_id, batch, code_hash) values ($1, gen_random_uuid(), 'K7QM2-9WXDB')", [account], /account_recovery_codes_hash/);
    // Another account may hold the same hash value: they are keyed by account.
    await code(await makeAccount(), 1);
  });

  it("is used once: the second use changes nothing", async () => {
    const account = await makeAccount();
    const id = await code(account, 2);
    const first = await db.query("update commerce.account_recovery_codes set used_at = now() where id = $1 and used_at is null returning id", [id]);
    expect(first.rows).toHaveLength(1);
    const second = await db.query("update commerce.account_recovery_codes set used_at = now() where id = $1 and used_at is null returning id", [id]);
    expect(second.rows).toHaveLength(0);
    await rejects("update commerce.account_recovery_codes set used_at = now() + interval '1 hour' where id = $1", [id], /recovery_codes\.single_use/);
    await rejects("update commerce.account_recovery_codes set used_at = null where id = $1", [id], /recovery_codes\.single_use/);
  });

  it("changes in no other way, and a revoked code cannot be used", async () => {
    const account = await makeAccount();
    const id = await code(account, 3);
    await rejects("update commerce.account_recovery_codes set code_hash = $2 where id = $1", [id, hash(4)], /recovery_codes\.fixed/);
    await rejects("update commerce.account_recovery_codes set batch = gen_random_uuid() where id = $1", [id], /recovery_codes\.fixed/);
    await rejects("update commerce.account_recovery_codes set account_id = $2 where id = $1", [id, await makeAccount()], /recovery_codes\.fixed/);
    await db.query("update commerce.account_recovery_codes set revoked_at = now() where id = $1", [id]);
    await rejects("update commerce.account_recovery_codes set used_at = now() where id = $1", [id], /recovery_codes\.revoked/);
    await rejects("update commerce.account_recovery_codes set revoked_at = null where id = $1", [id], /recovery_codes\.revoked/);
  });

  it("lets a used code be revoked with its set, and lets the daily job remove old rows", async () => {
    const account = await makeAccount();
    const id = await code(account, 5);
    await db.query("update commerce.account_recovery_codes set used_at = now() where id = $1", [id]);
    await db.query("update commerce.account_recovery_codes set revoked_at = now() where id = $1", [id]);
    await db.query("delete from commerce.account_recovery_codes where id = $1", [id]);
  });
});

describe("accounts and stores: the second step (1f)", () => {
  it("starts with no mirror, no forced enrolment and no store requirement", async () => {
    const account = await makeAccount();
    const store = await makeStore();
    expect(await one("select two_step_since, two_step_reenrol_at from commerce.accounts where id = $1", [account])).toEqual({ two_step_since: null, two_step_reenrol_at: null });
    expect(await one("select require_two_step from commerce.stores where id = $1", [store])).toEqual({ require_two_step: false });
  });
});

describe("roles and members (1f)", () => {
  const role = (store: string, name: string, permissions: string[], template: string | null = null) =>
    one<{ id: string }>("insert into commerce.store_roles (store_id, name, template, permissions) values ($1, $2, $3, $4::text[]) returning id", [store, name, template, permissions]);
  const member = (store: string, account: string, memberRole: string, extra = "") =>
    db.query(`insert into commerce.store_members (store_id, account_id, role${extra ? ", " + extra.split("=")[0] : ""}) values ($1, $2, $3${extra ? ", " + extra.split("=")[1] : ""})`, [store, account, memberRole]);

  it("makes roles of grantable keys only", async () => {
    const store = await makeStore();
    await role(store, "Orders", ["orders:read", "orders:write", "customers:read"]);
    await role(store, "Nothing", []);
    for (const key of ["staff:write", "billing:write", "owner", "orders:delete", "ORDERS:READ"]) {
      await rejects("insert into commerce.store_roles (store_id, name, permissions) values ($1, $2, $3::text[])", [store, `bad ${key}`, [key]], /store_roles_permissions/);
    }
    // All 18 grantable keys are accepted at once.
    await role(store, "Everything grantable", [...GRANTABLE_PERMISSIONS]);
    expect(GRANTABLE_PERMISSIONS).toHaveLength(18);
  });

  it("names a role once per store, whatever the case, in 1 to 60 characters", async () => {
    const a = await makeStore();
    const b = await makeStore();
    await role(a, "Support", []);
    await rejects("insert into commerce.store_roles (store_id, name) values ($1, 'SUPPORT')", [a], /store_roles_name_key|duplicate/);
    await role(b, "Support", []);
    await rejects("insert into commerce.store_roles (store_id, name) values ($1, '   ')", [a], /store_roles_name/);
    await rejects("insert into commerce.store_roles (store_id, name) values ($1, $2)", [a, "x".repeat(61)], /store_roles_name/);
    await db.query("insert into commerce.store_roles (store_id, name) values ($1, $2)", [a, "x".repeat(60)]);
  });

  it("makes a template role once and only the known templates", async () => {
    const store = await makeStore();
    await role(store, "Orders", ["orders:write"], "orders");
    await rejects("insert into commerce.store_roles (store_id, name, template) values ($1, 'Orders 2', 'orders')", [store], /store_roles_template_key|duplicate/);
    await rejects("insert into commerce.store_roles (store_id, name, template) values ($1, 'Weird', 'weird')", [store], /store_roles_template/);
    await role(store, "Mine", ["orders:read"], null);
    await role(store, "Mine too", ["orders:read"], null);
  });

  it("gives a custom role to an admin only, from the store's own roles", async () => {
    const a = await makeStore();
    const b = await makeStore();
    const owner = await makeAccount();
    const staff = await makeAccount();
    const other = await makeAccount();
    await member(a, owner, "owner");
    const mine = await role(a, "Content", ["website:write"]);
    const theirs = await role(b, "Content", ["website:write"]);
    await member(a, staff, "admin", `role_id='${mine.id}'`);
    await rejects("update commerce.store_members set role_id = $3 where store_id = $1 and account_id = $2", [a, staff, theirs.id], /store_members_role_fk/);
    await rejects("update commerce.store_members set role_id = $3 where store_id = $1 and account_id = $2", [a, owner, mine.id], /store_members_role_id/);
    await rejects(`insert into commerce.store_members (store_id, account_id, role, role_id) values ($1, $2, 'owner', $3)`, [a, other, mine.id], /store_members_role_id/);
  });

  it("will not remove a role that someone holds", async () => {
    const store = await makeStore();
    const owner = await makeAccount();
    const staff = await makeAccount();
    await member(store, owner, "owner");
    const used = await role(store, "Used", ["orders:read"]);
    const spare = await role(store, "Spare", ["orders:read"]);
    await member(store, staff, "admin", `role_id='${used.id}'`);
    await rejects("delete from commerce.store_roles where store_id = $1 and id = $2", [store, used.id], /store_members_role_fk|foreign key/);
    await db.query("delete from commerce.store_roles where store_id = $1 and id = $2", [store, spare.id]);
    await db.query("update commerce.store_members set role_id = null where store_id = $1 and account_id = $2", [store, staff]);
    await db.query("delete from commerce.store_roles where store_id = $1 and id = $2", [store, used.id]);
  });

  it("makes a collaborator an admin with an end date, never an owner", async () => {
    const store = await makeStore();
    const owner = await makeAccount();
    const agency = await makeAccount();
    await member(store, owner, "owner");
    await rejects(`insert into commerce.store_members (store_id, account_id, role, kind) values ($1, $2, 'admin', 'collaborator')`, [store, agency], /store_members_collaborator/);
    await rejects(`insert into commerce.store_members (store_id, account_id, role, kind, expires_at) values ($1, $2, 'owner', 'collaborator', now() + interval '30 days')`, [store, agency], /store_members_collaborator/);
    await rejects(`insert into commerce.store_members (store_id, account_id, role, kind, expires_at) values ($1, $2, 'admin', 'visitor', now() + interval '30 days')`, [store, agency], /store_members_kind/);
    await db.query(`insert into commerce.store_members (store_id, account_id, role, kind, expires_at) values ($1, $2, 'admin', 'collaborator', now() + interval '30 days')`, [store, agency]);
    // It cannot be turned into an owner, and the end date cannot be taken away.
    await rejects("update commerce.store_members set role = 'owner' where store_id = $1 and account_id = $2", [store, agency], /store_members_collaborator/);
    await rejects("update commerce.store_members set expires_at = null where store_id = $1 and account_id = $2", [store, agency], /store_members_collaborator/);
    // Ending early is the existing way: disabled_at.
    await db.query("update commerce.store_members set disabled_at = now() where store_id = $1 and account_id = $2", [store, agency]);
  });

  it("still keeps one active owner", async () => {
    const store = await makeStore();
    const owner = await makeAccount();
    await member(store, owner, "owner");
    await rejects("update commerce.store_members set role = 'admin' where store_id = $1 and account_id = $2", [store, owner], /at least one active owner/);
    await rejects("update commerce.store_members set disabled_at = now() where store_id = $1 and account_id = $2", [store, owner], /at least one active owner/);
    await rejects("delete from commerce.store_members where store_id = $1 and account_id = $2", [store, owner], /at least one active owner/);
  });
});

describe("the activity log (1f)", () => {
  const entry = (store: string | null, action: string, extra: { created?: string; area?: string | null } = {}) =>
    one<{ id: number }>(
      "insert into commerce.audit_log (store_id, action, area, created_at) values ($1, $2, $3, coalesce($4::timestamptz, now())) returning id",
      [store, action, extra.area ?? null, extra.created ?? null],
    );
  const monthsAgo = (months: number, extraDays = 0) => {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - months);
    d.setUTCDate(d.getUTCDate() - extraDays);
    return d.toISOString();
  };

  it("takes the new columns and checks the area", async () => {
    const store = await makeStore();
    const { id } = await one<{ id: number }>(
      `insert into commerce.audit_log (store_id, action, area, target_type, target_id, changes)
       values ($1, 'product.updated', 'products', 'product', 'p1', '{"title": {"from": "A", "to": "B"}}') returning id`,
      [store],
    );
    expect(await one("select area, target_type, target_id, changes from commerce.audit_log where id = $1", [id])).toMatchObject({ area: "products", target_type: "product", target_id: "p1" });
    await rejects("insert into commerce.audit_log (store_id, action, area) values ($1, 'x.y', 'marketplace')", [store], /audit_log_area/);
  });

  it("cannot be edited through the app", async () => {
    const store = await makeStore();
    const { id } = await entry(store, "staff.invited", { area: "staff" });
    await rejects("update commerce.audit_log set action = 'staff.disabled' where id = $1", [id], /append-only/);
    await rejects("update commerce.audit_log set details = '{\"x\": 1}' where id = $1", [id], /append-only/);
    await rejects("update commerce.audit_log set area = 'orders' where id = $1", [id], /append-only/); // already filled: not again
    await rejects("update commerce.audit_log set area = null where id = $1", [id], /append-only/);
  });

  it("lets an area be filled once, from null, and changes nothing else", async () => {
    const store = await makeStore();
    const { id } = await entry(store, "discount.created");
    await rejects("update commerce.audit_log set area = 'marketing', action = 'discount.deleted' where id = $1", [id], /append-only/);
    await rejects("update commerce.audit_log set area = 'marketing', details = '{\"a\": 1}' where id = $1", [id], /append-only/);
    await rejects("update commerce.audit_log set area = 'marketing', target_id = 'x' where id = $1", [id], /append-only/);
    await rejects("update commerce.audit_log set area = 'marketing', created_at = created_at - interval '1 year' where id = $1", [id], /append-only/);
    await db.query("update commerce.audit_log set area = 'marketing' where id = $1", [id]);
    expect(await one("select area from commerce.audit_log where id = $1", [id])).toEqual({ area: "marketing" });
  });

  it("keeps an entry for 24 months and lets the daily job remove it after", async () => {
    expect(AUDIT_RETENTION_MONTHS).toBe(24);
    const store = await makeStore();
    const fresh = await entry(store, "order.delivered");
    const nearly = await entry(store, "order.delivered", { created: monthsAgo(23, 20) });
    const old = await entry(store, "order.delivered", { created: monthsAgo(24, 2) });
    const older = await entry(store, "order.delivered", { created: monthsAgo(60) });
    await rejects("delete from commerce.audit_log where id = $1", [fresh.id], /append-only for 24 months/);
    await rejects("delete from commerce.audit_log where id = $1", [nearly.id], /append-only for 24 months/);
    await db.query("delete from commerce.audit_log where id = $1", [old.id]);
    await db.query("delete from commerce.audit_log where id = $1", [older.id]);
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.audit_log where store_id = $1", [store])).n).toBe(2);
  });

  it("states the same figure in the guard as the code does", async () => {
    const { src } = await one<{ src: string }>("select prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'commerce' and p.proname = 'guard_audit_log'");
    const months = [...src.matchAll(/interval '(\d+) months'/g)].map((m) => Number(m[1]));
    expect(months).toEqual([AUDIT_RETENTION_MONTHS]);
  });

  it("has no statement of removal, TRUNCATE or DROP inside any function this wave adds (the migration tool cancels them)", async () => {
    const { rows } = await db.query<{ proname: string; src: string }>(
      `select p.proname, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'commerce' and p.proname = any($1)`,
      [["guard_audit_log", "audit_area_of", "guard_recovery_code", "guard_order_terms", "experiments_guard"]],
    );
    expect(rows.map((r) => r.proname).sort()).toEqual(["audit_area_of", "experiments_guard", "guard_audit_log", "guard_order_terms", "guard_recovery_code"]);
    for (const { proname, src } of rows) expect([proname, /delete|truncate|drop/i.test(src)]).toEqual([proname, false]);
  });

  describe("the area of an old row", () => {
    const ACTIONS = [
      "account.password_set", "account.two_step_enrolled", "ai.platform_saved", "ai.saved", "analytics.settings", "billing.plan_changed", "booking.cancelled",
      "booking_resource.created", "bookings.enabled", "campaign.created", "cart_reminders.step_saved", "chat.agent_saved", "company.created", "company.deleted",
      "company.office_saved", "company.place_added", "company.updated", "cookies.note_saved", "customer.tier", "deliveries.enabled", "discount.updated",
      "experiment.started", "field_group.created", "google.key_saved", "google.platform_key_saved", "host.invited", "hosts.dac7_downloaded", "integration.saved",
      "knowledge.document_added", "language.added", "localization.currencies", "order.delivered", "page.ai_translated", "page.category_created",
      "payments.provider_updated", "plan_reminders.enabled", "platform.sale_fee_updated", "product.updated", "product.price_changed", "product_layout.assigned",
      "products.demo_archived", "recommendations.settings_saved", "resource_block.created", "return.refunded", "returns.settings_saved", "role.created",
      "search_test.started", "shipping.bring_booked", "shipping.updated", "staff.invited", "staff.role_assigned", "store.affiliate_settings", "store.bonus_settings",
      "store.copied", "store.created_by_owner", "store.css_saved", "store.domain_added", "store.fields_updated", "store.front_page_changed", "store.legal_role_changed",
      "store.page_published", "store.page_role_changed", "store.product_layout_saved", "store.products_page_changed", "store.theme_updated", "store.two_step_required",
      "term.fields_updated", "tier.created", "work.invoice.issued", "site_header.chosen", "store.assistant.set_stock", "store.article_saved", "store.menu_created",
      "something.unknown", "", "store.", "page.published_with_issues",
    ];
    it("is the same in the database as in code, for every action named here and the ones nothing names", async () => {
      const wrong: string[] = [];
      for (const action of ACTIONS) {
        const { area } = await one<{ area: string }>("select commerce.audit_area_of($1) as area", [action]);
        if (area !== areaOfAction(action)) wrong.push(`${action}: sql ${area}, code ${areaOfAction(action)}`);
      }
      expect(wrong).toEqual([]);
    });

    it("names an area in every audit() call's action, so a new action needs a decision (see audit.test.ts for the scan)", () => {
      expect(explicitAreaOf("store.page_published")).toBe("website");
      expect(explicitAreaOf("shipping.bring_booked")).toBe("orders");
      expect(explicitAreaOf("nothing.here")).toBeUndefined();
    });
  });
});
