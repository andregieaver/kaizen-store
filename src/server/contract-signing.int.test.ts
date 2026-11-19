import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

const contracts = await import("./contracts");
const signing = await import("./contract-signing");
const deals = await import("./deals");
const staff = await import("./customer-staff");
const { eraseSubject } = await import("./privacy-erasure");
const { newStore } = await import("./inventory-test-support");
const { storeOf } = await import("./product-data");
const jobs = await import("./contract-jobs");
const { readTimeline } = await import("./customer-timeline");
const { PDFDocument } = await import("pdf-lib");

type TestStore = Awaited<ReturnType<typeof newStore>>;
type Row = Record<string, unknown>;
type Sent = Parameters<NonNullable<import("./contract-signing").SigningDeps["mail"]>>[0];

/**
 * Signing a contract (D695 step 3) through the server, against a real database: sending asks the first signer (the store's, in the admin,
 * not emailed when they sent it themselves); the customer is asked once the store has signed, by an email with their own link, never kept
 * in the log; a code proves their email (wrong, expired, too many tries, too many codes); signing with it signs the contract and wins the
 * deal; a decline tells the store; a signed contract outlives erasure.
 */

let store: TestStore;
const at = { ip: "203.0.113.7", userAgent: "Vitest" };
const memoryStorage = () => {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    upload: async (p: string, b: Uint8Array) => (files.has(p) ? false : (files.set(p, b), true)),
    download: async (p: string) => files.get(p) ?? null,
    remove: async (ps: string[]) => (ps.forEach((p) => files.delete(p)), true),
  };
};
/** A real one-page PDF, as Chromium would print (the signed PDF is made of real pages). */
const render = async (html: string) => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]).drawText(`page ${html.length}`, { x: 40, y: 800, size: 10 });
  return doc.save();
};

function mailbox() {
  const sent: Sent[] = [];
  return { sent, mail: async (m: Sent) => (sent.push(m), "sent" as const) };
}

beforeAll(async () => {
  // The seal's key is kept encrypted with the settings key (a test key here).
  process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  store = await newStore("signing");
  await db().execute(sql`update commerce.stores set legal_name = 'Butikken AS', organisation_number = '999 888 777' where id = ${store.storeId}::uuid`);
  const fresh = await storeOf(store.storeId);
  if (fresh) store.member.store = fresh;
});

afterAll(async () => {
  await closeDb();
});

async function sentContract(email: string, box = mailbox()) {
  const [pipeline] = await deals.ensurePipeline(store.storeId, { name: "Sales", stages: [{ name: "New" }, { name: "Contract sent" }] });
  const customer = await staff.createCustomer(store.member, { email, name: "Kari Nordmann" });
  if (!customer.ok) throw new Error("customer");
  const deal = await deals.createDeal(store.member, { title: "Nettbutikk", customerId: customer.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id });
  if (!deal.ok) throw new Error("deal");
  const made = await contracts.createContract(store.member, deal.id);
  if (!made.ok) throw new Error(made.problem);
  const storage = memoryStorage();
  const sent = await signing.sendForSigning(store.member, made.id, { render, storage, mail: box.mail });
  if (!sent.ok) throw new Error(JSON.stringify(sent));
  const signers = await db().execute<Row>(sql`select id, role, token from commerce.contract_signers where contract_id = ${made.id}::uuid order by position`);
  return { contractId: made.id, dealId: deal.id, customerId: customer.id, box, storage, storeSigner: signers[0], customerSigner: signers[1], customerToken: String(signers[1].token) };
}

