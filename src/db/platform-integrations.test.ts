import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PLATFORM_EVENTS } from "@/lib/platform-integrations";

import { createTestDatabase } from "./testing";

/**
 * Kaizena Flow's own integrations (D465): where the database queues each platform event, run against real Postgres (PGlite) with every
 * migration applied. Only a connected, switched-on service that chose the event gets it; a demo store, a template or a sandbox is never a
 * new store; a plan's start, change, cancelling and failed payment are each news once; a request's person goes from every delivery about
 * them when the request is blanked.
 */

let db: PGlite;
let template: string;
let templateQueued: string[] = [];

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query(
    "insert into commerce.platform_integrations (provider, enabled, webhook_url_encrypted, webhook_hint, events) values ('slack', true, 'v2.x', 'hooks.slack.com/…/ab12', $1)",
    [PLATFORM_EVENTS],
  );
  // Connected but switched off, and choosing one event: never queued.
  await db.query(
    "insert into commerce.platform_integrations (provider, enabled, webhook_url_encrypted, webhook_hint, events) values ('zapier', false, 'v2.y', 'hooks.zapier.com/…/cd34', '{store.created}')",
  );
  // Switched on, and choosing only new stores.
  await db.query(
    "insert into commerce.platform_integrations (provider, enabled, webhook_url_encrypted, webhook_hint, events) values ('make', true, 'v2.z', 'hook.eu2.make.com/…/ef56', '{store.created}')",
  );
  // The template a sandbox is copied from: itself never a new store.
  template = (await one<{ id: string }>("insert into commerce.stores (slug, name, is_template) values ('pi-template', 'Nordlys', true) returning id")).id;
  await db.query(
    `insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
     select $1, code, currency, default_locale, locales, true from commerce.countries where code = 'NO'`,
    [template],
  );
  templateQueued = await queued(template);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.query("delete from commerce.platform_integration_deliveries");
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

/** What was queued, as `provider event` sorted, for the subject given. */
async function queued(subject?: string): Promise<string[]> {
  const { rows } = await db.query<{ provider: string; event: string }>(
    `select provider, event from commerce.platform_integration_deliveries ${subject ? "where subject_id = $1" : ""} order by provider, event`,
    subject ? [subject] : [],
  );
  return rows.map((row) => `${row.provider} ${row.event}`);
}

let made = 0;
const newStore = async () => {
  made += 1;
  return (await one<{ id: string }>("insert into commerce.stores (slug, name) values ($1, $2) returning id", [`pi-${made}`, `Store ${made}`])).id;
};

/** A sandbox made the only way there is (D457), and its store. */
async function makeSandbox(): Promise<{ sandbox: string; store: string }> {
  made += 1;
  const { id: sandbox } = await one<{ id: string }>("select commerce.make_sandbox(null, $1, $2, 7) as id", [`try-${String(made).padStart(8, "0")}`, "a".repeat(64)]);
  const { store_id: store } = await one<{ store_id: string }>("select store_id from commerce.sandboxes where id = $1", [sandbox]);
  return { sandbox, store };
}

describe("a request for a store", () => {
  it("is news when it waits for a platform admin, not when it is self-serve", async () => {
    const waiting = (await one<{ id: string }>("insert into commerce.access_requests (email, name, store_name) values ('a@example.com', 'Ada', 'Ada''s') returning id")).id;
    const selfServe = (
      await one<{ id: string }>("insert into commerce.access_requests (email, name, store_name, self_serve) values ('b@example.com', 'Bo', 'Bo''s', true) returning id")
    ).id;
    expect(await queued(waiting)).toEqual(["slack request.received"]);
    expect(await queued(selfServe)).toEqual([]);
  });

  it("takes its person out of every delivery about it when it is blanked", async () => {
    const id = (await one<{ id: string }>("insert into commerce.access_requests (email, name, store_name) values ('c@example.com', 'Cy', 'Cy''s') returning id")).id;
    await db.query("update commerce.platform_integration_deliveries set payload = '{\"request\":{\"email\":\"c@example.com\"}}' where subject_id = $1", [id]);
    await db.query("update commerce.access_requests set email = 'erased-' || id || '@erased.invalid', name = '' where id = $1", [id]);
    const row = await one<{ payload: unknown; status: string; last_error: string }>(
      "select payload, status, last_error from commerce.platform_integration_deliveries where subject_id = $1",
      [id],
    );
    expect(row).toEqual({ payload: null, status: "failed", last_error: "Erased" });
  });
});

