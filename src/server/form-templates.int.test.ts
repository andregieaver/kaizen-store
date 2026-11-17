import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const templates = await import("./form-templates");
const admin = await import("./forms-admin");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let ownerId: string;
let strangerId: string;
let storeId: string;
let sisterId: string;
let otherId: string;

async function newAccount(name: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`${name}-${run}@example.com`}, ${name}) returning id`);
  return String(row.id);
}

async function newStore(name: string, owner: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${name}-${run}@example.com`}, 'Kari', 'Skjema') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${name}-${run}`}, 'Skjema', null) as id`);
  const id = String(store.id);
  await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${id}::uuid, ${owner}::uuid, 'owner')`);
  await db().execute(sql`delete from commerce.store_members where store_id = ${id}::uuid and account_id <> ${owner}::uuid`);
  return id;
}

const viewer = (storeId: string | null, accountId = ownerId) => ({ accountId, storeId });

beforeAll(async () => {
  ownerId = await newAccount("tpl-owner");
  strangerId = await newAccount("tpl-stranger");
  storeId = await newStore("tpl-a", ownerId);
  sisterId = await newStore("tpl-b", ownerId);
  otherId = await newStore("tpl-c", strangerId);
});

afterAll(async () => {
  for (const id of [storeId, sisterId, otherId]) if (id) await db().execute(sql`delete from commerce.form_templates where store_id = ${id}::uuid`);
  await closeDb();
});

describe("form templates (D705 F4)", () => {
  it("offers Kaizena Flow's starters in the store's language and makes a ready form from one, in its languages", async () => {
    const list = await templates.listFormTemplates(viewer(storeId), "nb");
    const quote = list.find((t) => t.starterKey === "quote")!;
    expect(quote).toMatchObject({ source: "kaizen", name: "Be om tilbud", category: "sales", questions: 5 });
    const made = await templates.makeFormFromTemplate(viewer(storeId), quote.id, "nb", ["nb", "sv"], ["post@example.com"]);
    expect(made.ok).toBe(true);
    const form = await admin.getForm(storeId, made.ok ? made.id : "");
    expect(form).toMatchObject({ name: "Be om tilbud", madeFrom: "starter:quote", delivery: { recipients: ["post@example.com"] } });
    expect(form!.questions[1].label).toEqual({ text: "Firma", byLocale: { sv: "Företag" } });
  });

  it("saves a form as a template without its addresses, keeps it private until an owner shares it, and updates it from the form", async () => {
    const list = await templates.listFormTemplates(viewer(storeId), "en");
    const made = await templates.makeFormFromTemplate(viewer(storeId), list.find((t) => t.starterKey === "newsletter")!.id, "en", ["en"], ["post@example.com"]);
    if (!made.ok) throw new Error("not made");
    const saved = await templates.saveFormAsTemplate(viewer(storeId), made.id, { name: "Our sign-up", category: "newsletter" }, "en");
    if (!saved.ok) throw new Error(saved.problems.join());
    const [row] = await db().execute<Row>(sql`select content, sharing from commerce.form_templates where id = ${saved.id}::uuid`);
    expect(JSON.stringify(row.content)).not.toContain("post@example.com");
    expect(row.sharing).toBe("private");

    // Private: only this store; shared with `stores`: the owner's other store too, never a stranger's.
    const seen = async (store: string, account = ownerId) => (await templates.listFormTemplates(viewer(store, account), "en")).some((t) => t.id === saved.id);
    expect(await seen(storeId)).toBe(true);
    expect(await seen(sisterId)).toBe(false);
    expect(await templates.changeFormTemplate(viewer(storeId, strangerId), saved.id, { name: "Our sign-up", sharing: "stores" })).toMatchObject({ ok: false });
    expect(await templates.changeFormTemplate(viewer(storeId), saved.id, { name: "Our sign-up", category: "newsletter", sharing: "stores" })).toEqual({ ok: true });
    expect(await seen(sisterId)).toBe(true);
    expect(await seen(otherId, strangerId)).toBe(false);
    const fromSister = (await templates.listFormTemplates(viewer(sisterId), "en")).find((t) => t.id === saved.id)!;
    expect(fromSister).toMatchObject({ source: "stores", publisher: "Skjema" });

    // Updated from its form: the next copy asks what the form asks now; a form already made stays.
    const form = (await admin.getForm(storeId, made.id))!;
    await admin.saveForm(viewer(storeId), made.id, { ...form, signup: { confirm: false, askName: true } });
    const before = await templates.makeFormFromTemplate(viewer(sisterId), saved.id, "en", ["en"], []);
    expect(await templates.updateTemplateFromForm(viewer(storeId), saved.id)).toEqual({ ok: true });
    const after = await templates.makeFormFromTemplate(viewer(sisterId), saved.id, "en", ["en"], []);
    if (!before.ok || !after.ok) throw new Error("not made");
    expect((await admin.getForm(sisterId, before.id))!.signup).toEqual({ confirm: true, askName: false });
    expect((await admin.getForm(sisterId, after.id))!.signup).toEqual({ confirm: false, askName: true });
    expect((await admin.getForm(sisterId, after.id))!.madeFrom).toBe(`template:${saved.id}`);
    expect(await templates.templatesOfForm(viewer(storeId), made.id, "en")).toEqual([{ id: saved.id, name: "Our sign-up" }]);

    // Only its own store changes or deletes it.
    expect(await templates.deleteFormTemplate(viewer(sisterId), saved.id)).toMatchObject({ ok: false });
    expect(await templates.updateTemplateFromForm(viewer(sisterId), saved.id)).toMatchObject({ ok: false });
  });

  it("lets a platform admin hide a marketplace template from every list but its own store's", async () => {
    const made = await templates.makeFormFromTemplate(viewer(otherId, strangerId), (await templates.listFormTemplates(viewer(otherId, strangerId), "en"))[0].id, "en", ["en"], []);
    if (!made.ok) throw new Error("not made");
    const saved = await templates.saveFormAsTemplate(viewer(otherId, strangerId), made.id, { name: "Shared contact", sharing: "marketplace" }, "en");
    if (!saved.ok) throw new Error(saved.problems.join());
    const inStore = async () => (await templates.listFormTemplates(viewer(storeId), "en")).find((t) => t.id === saved.id);
    expect(await inStore()).toMatchObject({ source: "marketplace" });
    expect((await templates.listSharedFormTemplates()).some((t) => t.id === saved.id)).toBe(true);

    const notAdmin = { id: ownerId, email: "x@example.com", name: null, platformAdmin: false };
    expect(await templates.setFormTemplateHidden(notAdmin, saved.id, true)).toMatchObject({ ok: false });
    const account = { id: strangerId, email: "x@example.com", name: null, platformAdmin: true };
    expect(await templates.setFormTemplateHidden(account, saved.id, true)).toEqual({ ok: true });
    expect(await inStore()).toBeUndefined();
    expect(await templates.makeFormFromTemplate(viewer(storeId), saved.id, "en", ["en"], [])).toMatchObject({ ok: false });
    expect((await templates.listFormTemplates(viewer(otherId, strangerId), "en")).find((t) => t.id === saved.id)).toMatchObject({ hidden: true });
    expect(await templates.setFormTemplateHidden(account, saved.id, false)).toEqual({ ok: true });
    expect(await inStore()).toBeDefined();
  });

  it("keeps Kaizena Flow's starters: the platform hides them, never deletes them", async () => {
    const platform = await templates.listFormTemplates(viewer(null), "en");
    const contact = platform.find((t) => t.starterKey === "contact")!;
    expect(await templates.deleteFormTemplate(viewer(null), contact.id)).toMatchObject({ ok: false });
    expect(platform.every((t) => t.source === "kaizen")).toBe(true);
  });
});