describe("asking the signers", () => {
  it("does not email the store's signer who sent it, and asks the customer only once the store has signed", async () => {
    const c = await sentContract("kari.ask@example.com");
    expect(c.box.sent).toHaveLength(0);
    const view = await signing.signerByToken(c.customerToken);
    expect(view).toMatchObject({ role: "customer", turn: false, open: false, emailMasked: "k***@example.com" });
    expect(await signing.requestCode(c.customerToken, at, { mail: c.box.mail })).toEqual({ ok: false, problem: "not_turn" });

    expect(await signing.signAsStore(store.member, c.contractId, { name: "  ", agree: true }, at)).toEqual({ ok: false, problem: "name" });
    expect(await signing.signAsStore(store.member, c.contractId, { name: "Eva Eier", agree: false }, at)).toEqual({ ok: false, problem: "agree" });
    expect(await signing.signAsStore(store.member, c.contractId, { name: "Eva Eier", agree: true }, at, { mail: c.box.mail })).toEqual({ ok: true, completed: false });
    expect(c.box.sent.map((m) => [m.kind, m.to])).toEqual([["contract.to_sign", "kari.ask@example.com"]]);
    const link = c.box.sent[0].email.html;
    expect(link).toContain(`/sign/${c.customerToken}`);
    // The link is the signer's whole access: the log's copy never holds it.
    expect(c.box.sent[0].secrets).toContain(c.customerToken);
    expect(await signing.signerByToken(c.customerToken)).toMatchObject({ turn: true, open: true });
    expect(await signing.signAsStore(store.member, c.contractId, { name: "Eva Eier", agree: true }, at)).toEqual({ ok: false, problem: "closed" });
  });
});

describe("signing with a code", () => {
  it("checks the code, signs against the sent PDF, signs the contract and wins the deal", async () => {
    const c = await sentContract("kari.sign@example.com");
    await signing.signAsStore(store.member, c.contractId, { name: "Eva Eier", agree: true }, at, { mail: c.box.mail });
    await signing.markViewed(c.customerToken, at);
    expect(await signing.signWithCode(c.customerToken, { code: "111111", name: "Kari Nordmann", agree: true }, at)).toEqual({ ok: false, problem: "code_expired" });
    expect(await signing.requestCode(c.customerToken, at, { mail: c.box.mail, code: () => "246810" })).toEqual({ ok: true });
    const codeMail = c.box.sent.find((m) => m.kind === "contract.code");
    expect(codeMail?.email.html).toContain("246810");
    expect(codeMail?.secrets).toEqual(["246810"]);
    expect(await signing.signWithCode(c.customerToken, { code: "246810", name: "K", agree: true }, at)).toEqual({ ok: false, problem: "name" });
    expect(await signing.signWithCode(c.customerToken, { code: "000000", name: "Kari Nordmann", agree: true }, at)).toEqual({ ok: false, problem: "code" });
    expect(await signing.signWithCode(c.customerToken, { code: "246 810", name: "Kari  Nordmann", agree: true }, at)).toEqual({ ok: true, completed: true });

    const [row] = await db().execute<Row>(sql`
      select c.status, c.pdf_sha256, g.document_sha256, g.signed_name, g.evidence->>'method' as method, d.status as deal_status, d.closed_via
      from commerce.contracts c join commerce.contract_signers g on g.contract_id = c.id and g.role = 'customer' join commerce.deals d on d.id = c.deal_id
      where c.id = ${c.contractId}::uuid`);
    expect(row).toMatchObject({ status: "signed", signed_name: "Kari Nordmann", method: "email_code", deal_status: "won", closed_via: "contract" });
    expect(row.document_sha256).toBe(row.pdf_sha256);
    const kinds = (await db().execute<Row>(sql`select kind from commerce.contract_events where contract_id = ${c.contractId}::uuid order by id`)).map((r) => r.kind);
    expect(kinds).toEqual(["sent", "signed", "viewed", "code_sent", "code_checked", "signed", "completed"]);
    expect(await signing.signWithCode(c.customerToken, { code: "246810", name: "Kari Nordmann", agree: true }, at)).toEqual({ ok: false, problem: "closed" });
  });

  it("refuses a code after five wrong tries or ten minutes, and a sixth code within the hour", async () => {
    const c = await sentContract("kari.codes@example.com");
    await signing.signAsStore(store.member, c.contractId, { name: "Eva Eier", agree: true }, at, { mail: c.box.mail });
    await signing.requestCode(c.customerToken, at, { mail: c.box.mail, code: () => "135790" });
    for (let i = 0; i < 4; i += 1) await signing.signWithCode(c.customerToken, { code: "000000", name: "Kari Nordmann", agree: true }, at);
    expect(await signing.signWithCode(c.customerToken, { code: "000000", name: "Kari Nordmann", agree: true }, at)).toEqual({ ok: false, problem: "too_many_tries" });
    expect(await signing.signWithCode(c.customerToken, { code: "135790", name: "Kari Nordmann", agree: true }, at)).toEqual({ ok: false, problem: "too_many_tries" });
    await signing.requestCode(c.customerToken, at, { mail: c.box.mail, code: () => "975310" });
    const later = new Date(Date.now() + 11 * 60_000);
    expect(await signing.signWithCode(c.customerToken, { code: "975310", name: "Kari Nordmann", agree: true }, at, { now: later })).toEqual({ ok: false, problem: "code_expired" });
    for (let i = 0; i < 3; i += 1) await signing.requestCode(c.customerToken, at, { mail: c.box.mail });
    expect(await signing.requestCode(c.customerToken, at, { mail: c.box.mail })).toEqual({ ok: false, problem: "too_many" });
  });
});

