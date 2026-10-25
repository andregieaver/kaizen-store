import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { makeWorkStore, type WorkTestStore } from "./work-test-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const work = await import("./work");
const ownerTools = await import("./owner-tools");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

/**
 * The AI manager's Work tools (PSI AGT-01): refused while Work is off; the overview and lists read Work's own figures; time is logged in the person's
 * name through `logTime()`; a draft is issued through `issueInvoice()` only when it is ready, checked before the owner is asked.
 */

let w: WorkTestStore;
const ctx = async () => ({ account: w.owner.account, store: (await getStore(w.owner.store.slug))!, invalidate: () => {} });
const run = async (name: string, args: unknown) => ownerTools.runOwnerTool(await ctx(), name, args);

beforeAll(async () => {
  w = await makeWorkStore("work-tools", getStore);
  const client = await work.createClient(w.owner, {
    name: "Fjord AS",
    legalName: "Fjord AS",
    country: "NO",
    billingAddress: { line1: "Gata 1", line2: "", postalCode: "0150", city: "Oslo" },
    currency: "NOK",
    defaultHourlyRateMinor: 100000,
    billingEmail: "faktura@fjord.example",
  });
  if (!client.ok) throw new Error(client.problems.join(" "));
  const job = await work.createAssignment(w.owner, { clientId: client.id, name: "Nettside" });
  if (!job.ok) throw new Error(job.problems.join(" "));
});
afterAll(async () => closeDb());

describe("the Work tools", () => {
  it("logs time on an assignment by name and shows it unbilled", async () => {
    expect(await run("log_time", { assignment: "Nettside", minutes: 90, note: "Design" })).toMatchObject({ done: expect.stringContaining("Logged 1 h 30 min on Fjord AS: Nettside") });
    const overview = (await run("work_overview", {})) as { unbilled_by_client: { client: string; time: string }[] };
    expect(overview.unbilled_by_client).toEqual([expect.objectContaining({ client: "Fjord AS", time: "1 h 30 min" })]);
    expect(await run("list_work_clients", {})).toMatchObject({ clients: [expect.objectContaining({ name: "Fjord AS", unbilled: "1 h 30 min" })] });
    await expect(run("log_time", { assignment: "Nothing", minutes: 30 })).rejects.toThrow(/No open assignment/);
  });

  it("refuses a draft that is not ready before the owner is asked", async () => {
    const [client] = await db().execute<Row>(sql`select id from commerce.work_clients where store_id = ${w.owner.store.id}::uuid`);
    await db().execute(sql`insert into commerce.work_invoices (store_id, client_id, currency) values (${w.owner.store.id}::uuid, ${String(client.id)}::uuid, 'NOK')`);
    const listed = (await run("list_work_assignments", {})) as { draft_invoices: { id: string; client: string }[] };
    expect(listed.draft_invoices).toEqual([expect.objectContaining({ client: "Fjord AS" })]);
    // The store has no legal details or bank account yet, and the draft no lines: Work refuses to issue it.
    await expect(ownerTools.preflightOwnerTool(await ctx(), "issue_work_invoice", { invoice: "Fjord AS", email: true })).rejects.toThrow(ownerTools.OwnerToolError);
  });

  it("issues a ready draft through Work's own issue, never emailed when told so", async () => {
    await db().execute(sql`
      update commerce.stores set legal_name = 'Seller AS', organisation_number = '999888777', postal_address = 'Veien 2, 0150 Oslo', country = 'NO'
      where id = ${w.owner.store.id}::uuid
    `);
    await db().execute(sql`
      insert into commerce.work_settings (store_id, vat_registered, bank_account) values (${w.owner.store.id}::uuid, false, 'NO9386011117947')
      on conflict (store_id) do update set vat_registered = false, bank_account = 'NO9386011117947'
    `);
    const [draft] = await db().execute<Row>(sql`select id from commerce.work_invoices where store_id = ${w.owner.store.id}::uuid and status = 'draft'`);
    await db().execute(sql`
      insert into commerce.work_invoice_lines (store_id, invoice_id, description, quantity_hundredths, unit_price_minor)
      values (${w.owner.store.id}::uuid, ${String(draft.id)}::uuid, 'Consulting', 100, 100000)
    `);
    await ownerTools.preflightOwnerTool(await ctx(), "issue_work_invoice", { invoice: String(draft.id), email: false });
    const done = (await run("issue_work_invoice", { invoice: String(draft.id), email: false })) as { done: string };
    expect(done.done).toMatch(/^Invoice \S+ to Fjord AS for .+ is issued\.$/);
    const [row] = await db().execute<Row>(sql`select status from commerce.work_invoices where id = ${String(draft.id)}::uuid`);
    expect(row.status).toBe("sent");
  });

  it("is refused while Work is off", async () => {
    await db().execute(sql`update commerce.stores set modules = array_remove(modules, 'work') where id = ${w.owner.store.id}::uuid`);
    await expect(run("work_overview", {})).rejects.toThrow(/Work is not switched on/);
    await db().execute(sql`update commerce.stores set modules = array_append(modules, 'work') where id = ${w.owner.store.id}::uuid`);
  });
});
