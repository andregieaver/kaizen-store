import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NOT_PERSONAL, PERSONAL_DATA } from "@/lib/personal-data";
import { COPY_RULES } from "@/lib/store-copy-rules";
import { STORE_EXPORT_LEFT_OUT } from "@/lib/store-export-scope";

import { createTestDatabase } from "./testing";

/**
 * Contracts for deals (D695, `docs/contracts.md`): the rules the database holds, against real Postgres (PGlite) with every migration applied.
 * A draft changes freely and is sent once, with its snapshot, its PDF and both signers; the sent document never changes. Signers are named
 * on a draft (the store's a member), each signs or declines once, in order, against the sent PDF's SHA-256, while the time lasts. The last
 * signature signs the contract and wins the deal; a decline declines it; sending moves the deal to the contract stage. Events are kept.
 */

let db: PGlite;
let shop: string;
let other: string;
let seller: string;
let outsider: string;
let counter = 0;

type Row = Record<string, unknown>;
const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);

async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

async function store(slug: string): Promise<string> {
  return (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ($1, $1, 'NO') returning id", [slug])).id;
}

async function pipeline(storeId: string) {
  counter += 1;
  const { id } = await one<{ id: string }>("insert into commerce.deal_pipelines (store_id, name) values ($1, $2) returning id", [storeId, `Sales ${counter}`]);
  const stages: string[] = [];
  for (const [position, name] of ["New", "Talking", "Contract sent"].entries()) {
    stages.push(
      (
        await one<{ id: string }>(
          "insert into commerce.deal_stages (store_id, pipeline_id, name, position, contract_stage) values ($1, $2, $3, $4, $5) returning id",
          [storeId, id, name, position, position === 2],
        )
      ).id,
    );
  }
  return { id, stages };
}

async function deal(storeId = shop): Promise<{ id: string; customer: string; stages: string[] }> {
  counter += 1;
  const p = await pipeline(storeId);
  const customer = (await one<{ id: string }>("insert into commerce.customers (store_id, email) values ($1, $2) returning id", [storeId, `c-${counter}@example.com`])).id;
  const id = (
    await one<{ id: string }>(
      `insert into commerce.deals (store_id, title, customer_id, pipeline_id, stage_id, currency) values ($1, $2, $3, $4, $5, 'NOK') returning id`,
      [storeId, `Deal ${counter}`, customer, p.id, p.stages[0]],
    )
  ).id;
  return { id, customer, stages: p.stages };
}

async function contract(dealId: string, over: { replaces?: string } = {}): Promise<string> {
  return (
    await one<{ id: string }>(
      `insert into commerce.contracts (store_id, deal_id, title, language, blocks, replaces_id) values ($1, $2, 'Agreement', 'nb', '[{"type":"paragraph","text":"Hei"}]', $3) returning id`,
      [shop, dealId, over.replaces ?? null],
    )
  ).id;
}

async function signers(contractId: string): Promise<{ store: string; customer: string }> {
  const storeSigner = (
    await one<{ id: string }>(
      `insert into commerce.contract_signers (store_id, contract_id, role, position, name, email, account_id) values ($1, $2, 'store', 0, 'Selger', 'seller@example.com', $3) returning id`,
      [shop, contractId, seller],
    )
  ).id;
  const customer = (
    await one<{ id: string }>(
      `insert into commerce.contract_signers (store_id, contract_id, role, position, name, email) values ($1, $2, 'customer', 1, 'Kunde', 'kunde@example.com') returning id`,
      [shop, contractId],
    )
  ).id;
  return { store: storeSigner, customer };
}

const send = (contractId: string, sha = SHA) =>
  db.query(
    `update commerce.contracts set status = 'sent', sent_at = now(), sent_by = $2, expires_at = now() + interval '30 days',
       snapshot = blocks, pdf_path = 'contracts/x.pdf', pdf_sha256 = $3 where id = $1`,
    [contractId, seller, sha],
  );

const sign = (signerId: string, sha = SHA) =>
  db.query(
    `update commerce.contract_signers set signed_at = now(), signed_name = 'Kari Nordmann', document_sha256 = $2,
       evidence = '{"method":"email_code"}', ip = '203.0.113.9', user_agent = 'Test' where id = $1`,
    [signerId, sha],
  );

const statusOf = async (contractId: string) => (await one<{ status: string }>("select status from commerce.contracts where id = $1", [contractId])).status;
const eventsOf = async (contractId: string) =>
  (await db.query<{ kind: string }>("select kind from commerce.contract_events where contract_id = $1 order by id", [contractId])).rows.map((r) => r.kind);

beforeAll(async () => {
  db = await createTestDatabase();
  shop = await store("contracts-shop");
  other = await store("contracts-other");
  seller = (await one<{ id: string }>("insert into commerce.accounts (email) values ('seller@example.com') returning id")).id;
  outsider = (await one<{ id: string }>("insert into commerce.accounts (email) values ('outsider@example.com') returning id")).id;
  await db.query("insert into commerce.store_members (store_id, account_id, role) values ($1, $2, 'owner')", [shop, seller]);
});

afterAll(async () => {
  await db.close();
});

describe("a template", () => {
  it("rises a version when its blocks change, and only then", async () => {
    const { id } = await one<{ id: string }>(
      "insert into commerce.contract_templates (store_id, name, language, version) values ($1, 'Standard', 'nb', 7) returning id",
      [shop],
    );
    const version = async () => (await one<{ version: number }>("select version from commerce.contract_templates where id = $1", [id])).version;
    expect(await version()).toBe(1);
    await db.query("update commerce.contract_templates set name = 'Standard avtale' where id = $1", [id]);
    expect(await version()).toBe(1);
    await db.query(`update commerce.contract_templates set blocks = '[{"type":"heading","text":"Avtale"}]' where id = $1`, [id]);
    expect(await version()).toBe(2);
    await rejects("insert into commerce.contract_templates (store_id, name, language) values ($1, 'STANDARD AVTALE', 'nb')", [shop], /contract_templates_name_key/);
  });

  it("is kept in the contract made from it, by its version", async () => {
    const { id } = await one<{ id: string }>("insert into commerce.contract_templates (store_id, name, language) values ($1, 'Kept', 'en') returning id", [shop]);
    await db.query(`update commerce.contract_templates set blocks = '[{"type":"heading","text":"A"}]'::jsonb where id = $1`, [id]);
    const d = await deal();
    const c = await one<{ template_version: number }>(
      "insert into commerce.contracts (store_id, deal_id, template_id, title, language) values ($1, $2, $3, 'From a template', 'en') returning template_version",
      [shop, d.id, id],
    );
    expect(c.template_version).toBe(2);
    await rejects("delete from commerce.contract_templates where id = $1", [id], /contracts_template_fk/);
  });
});

describe("a draft", () => {
  it("starts as a draft on its store's deal, with the deal's person", async () => {
    const d = await deal();
    const id = await contract(d.id);
    expect(await one("select status, customer_id from commerce.contracts where id = $1", [id])).toEqual({ status: "draft", customer_id: d.customer });
    await rejects(
      "insert into commerce.contracts (store_id, deal_id, title, language, status, sent_at) values ($1, $2, 'Sent at once', 'nb', 'sent', now())",
      [shop, d.id],
      /contracts.draft/,
    );
    await rejects("insert into commerce.contracts (store_id, deal_id, title, language) values ($1, $2, 'Elsewhere', 'nb')", [other, d.id], /contracts_deal_fk/);
  });

  it("names the store's signer from the store's members, and no account for the customer's", async () => {
    const id = await contract((await deal()).id);
    await rejects(
      "insert into commerce.contract_signers (store_id, contract_id, role, position, name, email, account_id) values ($1, $2, 'store', 0, 'X', 'x@example.com', $3)",
      [shop, id, outsider],
      /contract_signers.store/,
    );
    await rejects(
      "insert into commerce.contract_signers (store_id, contract_id, role, position, name, email, account_id) values ($1, $2, 'customer', 0, 'X', 'x@example.com', $3)",
      [shop, id, seller],
      /contract_signers.account/,
    );
    await rejects(
      "insert into commerce.contract_signers (store_id, contract_id, role, position, name, email) values ($1, $2, 'customer', 0, 'X', 'Not An Email')",
      [shop, id],
      /contract_signers_email/,
    );
    const { token } = await one<{ token: string }>(
      "insert into commerce.contract_signers (store_id, contract_id, role, position, name, email) values ($1, $2, 'customer', 1, 'Kunde', 'k@example.com') returning token",
      [shop, id],
    );
    expect(token).toMatch(/^sig_[A-Za-z0-9_-]{43}$/);
  });

  it("is sent only with its PDF, time to sign and both signers, and is deleted rather than cancelled", async () => {
    const id = await contract((await deal()).id);
    await rejects(
      "update commerce.contracts set status = 'sent', sent_at = now(), expires_at = now() + interval '1 day', snapshot = blocks where id = $1",
      [id],
      /contracts.pdf/,
    );
    await rejects("update commerce.contracts set status = 'cancelled', closed_at = now() where id = $1", [id], /contracts.status/);
    await expect(send(id)).rejects.toThrow(/contracts.signers/);
    await signers(id);
    await rejects(
      `update commerce.contracts set status = 'sent', sent_at = now(), expires_at = now() - interval '1 minute', snapshot = blocks,
         pdf_path = 'p.pdf', pdf_sha256 = $2 where id = $1`,
      [id, SHA],
      /contracts.expires/,
    );
    await send(id);
    expect(await statusOf(id)).toBe("sent");
    const draft = await contract((await deal()).id);
    await db.query("delete from commerce.contracts where id = $1", [draft]);
  });
});

describe("a sent contract", () => {
  it("keeps its document, signers and who it is with; a change is a new version that cancels it", async () => {
    const d = await deal();
    const id = await contract(d.id);
    const s = await signers(id);
    await send(id);
    await rejects(`update commerce.contracts set blocks = '[]' where id = $1`, [id], /contracts.frozen/);
    await rejects(`update commerce.contracts set title = 'Changed' where id = $1`, [id], /contracts.frozen/);
    await rejects(`update commerce.contracts set pdf_sha256 = $2 where id = $1`, [id, OTHER_SHA], /contracts.frozen/);
    await rejects("update commerce.contract_signers set email = 'other@example.com' where id = $1", [s.customer], /contract_signers.frozen/);
    await rejects("delete from commerce.contract_signers where id = $1", [s.customer], /contract_signers.frozen/);
    await rejects(
      "insert into commerce.contract_signers (store_id, contract_id, role, position, name, email) values ($1, $2, 'other', 5, 'Late', 'late@example.com')",
      [shop, id],
      /contract_signers.frozen/,
    );
    await rejects("delete from commerce.contracts where id = $1", [id], /contracts.kept/);
    await rejects("update commerce.contracts set status = 'signed', completed_at = now() where id = $1", [id], /contracts.signers_only/);
    await rejects("update commerce.contracts set status = 'expired', closed_at = now() where id = $1", [id], /contracts.not_expired/);

    const next = await contract(d.id, { replaces: id });
    await signers(next);
    await send(next, OTHER_SHA);
    expect(await statusOf(id)).toBe("cancelled");
    expect(await eventsOf(id)).toEqual(["sent", "cancelled"]);
    await rejects("update commerce.contracts set status = 'sent', closed_at = null where id = $1", [id], /contracts/);
  });

  it("is replaced only by a contract of the same deal, once", async () => {
    const d = await deal();
    const id = await contract(d.id);
    await signers(id);
    await rejects(
      "insert into commerce.contracts (store_id, deal_id, title, language, replaces_id) values ($1, $2, 'Early', 'nb', $3)",
      [shop, d.id, id],
      /contracts.replaces/,
    );
    await send(id);
    await rejects(
      "insert into commerce.contracts (store_id, deal_id, title, language, replaces_id) values ($1, $2, 'Other deal', 'nb', $3)",
      [shop, (await deal()).id, id],
      /contracts.replaces/,
    );
    await contract(d.id, { replaces: id });
    await rejects(
      "insert into commerce.contracts (store_id, deal_id, title, language, replaces_id) values ($1, $2, 'Twice', 'nb', $3)",
      [shop, d.id, id],
      /contracts_replaces_key/,
    );
  });

  it("moves its deal forward to the contract stage, never back", async () => {
    const d = await deal();
    const id = await contract(d.id);
    await signers(id);
    await send(id);
    const moved = await one<{ stage_id: string; via: string }>(
      "select d.stage_id, m.via from commerce.deals d join commerce.deal_moves m on m.deal_id = d.id where d.id = $1 order by m.id desc limit 1",
      [d.id],
    );
    expect(moved).toEqual({ stage_id: d.stages[2], via: "contract" });
  });
});

describe("signing", () => {
  it("is once per signer, in order, against the PDF that was sent; the last signature signs it and wins the deal", async () => {
    const d = await deal();
    const id = await contract(d.id);
    const s = await signers(id);
    await expect(sign(s.store)).rejects.toThrow(/contract_signers.not_sent/);
    await send(id);
    await expect(sign(s.customer)).rejects.toThrow(/contract_signers.order/);
    await expect(sign(s.store, OTHER_SHA)).rejects.toThrow(/contract_signers.document/);
    await sign(s.store);
    await expect(sign(s.store)).rejects.toThrow(/contract_signers.once/);
    expect(await statusOf(id)).toBe("sent");
    await db.query("update commerce.contract_signers set viewed_at = now() where id = $1", [s.customer]);
    await rejects("update commerce.contract_signers set viewed_at = now() + interval '1 hour' where id = $1", [s.customer], /contract_signers.once/);
    await sign(s.customer);
    expect(await statusOf(id)).toBe("signed");
    expect(await eventsOf(id)).toEqual(["sent", "signed", "signed", "completed"]);
    expect(await one("select status, closed_via from commerce.deals where id = $1", [d.id])).toEqual({ status: "won", closed_via: "contract" });
    await db.query("update commerce.contracts set signed_pdf_path = 'signed.pdf', signed_pdf_sha256 = $2 where id = $1", [id, OTHER_SHA]);
    await rejects("update commerce.contracts set signed_pdf_path = 'again.pdf' where id = $1", [id], /contracts.signed_pdf/);
    await rejects("update commerce.contracts set status = 'cancelled', closed_at = now(), completed_at = null where id = $1", [id], /contracts.closed/);
  });

  it("is declined by one signer, with a reason, which declines the contract and leaves the deal open", async () => {
    const d = await deal();
    const id = await contract(d.id);
    const s = await signers(id);
    await send(id);
    await db.query("update commerce.contract_signers set declined_at = now(), decline_reason = 'Too expensive' where id = $1", [s.customer]);
    expect(await statusOf(id)).toBe("declined");
    await expect(sign(s.store)).rejects.toThrow(/contract_signers.closed/);
    expect(await one("select status from commerce.deals where id = $1", [d.id])).toEqual({ status: "open" });
    expect(await eventsOf(id)).toEqual(["sent", "declined"]);
  });

  it("is refused once the time has passed, and the contract then expires", async () => {
    const id = await contract((await deal()).id);
    const s = await signers(id);
    await send(id);
    await db.query("alter table commerce.contracts disable trigger contracts_guard");
    await db.query("update commerce.contracts set expires_at = now() - interval '1 minute' where id = $1", [id]);
    await db.query("alter table commerce.contracts enable trigger contracts_guard");
    await expect(sign(s.store)).rejects.toThrow(/contract_signers.expired/);
    await db.query("update commerce.contracts set status = 'expired', closed_at = now() where id = $1", [id]);
    expect(await eventsOf(id)).toEqual(["sent", "expired"]);
  });
});

describe("the store's events (D695 step 4)", () => {
  it("queues contract.sent, signed and declined for the endpoints and workflows that chose them, and nothing for a draft", async () => {
    const endpoint = await one<{ id: string }>(
      "insert into commerce.webhook_endpoints (store_id, name, url_encrypted, hint, secret_encrypted, topics) values ($1, 'Mine', 'sealed', 'example.com/…', 'sealed', array['contract.sent', 'contract.signed', 'contract.declined']) returning id",
      [shop],
    );
    const queued = async (contractId: string) =>
      (await db.query<{ event: string }>("select event from commerce.integration_deliveries where endpoint_id = $1 and subject_id = $2 order by created_at, event", [endpoint.id, contractId])).rows.map((r) => r.event);

    const d = await deal();
    const id = await contract(d.id);
    expect(await queued(id)).toEqual([]);
    const s = await signers(id);
    await send(id);
    await sign(s.store);
    expect(await queued(id)).toEqual(["contract.sent"]);
    await sign(s.customer);
    expect(await queued(id)).toEqual(["contract.sent", "contract.signed"]);

    const other = await contract((await deal()).id);
    const t = await signers(other);
    await send(other);
    await db.query("update commerce.contract_signers set declined_at = now(), decline_reason = 'No' where id = $1", [t.customer]);
    expect(await queued(other)).toEqual(["contract.sent", "contract.declined"]);
    await db.query("delete from commerce.webhook_endpoints where id = $1", [endpoint.id]);
  });

  it("is a trigger a workflow may have", async () => {
    for (const trigger of ["contract.sent", "contract.signed", "contract.declined"]) {
      const made = await one<{ id: string }>(
        "insert into commerce.workflows (store_id, name, trigger, actions) values ($1, $2, $3, '[{\"kind\":\"email_staff\",\"subject\":\"x\",\"text\":\"y\"}]') returning id",
        [shop, `On ${trigger}`, trigger],
      );
      await db.query("delete from commerce.workflows where id = $1", [made.id]);
    }
  });
});

describe("the events and erasure", () => {
  it("never changes an event, and lets a sent contract go only with its deal or by erasure", async () => {
    const d = await deal();
    const id = await contract(d.id);
    await signers(id);
    await send(id);
    await rejects("update commerce.contract_events set kind = 'viewed' where contract_id = $1", [id], /append-only/);
    await rejects("delete from commerce.contract_events where contract_id = $1", [id], /append-only/);
    await db.query("begin");
    await db.query("select set_config('commerce.contract_erasure', 'on', true)");
    await db.query("delete from commerce.contracts where id = $1", [id]);
    await db.query("commit");
    const again = await contract(d.id);
    await signers(again);
    await send(again);
    await db.query("delete from commerce.deals where id = $1", [d.id]);
    expect(await one("select count(*)::int as n from commerce.contracts where deal_id = $1", [d.id])).toEqual({ n: 0 });
  });

  it("keeps a signed contract from erasure and from its deal's deletion, and lets only the retention job delete it (D695 step 3)", async () => {
    const d = await deal();
    const id = await contract(d.id);
    const s = await signers(id);
    await send(id);
    await sign(s.store);
    await sign(s.customer);
    expect(await statusOf(id)).toBe("signed");
    await db.query("begin");
    await db.query("select set_config('commerce.contract_erasure', 'on', true)");
    await expect(db.query("delete from commerce.contracts where id = $1", [id])).rejects.toThrow(/contracts.kept_signed/);
    await db.query("rollback");
    // The deal goes (a won deal deleted by staff, or the person's own deal by erasure): the signed contract stays, its deal set null.
    const draftToo = await contract(d.id);
    await db.query("delete from commerce.deals where id = $1", [d.id]);
    expect(await one("select deal_id, status from commerce.contracts where id = $1", [id])).toEqual({ deal_id: null, status: "signed" });
    expect(await one("select count(*)::int as n from commerce.contracts where id = $1", [draftToo])).toEqual({ n: 0 });
    expect(await eventsOf(id)).toEqual(["sent", "signed", "signed", "completed"]);
    await rejects("update commerce.contracts set deal_id = $2 where id = $1", [id, (await deal()).id], /contracts.moved/);
    await db.query("begin");
    await db.query("select set_config('commerce.contract_retention', 'on', true)");
    await db.query("delete from commerce.contracts where id = $1", [id]);
    await db.query("commit");
    expect(await one("select count(*)::int as n from commerce.contract_signers where contract_id = $1", [id])).toEqual({ n: 0 });
  });

  it("keeps a contract on a deal unless it is signed", async () => {
    await rejects(
      "insert into commerce.contracts (store_id, title, language) values ($1, 'No deal', 'nb')",
      [shop],
      /contracts_deal/,
    );
  });

  it("keeps an email code as a hash with at most five tries, gone with its signer", async () => {
    const id = await contract((await deal()).id);
    const s = await signers(id);
    await rejects(
      "insert into commerce.contract_codes (store_id, signer_id, code_hash, expires_at) values ($1, $2, '123456', now() + interval '10 minutes')",
      [shop, s.customer],
      /contract_codes_hash/,
    );
    const { id: code } = await one<{ id: string }>(
      "insert into commerce.contract_codes (store_id, signer_id, code_hash, expires_at) values ($1, $2, $3, now() + interval '10 minutes') returning id",
      [shop, s.customer, SHA],
    );
    await rejects("update commerce.contract_codes set attempts = 6 where id = $1", [code], /contract_codes_attempts/);
    await db.query("delete from commerce.contracts where id = $1", [id]);
    expect(await one("select count(*)::int as n from commerce.contract_codes where id = $1", [code])).toEqual({ n: 0 });
  });

  it("forgets the person when their customer row goes, and keeps the contract", async () => {
    const d = await deal();
    const id = await contract(d.id);
    await db.query("update commerce.deals set customer_id = null where id = $1", [d.id]);
    await db.query("delete from commerce.customers where id = $1", [d.customer]);
    expect(await one("select customer_id from commerce.contracts where id = $1", [id])).toEqual({ customer_id: null });
  });

  it("is in the registers: personal data, the store copy and the whole-store file", () => {
    for (const table of ["contract_templates", "contracts", "contract_signers", "contract_events", "contract_codes"]) expect(COPY_RULES[table], table).toBeDefined();
    expect(NOT_PERSONAL.contract_templates).toBeDefined();
    for (const table of ["contracts", "contract_signers", "contract_events"]) expect(PERSONAL_DATA.some((e) => e.table === table), table).toBe(true);
    expect(STORE_EXPORT_LEFT_OUT.contract_templates).toBeUndefined();
  });
});