describe("a store", () => {
  it("made for an owner is news to every service that chose it and is switched on", async () => {
    const id = await newStore();
    expect(await queued(id)).toEqual(["make store.created", "slack store.created"]);
  });

  it("flagged as a demo store, a template or a sandbox where it is made is never a new store", async () => {
    let demo = "";
    await db.transaction(async (tx) => {
      demo = (await tx.query<{ id: string }>("insert into commerce.stores (slug, name) values ('pi-demo', 'Demo') returning id")).rows[0].id;
      await tx.query("update commerce.stores set starter = true where id = $1", [demo]);
    });
    const { sandbox, store } = await makeSandbox();
    expect(templateQueued).toEqual([]);
    expect(await queued(demo)).toEqual([]);
    expect(await queued(store)).toEqual([]);
    expect(sandbox).toBeTruthy();
  });

  it("kept from the sandbox is a new store then", async () => {
    const { sandbox, store } = await makeSandbox();
    const request = (
      await one<{ id: string }>(
        "insert into commerce.access_requests (email, name, store_name, sandbox_id) values ('kari@example.com', 'Kari', 'Kari Keramikk', $1) returning id",
        [sandbox],
      )
    ).id;
    await db.query("select commerce.adopt_sandbox($1, 'pi-kari', 'Kari Keramikk', null)", [request]);
    expect(await queued(store)).toEqual(["make store.created", "slack store.created"]);
  });

  it("opened by its owner is news once", async () => {
    const id = await newStore();
    await db.query("delete from commerce.platform_integration_deliveries");
    await db.query("update commerce.stores set setup_completed_at = now() where id = $1", [id]);
    await db.query("update commerce.stores set setup_completed_at = now() where id = $1", [id]);
    expect(await queued(id)).toEqual(["slack store.opened"]);
  });
});

describe("a store's plan", () => {
  let store: string;
  let basic: string;
  let pro: string;

  beforeAll(async () => {
    store = await newStore();
    basic = (await one<{ id: string }>("insert into commerce.plans (name) values ('PI Basic') returning id")).id;
    pro = (await one<{ id: string }>("insert into commerce.plans (name) values ('PI Pro') returning id")).id;
  });

  const bill = (set: string, params: unknown[] = []) => db.query(`update commerce.store_billing set ${set} where store_id = $1`, [store, ...params]);

  it("is news when it starts, changes, is cancelled and fails to be paid, each once", async () => {
    await db.query(
      "insert into commerce.store_billing (store_id, plan_id, mode, subscription_id, status) values ($1, $2, 'test', 'sub_1', 'trialing')",
      [store, basic],
    );
    expect(await queued(store)).toEqual(["slack plan.started"]);

    await db.query("delete from commerce.platform_integration_deliveries");
    await bill("status = 'active'");
    expect(await queued(store)).toEqual([]);
    await bill("plan_id = $2", [pro]);
    expect(await queued(store)).toEqual(["slack plan.changed"]);

    await db.query("delete from commerce.platform_integration_deliveries");
    await bill("status = 'past_due'");
    await bill("status = 'active'");
    expect(await queued(store)).toEqual(["slack plan.payment_failed"]);

    await db.query("delete from commerce.platform_integration_deliveries");
    await bill("cancel_at_period_end = true");
    await bill("status = 'canceled'");
    expect(await queued(store)).toEqual(["slack plan.cancelled"]);

    await db.query("delete from commerce.platform_integration_deliveries");
    await bill("subscription_id = 'sub_2', status = 'active', cancel_at_period_end = false");
    expect(await queued(store)).toEqual(["slack plan.started"]);

    await db.query("delete from commerce.platform_integration_deliveries");
    await bill("status = 'canceled'");
    expect(await queued(store)).toEqual(["slack plan.cancelled"]);
  });
});

describe("a notice of illegal content", () => {
  it("is news as it arrives", async () => {
    const id = (
      await one<{ id: string }>(
        "insert into commerce.content_reports (url, category, explanation, reporter_name, reporter_email, good_faith) values ('https://kaizenaflow.com/s/x', 'illegal_goods', 'A weapon.', 'Rita', 'rita@example.com', true) returning id",
      )
    ).id;
    expect(await queued(id)).toEqual(["slack report.received"]);
  });
});

