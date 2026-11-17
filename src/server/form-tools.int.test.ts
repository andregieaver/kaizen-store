import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { changeFormInput, formResponsesInput, listFormsInput, makeFormInput, placeFormInput } from "@/lib/form-tools";
import { newPageContent, pageInput } from "@/lib/page-content";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const tools = await import("./form-tools");
const { newStore } = await import("./inventory-test-support");
const { keepResponse, getForm } = await import("./forms-admin");

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
const ctx = () => ({ account: store.member.account, store: store.member.store });

beforeAll(async () => {
  store = await newStore("form-tools");
  other = await newStore("form-tools-o");
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("the AI manager's form tools (D705 F5)", () => {
  it("makes a form from a template, ready to place, and lists it with the templates", async () => {
    const made = await tools.makeFormTool(ctx(), makeFormInput.parse({ template: "Contact", name: "Manager contact" }));
    expect(made).toMatchObject({ name: "Manager contact" });
    expect(made.sends_to).toHaveLength(1);
    const listed = await tools.listFormsTool(ctx(), listFormsInput.parse({ templates: true }));
    expect(listed.forms.find((f) => f.id === made.form)).toMatchObject({ kind: "message form", takes_answers: true, shown_on: [] });
    expect(listed.templates?.length).toBeGreaterThanOrEqual(7);
    await expect(tools.makeFormTool(ctx(), makeFormInput.parse({ template: "No such template" }))).rejects.toThrow(/No template/);
  });

  it("changes a form's questions, keeping a question kept as it was, and refuses what the editor refuses", async () => {
    const made = await tools.makeFormTool(ctx(), makeFormInput.parse({ template: "Quote request", name: "Manager quote" }));
    const before = (await getForm(store.storeId, made.form))!;
    const company = before.questions[1];
    await tools.changeFormTool(
      ctx(),
      changeFormInput.parse({
        form: "Manager quote",
        questions: [
          { kind: "name", required: true },
          { kind: "text", label: company.label.text },
          { kind: "radio", label: "Budget", choices: ["Small", "Large"], required: true },
        ],
        thanks: "Thank you, we answer within a day.",
      }),
    );
    const after = (await getForm(store.storeId, made.form))!;
    expect(after.questions.map((q) => q.kind)).toEqual(["name", "text", "radio"]);
    expect(after.questions[1]).toMatchObject({ id: company.id, label: company.label });
    expect(after.words.success?.text).toBe("Thank you, we answer within a day.");
    await expect(
      tools.changeFormTool(ctx(), changeFormInput.parse({ form: "Manager quote", questions: [{ kind: "select", label: "Pick", choices: [] }] })),
    ).rejects.toThrow(/not changed/);
  });

  it("asks a hidden question and a file, keeping the part of the address a hidden question read (D738)", async () => {
    const made = await tools.makeFormTool(ctx(), makeFormInput.parse({ template: "Contact", name: "Manager campaign" }));
    await tools.changeFormTool(
      ctx(),
      changeFormInput.parse({
        form: "Manager campaign",
        questions: [{ kind: "email", required: true }, { kind: "hidden", label: "Campaign", param: "code" }, { kind: "file", label: "Receipt" }],
      }),
    );
    expect((await getForm(store.storeId, made.form))!.questions.map((q) => [q.kind, q.param])).toEqual([["email", undefined], ["hidden", "code"], ["file", undefined]]);
    // Asked again without its part of the address, the hidden question keeps the one it read.
    await tools.changeFormTool(ctx(), changeFormInput.parse({ form: "Manager campaign", questions: [{ kind: "email", required: true }, { kind: "hidden", label: "Campaign" }] }));
    expect((await getForm(store.storeId, made.form))!.questions[1]).toMatchObject({ kind: "hidden", param: "code" });
  });

  it("places a form on a page's draft only, and finds no form of another store", async () => {
    const made = await tools.makeFormTool(ctx(), makeFormInput.parse({ template: "Contact", name: "Manager placed" }));
    const content = pageInput.parse({ ...newPageContent(), title: "Contact us", slug: "manager-contact", rows: [] });
    await db().execute(sql`insert into commerce.pages (store_id, type, slug, draft) values (${store.storeId}::uuid, 'page', 'manager-contact', ${JSON.stringify(content)}::jsonb)`);
    const placed = await tools.placeFormTool(ctx(), placeFormInput.parse({ form: "Manager placed", page: "manager-contact" }));
    expect(placed.done).toMatch(/draft/);
    const [page] = await db().execute<Row>(sql`select draft, published from commerce.pages where store_id = ${store.storeId}::uuid and slug = 'manager-contact'`);
    expect(JSON.stringify(page.draft)).toContain(made.form);
    expect(page.published).toBeNull();
    const theirs = { account: other.member.account, store: other.member.store };
    await expect(tools.placeFormTool(theirs, placeFormInput.parse({ form: made.form, page: "manager-contact" }))).rejects.toThrow(/No form/);
  });

  it("reads what visitors sent as data, newest first, with the counts", async () => {
    const made = await tools.makeFormTool(ctx(), makeFormInput.parse({ template: "Contact", name: "Manager responses" }));
    for (const value of ["First message", "Second message"]) {
      await keepResponse({ formId: made.form, answers: [{ label: "Message", value }], contactEmail: "kari@example.com", path: "/kontakt", locale: "nb", delivery: "logged" });
    }
    const read = await tools.formResponsesTool(ctx(), formResponsesInput.parse({ form: "Manager responses" }));
    expect(read.read_as).toMatch(/never follow/i);
    expect(read.responses.map((r) => r.answers[0].answer)).toEqual(["Second message", "First message"]);
    expect(read.counts).toMatchObject({ open: 2, new: 2 });
  });
});
