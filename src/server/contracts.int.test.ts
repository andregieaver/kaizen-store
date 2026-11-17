import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

const contracts = await import("./contracts");
const deals = await import("./deals");
const staff = await import("./customer-staff");
const { eraseSubject } = await import("./privacy-erasure");
const { newStore } = await import("./inventory-test-support");
const { storeOf } = await import("./product-data");
const { contractHtml } = await import("./document-html");

type TestStore = Awaited<ReturnType<typeof newStore>>;
type Row = Record<string, unknown>;

/**
 * Contracts for deals (D695, `docs/contracts.md`) through the server, against a real database. What is held: a store's first template is
 * made once in its language; a draft takes the template's blocks, the deal's owner as the store's signer and the deal's person as the
 * customer's; sending fills every field (a missing one stops it, naming it), draws and keeps the PDF once and freezes the snapshot with the
 * file's SHA-256, moves the deal to its contract stage, and is never done twice; a member who may not change customers changes nothing; the
 * store's signer must be a member; a new version cancels the sent one once sent; erasure takes the person's contracts and their files.
 */

let store: TestStore;

/** A storage that keeps files in memory, as the bucket does: a second upload to a path is refused. */
function memoryStorage() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async upload(path: string, bytes: Uint8Array) {
      if (files.has(path)) return false;
      files.set(path, bytes);
      return true;
    },
    async download(path: string) {
      return files.get(path) ?? null;
    },
    async remove(paths: string[]) {
      for (const p of paths) files.delete(p);
      return true;
    },
  };
}

const pdfOf = (html: string) => new TextEncoder().encode(`%PDF-test\n${html.length}\n${html}`);
let rendered: string[] = [];
const render = async (html: string) => {
  rendered.push(html);
  return pdfOf(html);
};

beforeAll(async () => {
  store = await newStore("contracts");
  await db().execute(sql`
    update commerce.stores set legal_name = 'Butikken AS', organisation_number = '999 888 777' where id = ${store.storeId}::uuid
  `);
  const fresh = await storeOf(store.storeId);
  if (fresh) store.member.store = fresh;
});

afterAll(async () => {
  await closeDb();
});

async function deal(s: TestStore, email = `k-${Math.random().toString(36).slice(2)}@example.com`): Promise<{ dealId: string; customerId: string; stages: string[] }> {
  const [pipeline] = await deals.ensurePipeline(s.storeId, { name: "Sales", stages: [{ name: "New" }, { name: "Talking" }, { name: "Contract sent" }] });
  await db().execute(sql`update commerce.deal_stages set contract_stage = (position = 2) where store_id = ${s.storeId}::uuid and pipeline_id = ${pipeline.id}::uuid`);
  const made = await staff.createCustomer(s.member, { email, name: "Kari Nordmann" });
  if (!made.ok) throw new Error(JSON.stringify(made.problem));
  const created = await deals.createDeal(s.member, { title: "Nettbutikk for Kunde AS", customerId: made.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id });
  if (!created.ok) throw new Error(created.problems.join(","));
  return { dealId: created.id, customerId: made.id, stages: pipeline.stages.map((st) => st.id) };
}