describe("the platform's integrations", () => {
  it("take only the three services, and the deliveries only their states", async () => {
    await expect(
      db.query("insert into commerce.platform_integrations (provider, webhook_url_encrypted, webhook_hint, events) values ('webhook', 'x', 'x', '{}')"),
    ).rejects.toThrow(/platform_integrations_provider/);
    await expect(db.query("insert into commerce.platform_integration_deliveries (provider, event, status) values ('slack', 'test', 'sent')")).rejects.toThrow(
      /platform_integration_deliveries_status/,
    );
  });

  it("start a platform workflow that is on for its event, once per transaction, never one untested (D516)", async () => {
    const make = async (name: string, trigger: string) =>
      (await one<{ id: string }>(`insert into commerce.platform_workflows (name, trigger, actions) values ('${name}', '${trigger}', '[]') returning id`)).id;
    await expect(db.query("insert into commerce.platform_workflows (name, trigger, actions) values ('Odd', 'order.paid', '[]')")).rejects.toThrow(/platform_workflows_trigger/);
    const on = await make("On", "store.opened");
    const off = await make("Off", "store.opened");
    await expect(db.query(`update commerce.platform_workflows set enabled = true where id = '${on}'`)).rejects.toThrow(/platform_workflows_on_when_tested/);
    await db.query(`update commerce.platform_workflows set tested_version = version, enabled = true where id = '${on}'`);
    const subject = "00000000-0000-4000-8000-0000000000d6";
    // Twice in one transaction: one run.
    await db.transaction(async (tx) => {
      await tx.query(`select commerce.queue_platform_event('store.opened', '${subject}')`);
      await tx.query(`select commerce.queue_platform_event('store.opened', '${subject}')`);
    });
    await db.query(`select commerce.queue_platform_event('store.created', '${subject}')`);
    const { rows } = await db.query<{ workflow_id: string; status: string }>(`select workflow_id, status from commerce.platform_workflow_runs where subject_id = '${subject}'`);
    expect(rows).toEqual([{ workflow_id: on, status: "pending" }]);
    await db.query(`delete from commerce.platform_workflows where id in ('${on}', '${off}')`);
  });

  it("send to one of the platform's own endpoints only as `webhook`, and queue each endpoint that is on and asks for the event (D515)", async () => {
    await expect(db.query("insert into commerce.platform_integration_deliveries (provider, event) values ('webhook', 'test')")).rejects.toThrow(
      /platform_integration_deliveries_endpoint/,
    );
    const on = (
      await one<{ id: string }>(
        "insert into commerce.platform_webhook_endpoints (name, url_encrypted, hint, secret_encrypted, topics) values ('CRM', 'x', 'x', 'x', '{store.opened}') returning id",
      )
    ).id;
    const off = (
      await one<{ id: string }>(
        "insert into commerce.platform_webhook_endpoints (name, url_encrypted, hint, secret_encrypted, topics, enabled, disabled_reason) values ('Off', 'x', 'x', 'x', '{store.opened}', false, 'owner') returning id",
      )
    ).id;
    await expect(
      db.query("insert into commerce.platform_webhook_endpoints (name, url_encrypted, hint, secret_encrypted, topics) values ('None', 'x', 'x', 'x', '{}')"),
    ).rejects.toThrow(/platform_webhook_endpoints_topics/);
    await expect(
      db.query("insert into commerce.platform_webhook_endpoints (name, url_encrypted, hint, secret_encrypted, topics, disabled_reason) values ('Odd', 'x', 'x', 'x', '{store.opened}', 'uninstalled')"),
    ).rejects.toThrow(/platform_webhook_endpoints_disabled/);
    const subject = "00000000-0000-4000-8000-0000000000d5";
    await db.query(`select commerce.queue_platform_event('store.opened', '${subject}')`);
    await db.query(`select commerce.queue_platform_event('plan.started', '${subject}')`);
    const { rows } = await db.query<{ endpoint_id: string; event: string }>(
      `select endpoint_id, event from commerce.platform_integration_deliveries where provider = 'webhook' and subject_id = '${subject}'`,
    );
    expect(rows).toEqual([{ endpoint_id: on, event: "store.opened" }]);
    await db.query(`delete from commerce.platform_webhook_endpoints where id in ('${on}', '${off}')`);
    const { rows: left } = await db.query(`select 1 from commerce.platform_integration_deliveries where subject_id = '${subject}' and provider = 'webhook'`);
    expect(left).toEqual([]);
  });

  it("have row-level security, as every commerce table", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select relname, relrowsecurity from pg_class where relname in ('platform_integrations', 'platform_integration_deliveries', 'platform_webhook_endpoints', 'platform_workflows', 'platform_workflow_runs') order by relname",
    );
    expect(rows).toEqual([
      { relname: "platform_integration_deliveries", relrowsecurity: true },
      { relname: "platform_integrations", relrowsecurity: true },
      { relname: "platform_webhook_endpoints", relrowsecurity: true },
      { relname: "platform_workflow_runs", relrowsecurity: true },
      { relname: "platform_workflows", relrowsecurity: true },
    ]);
  });
});
