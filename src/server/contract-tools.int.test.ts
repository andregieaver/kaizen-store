import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));
const mailed: { kind: string; to: string }[] = [];
vi.mock("./email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email")>()),
  sendEmail: async (message: { kind: string; to: string }) => {
    mailed.push({ kind: message.kind, to: message.to });
    return "sent";
  },
}));

const tools = await import("./contract-tools");
const contracts = await import("./contracts");
const deals = await import("./deals");
const staff = await import("./customer-staff");
const { signAsStore } = await import("./contract-signing");
const { newStore } = await import("./inventory-test-support");
const { storeOf } = await import("./product-data");
const { approvalSummary } = await import("@/lib/owner-tools");

type TestStore = Awaited<ReturnType<typeof newStore>>;

/**
 * The AI manager's contract tools (D695 step 4) against a real database: a deal is found by its title or a part of it, and several that
 * match are named; a draft is made from the template named, on an open deal only, and says what stops it being sent; nothing is sent by a
 * draft; a reminder goes to the signer whose turn it is, only on a contract out for signing and at most once a day, its card naming the
 * contract and the signer as they are.
 */

let store: TestStore;
let ctx: { account: TestStore["member"]["account"]; store: TestStore["member"]["store"] };
const storage = { files: new Map<string, Uint8Array>(), async upload(p: string, b: Uint8Array) { this.files.set(p, b); return true; }, async download(p: string) { return this.files.get(p) ?? null; }, async remove() { return true; } };
const render = async (html: string) => new TextEncoder().encode(`%PDF-test\n${html}`);

beforeAll(async () => {
  store = await newStore("contract-tools");
  await db().execute(sql`update commerce.stores set legal_name = 'Butikken AS', organisation_number = '999 888 777' where id = ${store.storeId}::uuid`);
  const fresh = await storeOf(store.storeId);
  if (fresh) store.member.store = fresh;
  ctx = { account: store.member.account, store: store.member.store };
});

afterAll(async () => {
  await closeDb();
});

async function deal(title: string, email: string | null = `k-${Math.random().toString(36).slice(2)}@example.com`) {
  const [pipeline] = await deals.ensurePipeline(store.storeId, { name: "Sales", stages: [{ name: "New" }, { name: "Contract sent" }] });
  const customer = email ? await staff.createCustomer(store.member, { email, name: "Kari Nordmann" }) : null;
  if (customer && !customer.ok) throw new Error(JSON.stringify(customer.problem));
  const created = await deals.createDeal(store.member, { title, customerId: customer?.ok ? customer.id : null, pipelineId: pipeline.id, stageId: pipeline.stages[0].id });
  if (!created.ok) throw new Error(created.problems.join(","));
  return created.id;
}