describe("declining and keeping", () => {
  it("declines with a reason and tells the store, and the deal stays open", async () => {
    const c = await sentContract("kari.decline@example.com");
    await signing.signAsStore(store.member, c.contractId, { name: "Eva Eier", agree: true }, at, { mail: c.box.mail });
    expect(await signing.declineAsSigner(c.customerToken, "x".repeat(501), at)).toEqual({ ok: false, problem: "reason" });
    expect(await signing.declineAsSigner(c.customerToken, "Too expensive", at, { mail: c.box.mail })).toEqual({ ok: true });
    expect((await contracts.getContract(store.member, c.contractId))?.status).toBe("declined");
    expect(c.box.sent.filter((m) => m.kind === "contract.declined").map((m) => m.to)).toEqual([store.accountEmail.toLowerCase()]);
    const [deal] = await db().execute<Row>(sql`select status from commerce.deals where id = ${c.dealId}::uuid`);
    expect(deal.status).toBe("open");
  });

  it("keeps a signed contract when the person it is with is erased, cut loose from the account", async () => {
    const c = await sentContract("kari.keep@example.com");
    await signing.signAsStore(store.member, c.contractId, { name: "Eva Eier", agree: true }, at, { mail: c.box.mail });
    await signing.requestCode(c.customerToken, at, { mail: c.box.mail, code: () => "112233" });
    await signing.signWithCode(c.customerToken, { code: "112233", name: "Kari Nordmann", agree: true }, at);
    expect(await eraseSubject(store.storeId, { customerId: c.customerId }, { channel: "staff", accountId: store.accountId }, { contractFiles: memoryStorage() })).toMatchObject({
      ok: true,
      outcome: "erased",
    });
    const [kept] = await db().execute<Row>(sql`select status, customer_id from commerce.contracts where id = ${c.contractId}::uuid`);
    expect(kept).toEqual({ status: "signed", customer_id: null });
  }, 120_000);
});