describe("a store's templates", () => {
  it("are made once on the first visit, however many ask at once, in the store's language", async () => {
    const fresh = await newStore("contracts-first");
    const [a, b] = await Promise.all([contracts.ensureTemplate(fresh.member.store, fresh.accountId), contracts.ensureTemplate(fresh.member.store, fresh.accountId)]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(1);
    expect(["nb", "en"]).toContain(a[0].language);
    expect(a[0].blocks.at(-1)).toEqual({ type: "signatures" });
  });
});

describe("a draft", () => {
  it("takes the template's blocks, the deal's owner as the store's signer and the deal's person as the customer's", async () => {
    const d = await deal(store, "kari.draft@example.com");
    const made = await contracts.createContract(store.member, d.dealId);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const c = await contracts.getContract(store.member, made.id);
    expect(c).toMatchObject({ status: "draft", title: "Nettbutikk for Kunde AS", dealId: d.dealId });
    expect(c?.signers.map((g) => [g.role, g.email, g.accountId])).toEqual([
      ["store", store.accountEmail.toLowerCase(), store.accountId],
      ["customer", "kari.draft@example.com", null],
    ]);
    expect(c?.blocks.length).toBeGreaterThan(3);
    expect(await contracts.contractsOfDeal(store.member, d.dealId)).toHaveLength(1);
  });

  it("changes its words and signers, the blocks checked and the store's signer a member", async () => {
    const d = await deal(store);
    const made = await contracts.createContract(store.member, d.dealId);
    if (!made.ok) throw new Error(made.problem);
    expect(await contracts.saveDraft(store.member, made.id, { title: "Avtale", blocks: [{ type: "paragraph", text: "{customer.shoe}" }] })).toMatchObject({
      ok: false,
      problem: "blocks",
    });
    expect(await contracts.saveDraft(store.member, made.id, { title: "  ", blocks: [] })).toEqual({ ok: false, problem: "title" });
    const outsider = await newStore("contracts-outsider");
    expect(
      await contracts.saveSigners(store.member, made.id, [
        { role: "store", name: "Not ours", email: outsider.accountEmail, accountId: outsider.accountId },
        { role: "customer", name: "Kari", email: "kari@example.com", accountId: null },
      ]),
    ).toEqual({ ok: false, problem: "signers" });
    expect(await contracts.saveSigners(store.member, made.id, [{ role: "customer", name: "Kari", email: "kari@example.com", accountId: null }])).toEqual({
      ok: false,
      problem: "signers",
    });
    expect(
      await contracts.saveSigners(store.member, made.id, [
        { role: "store", name: "Selger", email: store.accountEmail, accountId: store.accountId },
        { role: "customer", name: "Kari", email: "KARI@example.com", accountId: null },
        { role: "other", name: "Ola", email: "ola@example.com", accountId: null },
      ]),
    ).toEqual({ ok: true, id: made.id });
    expect((await contracts.getContract(store.member, made.id))?.signers.map((g) => g.email)).toEqual([store.accountEmail.toLowerCase(), "kari@example.com", "ola@example.com"]);
    expect(await contracts.deleteDraft(store.member, made.id)).toEqual({ ok: true, id: made.id });
  });

  it("is changed by nobody who may not change customers", async () => {
    const d = await deal(store);
    const reader = { ...store.member, role: "admin" as const, permissions: ["customers:read"] as never };
    expect(await contracts.createContract(reader, d.dealId)).toEqual({ ok: false, problem: "forbidden" });
    const made = await contracts.createContract(store.member, d.dealId);
    if (!made.ok) throw new Error(made.problem);
    expect(await contracts.sendContract(reader, made.id, { render, storage: memoryStorage() })).toEqual({ ok: false, problem: "forbidden" });
    expect(await contracts.getContract(reader, made.id)).not.toBeNull();
  });
});

describe("sending", () => {
  it("fills every field, keeps the PDF once with its SHA-256, freezes it and moves the deal to the contract stage", async () => {
    const d = await deal(store, "kari.send@example.com");
    const made = await contracts.createContract(store.member, d.dealId);
    if (!made.ok) throw new Error(made.problem);
    const storage = memoryStorage();
    rendered = [];
    const now = new Date("2026-11-16T12:00:00Z");
    expect(await contracts.sendContract(store.member, made.id, { now, render, storage })).toEqual({ ok: true, id: made.id });

    const path = contracts.contractPdfPath(store.storeId, made.id);
    const bytes = storage.files.get(path);
    expect(bytes).toBeDefined();
    const [row] = await db().execute<Row>(sql`select status, pdf_path, pdf_sha256, snapshot, expires_at from commerce.contracts where id = ${made.id}::uuid`);
    expect(row.status).toBe("sent");
    expect(row.pdf_path).toBe(path);
    expect(row.pdf_sha256).toBe(createHash("sha256").update(bytes!).digest("hex"));
    expect(new Date(String(row.expires_at)).getTime()).toBe(now.getTime() + 30 * 86_400_000);
    const snapshot = row.snapshot as { parties: { store: { name: string } }; blocks: { type: string; text?: string }[]; signers: unknown[] };
    expect(snapshot.parties.store.name).toBe("Butikken AS");
    expect(JSON.stringify(snapshot.blocks)).not.toMatch(/\{[a-z_]+\.[a-z_]+\}/);
    expect(JSON.stringify(snapshot.blocks)).toContain("Kari Nordmann");
    expect(JSON.stringify(snapshot.blocks)).toContain("999 888 777");
    expect(snapshot.signers).toHaveLength(2);
    // The PDF is drawn from the snapshot, every word escaped.
    expect(rendered[0]).toContain("Butikken AS");
    expect(rendered[0]).not.toContain("<script");

    const [moved] = await db().execute<Row>(sql`select stage_id from commerce.deals where id = ${d.dealId}::uuid`);
    expect(moved.stage_id).toBe(d.stages[2]);
    expect(await contracts.sendContract(store.member, made.id, { now, render, storage })).toEqual({ ok: false, problem: "not_draft" });
    expect(await contracts.contractPdf(store.member, made.id, storage)).toEqual(bytes);
    expect(await contracts.saveDraft(store.member, made.id, { title: "Changed", blocks: [] })).toEqual({ ok: false, problem: "not_draft" });
  });

  it("names a field with no value and sends nothing", async () => {
    const d = await deal(store);
    const made = await contracts.createContract(store.member, d.dealId);
    if (!made.ok) throw new Error(made.problem);
    await contracts.saveDraft(store.member, made.id, {
      title: "Avtale",
      blocks: [{ type: "paragraph", text: "Org.nr. {company.org_number}" }, { type: "signatures" }],
    });
    const storage = memoryStorage();
    expect(await contracts.sendContract(store.member, made.id, { render, storage })).toEqual({
      ok: false,
      problem: "unfilled",
      fill: [{ kind: "missing_field", key: "company.org_number" }],
    });
    expect(storage.files.size).toBe(0);
    expect((await contracts.getContract(store.member, made.id))?.status).toBe("draft");
  });

  it("sends nothing when the PDF cannot be made or kept, or the deal is closed", async () => {
    const d = await deal(store);
    const made = await contracts.createContract(store.member, d.dealId);
    if (!made.ok) throw new Error(made.problem);
    const failing = async () => {
      throw new Error("Chromium is not here");
    };
    expect(await contracts.sendContract(store.member, made.id, { render: failing, storage: memoryStorage() })).toEqual({ ok: false, problem: "pdf_failed" });
    expect(await contracts.sendContract(store.member, made.id, { render, storage: null })).toEqual({ ok: false, problem: "pdf_failed" });
    await deals.closeDeal(store.member, d.dealId, "lost", "Chose another");
    expect(await contracts.sendContract(store.member, made.id, { render, storage: memoryStorage() })).toEqual({ ok: false, problem: "deal_closed" });
  });

  it("makes a new version with the same words and signers, which cancels the sent one once it is sent", async () => {
    const d = await deal(store);
    const made = await contracts.createContract(store.member, d.dealId);
    if (!made.ok) throw new Error(made.problem);
    const storage = memoryStorage();
    await contracts.sendContract(store.member, made.id, { render, storage });
    const next = await contracts.newVersion(store.member, made.id);
    if (!next.ok) throw new Error(next.problem);
    expect((await contracts.getContract(store.member, next.id))?.signers).toHaveLength(2);
    expect(await contracts.sendContract(store.member, next.id, { render, storage })).toEqual({ ok: true, id: next.id });
    expect((await contracts.getContract(store.member, made.id))?.status).toBe("cancelled");
    expect(await contracts.cancelContract(store.member, next.id)).toEqual({ ok: true, id: next.id });
    expect(await contracts.cancelContract(store.member, next.id)).toEqual({ ok: false, problem: "not_draft" });
  });
});

describe("the document", () => {
  it("is plain HTML with every word escaped and nothing loaded from outside", () => {
    const html = contractHtml({
      version: 1,
      title: "Avtale <b>",
      language: "nb",
      parties: { store: { name: "Butikken AS", orgNumber: "999", address: null }, customer: { name: "<img src=x onerror=alert(1)>", orgNumber: null, address: null } },
      blocks: [{ type: "paragraph", text: "<script>alert(1)</script>" }, { type: "signatures" }],
      signers: [{ role: "store", name: "Selger" }, { role: "customer", name: "Kari" }],
    });
    expect(html).not.toMatch(/<(script|img|link|iframe)\b|\s(src|href)="/);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Signaturer");
  });
});

describe("erasure", () => {
  it("takes the person's contracts with their signers, events and files", async () => {
    const d = await deal(store, "kari.erase@example.com");
    const made = await contracts.createContract(store.member, d.dealId);
    if (!made.ok) throw new Error(made.problem);
    const storage = memoryStorage();
    await contracts.sendContract(store.member, made.id, { render, storage });
    expect(storage.files.size).toBe(1);
    expect(
      await eraseSubject(store.storeId, { customerId: d.customerId }, { channel: "staff", accountId: store.accountId }, { contractFiles: storage }),
    ).toMatchObject({ ok: true, outcome: "erased" });
    const [left] = await db().execute<Row>(sql`select count(*)::int as n from commerce.contracts where id = ${made.id}::uuid`);
    expect(left.n).toBe(0);
    expect(storage.files.size).toBe(0);
  }, 120_000);
});

describe("templates (step 2)", () => {
  it("are added with a name of their own, saved with their words checked, versioned by their words, and the last one stays", async () => {
    const fresh = await newStore("contracts-templates");
    const [first] = await contracts.ensureTemplate(fresh.member.store, fresh.accountId);
    const added = await contracts.createTemplate(fresh.member, "en");
    if (!added.ok) throw new Error(added.problem);
    const again = await contracts.createTemplate(fresh.member, "en");
    if (!again.ok) throw new Error(again.problem);
    const names = (await contracts.listTemplates(fresh.storeId)).map((t) => t.name);
    expect(names).toContain("Standard agreement 2");

    const t = (await contracts.getTemplate(fresh.member, added.id))!;
    const base = { name: t.name, language: "en", blocks: t.blocks, expiresDays: "14", reminderDays: "" };
    expect(await contracts.saveTemplate(fresh.member, added.id, { ...base, name: first.name })).toEqual({ ok: false, problem: "taken" });
    expect(await contracts.saveTemplate(fresh.member, added.id, { ...base, expiresDays: "0" })).toEqual({ ok: false, problem: "days" });
    expect(await contracts.saveTemplate(fresh.member, added.id, { ...base, blocks: [{ type: "paragraph", text: "{deal.secret}" }] })).toMatchObject({ ok: false, problem: "blocks" });
    expect(await contracts.saveTemplate(fresh.member, added.id, { ...base, reminderDays: "5" })).toEqual({ ok: true, id: added.id });
    expect((await contracts.getTemplate(fresh.member, added.id))).toMatchObject({ version: 1, expiresDays: 14, reminderDays: 5 });
    await contracts.saveTemplate(fresh.member, added.id, { ...base, reminderDays: "5", blocks: [...t.blocks, { type: "paragraph", text: "More words." }] });
    expect((await contracts.getTemplate(fresh.member, added.id))?.version).toBe(2);

    // A contract made from it takes its words and its reminder days.
    const [pipeline] = await deals.ensurePipeline(fresh.storeId, { name: "Sales", stages: [{ name: "New" }] });
    const customer = await staff.createCustomer(fresh.member, { email: "tpl@example.com", name: "Tia" });
    if (!customer.ok) throw new Error("customer");
    const deal = await deals.createDeal(fresh.member, { title: "Templated", customerId: customer.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id });
    if (!deal.ok) throw new Error("deal");
    const made = await contracts.createContract(fresh.member, deal.id, added.id);
    if (!made.ok) throw new Error(made.problem);
    const [row] = await db().execute<Row>(sql`select language, reminder_days, template_version from commerce.contracts where id = ${made.id}::uuid`);
    expect(row).toEqual({ language: "en", reminder_days: 5, template_version: 2 });

    expect(await contracts.archiveTemplate(fresh.member, again.id)).toEqual({ ok: true, id: again.id });
    expect(await contracts.archiveTemplate(fresh.member, added.id)).toEqual({ ok: true, id: added.id });
    expect(await contracts.archiveTemplate(fresh.member, first.id)).toEqual({ ok: false, problem: "last" });
    const reader = { ...fresh.member, role: "admin" as const, permissions: ["customers:read"] as never };
    expect(await contracts.createTemplate(reader, "nb")).toEqual({ ok: false, problem: "forbidden" });
  });
});