describe("the AI manager's contract tools", () => {
  it("draft a contract on a deal named by a part of its title, and send nothing", async () => {
    const dealId = await deal("Nettbutikk for Fjord AS");
    const drafted = (await tools.draftContractTool(ctx, { deal: "fjord" })) as { done: string; contract: { id: string; page: string; signers: { role: string }[] }; next: string };
    expect(drafted.done).toContain("Nothing has been sent");
    expect(drafted.contract.page).toBe(`/admin/${store.member.store.slug}/deals/${dealId}/contracts/${drafted.contract.id}`);
    expect(drafted.contract.signers.map((g) => g.role)).toEqual(["store", "customer"]);
    expect(drafted.next).toContain("Send for signing");
    const [row] = await db().execute<{ status: string; deal_id: string }>(sql`select status, deal_id from commerce.contracts where id = ${drafted.contract.id}::uuid`);
    expect(row).toMatchObject({ status: "draft", deal_id: dealId });
    expect(mailed).toEqual([]);

    const listed = (await tools.listContractsTool(ctx, { deal: "Nettbutikk for Fjord AS", status: "open" })) as { deal: { id: string }; contracts: { id: string; status: string; signers: { state: string }[] }[]; templates: { name: string }[] };
    expect(listed.deal.id).toBe(dealId);
    expect(listed.contracts).toEqual([expect.objectContaining({ id: drafted.contract.id, status: expect.stringContaining("draft") })]);
    expect(listed.contracts[0].signers.every((g) => g.state === "not sent yet")).toBe(true);
    expect(listed.templates.length).toBeGreaterThan(0);
    // No signer's email in the answer.
    expect(JSON.stringify(listed)).not.toContain("@example.com");
  });

  it("names the deals when several match, refuses a closed deal and a template the store does not have", async () => {
    await deal("Lager Nord");
    await deal("Lager Sør");
    await expect(tools.draftContractTool(ctx, { deal: "lager" })).rejects.toThrow('Several deals have "lager"');
    await expect(tools.draftContractTool(ctx, { deal: "Ingen slik avtale" })).rejects.toThrow("No deal");
    await expect(tools.draftContractTool(ctx, { deal: "Lager Nord", template: "Finnes ikke" })).rejects.toThrow('No template "Finnes ikke"');
    const lost = await deal("Tapt avtale");
    expect(await deals.closeDeal(store.member, lost, "lost")).toMatchObject({ ok: true });
    await expect(tools.draftContractTool(ctx, { deal: "Tapt avtale" })).rejects.toThrow("is lost");
  });

  it("says what stops a draft being sent", async () => {
    // A store without its legal name and organisation number: the contract's words name them.
    const bare = await newStore("contract-tools-bare");
    const bareCtx = { account: bare.member.account, store: bare.member.store };
    const [pipeline] = await deals.ensurePipeline(bare.storeId, { name: "Sales", stages: [{ name: "New" }] });
    const customer = await staff.createCustomer(bare.member, { email: "bare@example.com", name: "Per" });
    if (!customer.ok) throw new Error("customer");
    const created = await deals.createDeal(bare.member, { title: "Uten firmanavn", customerId: customer.id, pipelineId: pipeline.id, stageId: pipeline.stages[0].id });
    if (!created.ok) throw new Error("deal");
    const drafted = (await tools.draftContractTool(bareCtx, { deal: "Uten firmanavn" })) as { stops_sending?: string[]; ready?: string };
    expect(drafted.ready).toBeUndefined();
    expect(drafted.stops_sending?.join(" ")).toMatch(/\{store\.[a-z_]+\} has no value/);
  });

  it("reminds the signer whose turn it is, only out for signing and once a day", async () => {
    const dealId = await deal("Avtale med påminnelse", "signer@example.com");
    const made = await contracts.createContract(store.member, dealId);
    if (!made.ok) throw new Error(made.problem);
    await expect(tools.preflightRemindSigner(ctx, { contract: made.id })).rejects.toThrow("is not out for signing");
    // The store's signer signs first; here the customer's turn has come.
    const sent = await contracts.sendContract(store.member, made.id, { render, storage });
    expect(sent.ok).toBe(true);
    const signed = await signAsStore(store.member, made.id, { name: "Eier", agree: true }, { ip: null, userAgent: null });
    expect(signed).toMatchObject({ ok: true, completed: false });
    // Signing asked the customer's signer at once: two days on, they are reminded.
    expect(mailed).toEqual([{ kind: "contract.to_sign", to: "signer@example.com" }]);
    await expect(tools.preflightRemindSigner(ctx, { contract: made.id })).rejects.toThrow("at most once a day");
    mailed.length = 0;
    await db().execute(sql`update commerce.contract_signers set notified_at = now() - interval '2 days' where store_id = ${store.storeId}::uuid and contract_id = ${made.id}::uuid and role = 'customer'`);

    expect(approvalSummary("remind_contract_signer", { contract: made.id })).toContain("a reminder to sign");
    expect(await tools.remindApprovalWords(ctx, { contract: made.id })).toBe(
      'Email Kari Nordmann a reminder to sign "Avtale med påminnelse", with their link to the signing page.',
    );
    const done = (await tools.remindContractSignerTool(ctx, { contract: made.id })) as { done: string };
    expect(done.done).toContain("Kari Nordmann is emailed a reminder");
    expect(mailed).toEqual([{ kind: "contract.reminder", to: "signer@example.com" }]);
    const [signer] = await db().execute<{ reminders: number }>(sql`select reminders from commerce.contract_signers where contract_id = ${made.id}::uuid and role = 'customer'`);
    expect(signer.reminders).toBe(1);
    await expect(tools.preflightRemindSigner(ctx, { contract: made.id })).rejects.toThrow("at most once a day");

    const listed = (await tools.listContractsTool(ctx, { deal: dealId, status: "sent" })) as { contracts: { signers: { state: string }[]; sign_by?: string }[] };
    expect(listed.contracts[0].signers.map((g) => g.state)).toEqual([expect.stringContaining("signed"), expect.stringContaining("their turn: asked")]);
    expect(listed.contracts[0].sign_by).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