describe("the job", () => {
  async function signedContract(email: string) {
    const c = await sentContract(email);
    await signing.signAsStore(store.member, c.contractId, { name: "Eva Eier", agree: true }, at, { mail: c.box.mail });
    await signing.requestCode(c.customerToken, at, { mail: c.box.mail, code: () => "445566" });
    await signing.signWithCode(c.customerToken, { code: "445566", name: "Kari Nordmann", agree: true }, at);
    return c;
  }

  it("makes the signed PDF once: the sent pages and the signing record, sealed, kept, and sent to every signer", async () => {
    const c = await signedContract("kari.job@example.com");
    const box = mailbox();
    expect(await jobs.buildSignedPdf(store.storeId, c.contractId, { render, storage: c.storage, mail: box.mail })).toBe(true);
    const path = `${store.storeId}/contracts/${c.contractId}-signed.pdf`;
    const pdf = c.storage.files.get(path);
    expect(pdf).toBeDefined();
    expect(Buffer.from(pdf!).toString("latin1")).toMatch(/\/ByteRange\s*\[/);
    expect((await PDFDocument.load(pdf!)).getPageCount()).toBe(2);
    const [row] = await db().execute<Row>(sql`select signed_pdf_path, signed_pdf_sha256 from commerce.contracts where id = ${c.contractId}::uuid`);
    expect(row.signed_pdf_path).toBe(path);
    expect(box.sent.map((m) => [m.kind, m.to, m.attachments?.[0]?.contentType])).toEqual([
      ["contract.signed", store.accountEmail.toLowerCase(), "application/pdf"],
      ["contract.signed", "kari.job@example.com", "application/pdf"],
    ]);
    expect(await jobs.buildSignedPdf(store.storeId, c.contractId, { render, storage: c.storage, mail: box.mail })).toBe(false);
  }, 60_000);

  it("counts a failure and tries again later, never with a sent PDF that is not the one signed", async () => {
    const c = await signedContract("kari.fail@example.com");
    c.storage.files.set(`${store.storeId}/contracts/${c.contractId}.pdf`, new Uint8Array([1, 2, 3]));
    expect(await jobs.buildSignedPdf(store.storeId, c.contractId, { render, storage: c.storage, mail: mailbox().mail })).toBe(false);
    const [row] = await db().execute<Row>(sql`select signed_pdf_path, signed_pdf_attempts from commerce.contracts where id = ${c.contractId}::uuid`);
    expect(row).toEqual({ signed_pdf_path: null, signed_pdf_attempts: 1 });
  });

  it("expires a contract whose time has passed, reminds a waiting signer, and deletes a signed one past its period with its files", async () => {
    const waiting = await sentContract("kari.wait@example.com");
    await signing.signAsStore(store.member, waiting.contractId, { name: "Eva Eier", agree: true }, at, { mail: waiting.box.mail });
    await db().execute(sql`update commerce.contract_signers set notified_at = now() - interval '4 days' where contract_id = ${waiting.contractId}::uuid and role = 'customer'`);
    const box = mailbox();
    const first = await jobs.contractJob({ render, storage: waiting.storage, mail: box.mail });
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    expect(box.sent.some((m) => m.kind === "contract.reminder" && m.to === "kari.wait@example.com")).toBe(true);

    // Its time passes (the database checks the time against its own clock, as the job does in production).
    await db().execute(sql`alter table commerce.contracts disable trigger contracts_guard`);
    await db().execute(sql`update commerce.contracts set expires_at = now() - interval '1 minute' where id = ${waiting.contractId}::uuid`);
    await db().execute(sql`alter table commerce.contracts enable trigger contracts_guard`);
    const second = await jobs.contractJob({ render, storage: waiting.storage, mail: box.mail });
    expect(second.expired).toBeGreaterThanOrEqual(1);
    expect((await contracts.getContract(store.member, waiting.contractId))?.status).toBe("expired");

    const old = await signedContract("kari.old@example.com");
    await db().execute(sql`update commerce.contracts set completed_at = now() - interval '55 months' where id = ${old.contractId}::uuid`);
    expect(await (await import("./contract-upkeep")).pruneContracts(new Date(), old.storage)).toBeGreaterThanOrEqual(1);
    const [left] = await db().execute<Row>(sql`select count(*)::int as n from commerce.contracts where id = ${old.contractId}::uuid`);
    expect(left.n).toBe(0);
    expect(old.storage.files.has(`${store.storeId}/contracts/${old.contractId}.pdf`)).toBe(false);
  }, 60_000);

  it("(D795) asks the PDF route only while a signed contract waits for its seal, and the route's run seals it", async () => {
    const upkeep = await import("./contract-upkeep");
    const asked: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      asked.push(String(url));
      return new Response("{}", { status: 200 });
    });
    const secret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-secret";
    try {
      // Other tests' contracts may wait too: seal them first, so the run sees only what this test leaves.
      while ((await jobs.signedPdfJob({ render, storage: memoryStorage() })) > 0) {}
      await db().execute(sql`update commerce.contracts set signed_pdf_attempts = 5 where status = 'signed' and signed_pdf_path is null`);
      expect((await upkeep.runContractUpkeep()).sealAsked).toBe(false);
      expect(asked).toEqual([]);

      const c = await signedContract("kari.dispatch@example.com");
      await db().execute(sql`update commerce.contracts set signed_pdf_path = null, signed_pdf_attempts = 0 where id = ${c.contractId}::uuid and signed_pdf_path is null`);
      const run = await upkeep.runContractUpkeep();
      expect(run.sealAsked).toBe(true);
      expect(asked).toEqual([expect.stringMatching(/\/api\/cron\/document-pdfs$/)]);
      // What the route then does: the seal is made once.
      expect(await jobs.signedPdfJob({ render, storage: c.storage })).toBeGreaterThanOrEqual(1);
      const [row] = await db().execute<Row>(sql`select signed_pdf_path is not null as sealed from commerce.contracts where id = ${c.contractId}::uuid`);
      expect(row.sealed).toBe(true);
    } finally {
      fetchSpy.mockRestore();
      if (secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secret;
    }
  }, 60_000);
});

describe("the deal and the timeline (step 4)", () => {
  it("keeps the contract stage Lisa marks, moves the deal there when sent, and shows the contract on the person's timeline", async () => {
    const fresh = await newStore("signing-stage");
    await db().execute(sql`update commerce.stores set legal_name = 'Butikken AS', organisation_number = '999 888 777' where id = ${fresh.storeId}::uuid`);
    const s = await storeOf(fresh.storeId);
    if (s) fresh.member.store = s;
    const [pipeline] = await deals.ensurePipeline(fresh.storeId, { name: "Sales", stages: [{ name: "New" }, { name: "Talking" }, { name: "Quote sent", quoteStage: true }] });
    const stages = pipeline.stages.map((st) => ({ id: st.id, name: st.name, probability: null, quoteStage: st.quoteStage, contractStage: false }));
    // Two marked: refused; one: kept.
    expect(await deals.saveStages(fresh.member, pipeline.id, stages.map((st) => ({ ...st, contractStage: true })))).toMatchObject({ ok: false });
    const saved = await deals.saveStages(fresh.member, pipeline.id, [...stages, { id: null, name: "Contract sent", probability: 80, quoteStage: false, contractStage: true }]);
    expect(saved).toMatchObject({ ok: true });
    const [again] = await deals.pipelinesOf(fresh.storeId);
    const contractStage = again.stages.find((st) => st.contractStage);
    expect(contractStage?.name).toBe("Contract sent");

    const customer = await staff.createCustomer(fresh.member, { email: "kari.stage@example.com", name: "Kari Nordmann" });
    if (!customer.ok) throw new Error("customer");
    const deal = await deals.createDeal(fresh.member, { title: "Butikk", customerId: customer.id, pipelineId: again.id, stageId: again.stages[0].id });
    if (!deal.ok) throw new Error("deal");
    const made = await contracts.createContract(fresh.member, deal.id);
    if (!made.ok) throw new Error(made.problem);
    const box = mailbox();
    expect(await signing.sendForSigning(fresh.member, made.id, { render, storage: memoryStorage(), mail: box.mail })).toEqual({ ok: true, id: made.id });
    const [moved] = await db().execute<Row>(sql`select stage_id from commerce.deals where id = ${deal.id}::uuid`);
    expect(moved.stage_id).toBe(contractStage?.id);

    const selling = { ...fresh.member, store: { ...fresh.member.store, features: [...fresh.member.store.features, "sales" as const] } };
    const who = { kind: "person" as const, email: "kari.stage@example.com", customerId: customer.id };
    expect((await readTimeline(selling, who)).events.find((e) => e.what === "contract_sent")).toMatchObject({
      label: "Butikk",
      href: `/admin/${fresh.slug}/deals/${deal.id}/contracts/${made.id}`,
    });
    await signing.signAsStore(fresh.member, made.id, { name: "Eva Eier", agree: true }, at, { mail: box.mail });
    const [signer] = await db().execute<Row>(sql`select token from commerce.contract_signers where contract_id = ${made.id}::uuid and role = 'customer'`);
    await signing.requestCode(String(signer.token), at, { mail: box.mail, code: () => "778899" });
    await signing.signWithCode(String(signer.token), { code: "778899", name: "Kari Nordmann", agree: true }, at);
    expect((await readTimeline(selling, who)).events.map((e) => e.what)).toEqual(expect.arrayContaining(["contract_sent", "contract_signed", "deal_won"]));
  });
});
