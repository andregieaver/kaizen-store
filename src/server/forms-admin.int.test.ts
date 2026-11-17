import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { FORM_STARTERS, draftFromStarter, type FormDraft } from "@/lib/form-records";
import { newPageContent, pageInput } from "@/lib/page-content";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

// Email is only kept (`logged`), never sent, without Resend's settings.
delete process.env.RESEND_API_KEY;

const admin = await import("./forms-admin");
const { submitForm } = await import("./forms");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let storeId: string;
let otherStoreId: string;
let accountId: string;
const path = "/s/forms-admin/no/kontakt";

async function newStore(name: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${name}-${run}@example.com`}, 'Kari', 'Skjema') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${name}-${run}`}, 'Skjema', null) as id`);
  return String(store.id);
}

const contactDraft = (): FormDraft => draftFromStarter(FORM_STARTERS.find((s) => s.key === "contact")!, "en", ["en"], [`owner-${run}@example.com`]);
const actor = () => ({ accountId, storeId });

/** Places the form on a published page of the store with a `form` component (D705). */
async function placeOnPage(formId: string, slug: string, published = true) {
  const page = pageInput.parse({
    ...newPageContent(),
    title: `Kontakt ${slug}`,
    slug,
    rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ id: `f-${slug}`, type: "form", formId }] }] }],
  });
  const [row] = await db().execute<Row>(sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at)
    values (${storeId}::uuid, 'page', ${slug}, ${JSON.stringify(page)}::jsonb, ${published ? JSON.stringify(page) : null}::jsonb, ${published ? sql`now()` : null})
    returning id
  `);
  return String(row.id);
}

const send = (formId: string, values: Record<string, string | boolean>, store: string | null = storeId, consent = false) =>
  submitForm({ store, block: formId, values, consent, website: "", lang: "en", path, elapsed: 5000 }, `visitor-${Math.random()}`);

beforeAll(async () => {
  storeId = await newStore("forms-admin");
  otherStoreId = await newStore("forms-admin-other");
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts order by created_at limit 1`);
  accountId = String(account.id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.pages where store_id = ${storeId}::uuid`);
  await db().execute(sql`delete from commerce.forms where store_id in (${storeId}::uuid, ${otherStoreId}::uuid)`);
  await db().execute(sql`delete from commerce.form_submissions where store_id in (${storeId}::uuid, ${otherStoreId}::uuid)`);
  await closeDb();
});

describe("forms as their own records (D705)", () => {
  it("makes a form from a starter, lists it and keeps its kind", async () => {
    const made = await admin.saveForm(actor(), null, contactDraft(), "starter:contact");
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const form = await admin.getForm(storeId, made.id);
    expect(form).toMatchObject({ kind: "message", name: "Contact", madeFrom: "starter:contact", status: "active", keepMonths: 12 });
    expect(form?.questions.map((q) => q.kind)).toEqual(["name", "email", "textarea"]);
    expect((await admin.listForms(storeId)).find((f) => f.id === made.id)).toMatchObject({ recipients: 1, questions: 3, responses: 0 });
    // Another store does not see it.
    expect(await admin.getForm(otherStoreId, made.id)).toBeNull();
    const signup = { ...contactDraft(), kind: "signup" as const, questions: [], signup: { confirm: true, askName: false } };
    expect(await admin.saveForm(actor(), made.id, signup)).toEqual({ ok: false, problems: ["A form keeps its kind. Make a new form instead."] });
    expect(await admin.saveForm(actor(), made.id, { ...contactDraft(), name: "" })).toMatchObject({ ok: false });
  });

  it("refuses a code or tags on Kaizena Flow's own sign-ups", async () => {
    const draft = draftFromStarter(FORM_STARTERS.find((s) => s.key === "newsletter")!, "en", ["en"], [`owner-${run}@example.com`]);
    const outcome = await admin.saveForm({ accountId, storeId: null }, null, { ...draft, signup: { confirm: true, askName: false, tags: ["vip"] } });
    expect(outcome).toEqual({ ok: false, problems: ["Kaizena Flow's own sign-ups give no codes or tags."] });
  });

  it("takes a message only once a published page shows the form, keeps the response and exports it", async () => {
    const made = await admin.saveForm(actor(), null, contactDraft());
    if (!made.ok) throw new Error("made");
    const values = { q1: "Ada Lovelace", q2: `Ada-${run}@Example.com`, q3: "Hello there" };
    // On no page, or only on a draft, it is not shown, so it takes nothing.
    expect((await send(made.id, values)).status).toBe(404);
    await placeOnPage(made.id, `draft-${run}`, false);
    expect((await send(made.id, values)).status).toBe(404);
    const pageId = await placeOnPage(made.id, `kontakt-${run}`);
    // Sent for another store, the form is not found.
    expect((await send(made.id, values, otherStoreId)).status).toBe(404);
    const sent = await send(made.id, values);
    expect(sent).toMatchObject({ status: 200, body: { ok: true, outcome: "sent" } });
    // A wrong answer is told by its question, and nothing is kept.
    expect(await send(made.id, { ...values, q2: "not an address" })).toMatchObject({ status: 422, body: { ok: false, errors: { q2: expect.any(String) } } });

    const { responses } = await admin.listResponses(storeId, made.id);
    expect(responses).toHaveLength(1);
    expect(responses[0]).toMatchObject({ contactEmail: `ada-${run}@example.com`, state: "new", path, locale: "en" });
    expect(responses[0].answers.map((a) => a.value)).toEqual(["Ada Lovelace", `Ada-${run}@Example.com`, "Hello there"]);
    expect((await admin.listForms(storeId)).find((f) => f.id === made.id)).toMatchObject({ responses: 1, unread: 1 });

    expect(await admin.setResponseState(actor(), made.id, [responses[0].id], "read")).toBe(1);
    expect((await admin.listForms(storeId)).find((f) => f.id === made.id)?.unread).toBe(0);
    const file = await admin.exportResponses(actor(), made.id, "Europe/Oslo");
    expect(file?.name).toBe("contact-responses.csv");
    expect(file?.csv).toContain("Ada Lovelace");
    // One column per question, labelled in the owner's language as the email is.
    expect(file?.csv.split("\r\n")[0]).toMatch(/^sent_at,[^,]+,[^,]+,[^,]+,page,language,state$/);

    // The page carries it, so it can only be archived; archived, it takes nothing.
    expect(await admin.formUses(storeId, made.id)).toHaveLength(2);
    expect(await admin.deleteForm(actor(), made.id)).toMatchObject({ ok: false, uses: expect.any(Array) });
    expect(await admin.setFormStatus(actor(), made.id, "archived")).toBe(true);
    expect((await send(made.id, values)).status).toBe(404);
    expect(await admin.setFormStatus(actor(), made.id, "active")).toBe(true);

    // Off every page, it goes with its responses.
    await db().execute(sql`delete from commerce.pages where store_id = ${storeId}::uuid and (id = ${pageId}::uuid or slug = ${`draft-${run}`})`);
    expect(await admin.deleteForm(actor(), made.id)).toEqual({ ok: true, responses: 1 });
    expect((await db().execute(sql`select 1 from commerce.form_responses where form_id = ${made.id}::uuid`)).length).toBe(0);
  });

  it("keeps a sign-up that needs no confirmation as a response", async () => {
    const draft = draftFromStarter(FORM_STARTERS.find((s) => s.key === "newsletter")!, "en", ["en"], [`owner-${run}@example.com`]);
    const made = await admin.saveForm(actor(), null, { ...draft, signup: { confirm: false, askName: false } });
    if (!made.ok) throw new Error("made");
    await placeOnPage(made.id, `news-${run}`);
    expect(await send(made.id, { email: `Reader-${run}@example.com` }, storeId, true)).toMatchObject({ status: 200, body: { ok: true, outcome: "sent" } });
    const { responses } = await admin.listResponses(storeId, made.id);
    expect(responses).toHaveLength(1);
    expect(responses[0].contactEmail).toBe(`reader-${run}@example.com`);
  });

  it("offers the builder its forms without where they send", async () => {
    const forms = await admin.builderForms(storeId, "en", "/admin/x/forms");
    expect(forms.list.length).toBeGreaterThan(0);
    for (const f of forms.list) expect(JSON.stringify(f.preview)).not.toContain(`owner-${run}@example.com`);
  });

  it("deletes responses older than their form's months, never older than the rule", async () => {
    const made = await admin.saveForm(actor(), null, { ...contactDraft(), keepMonths: 1 });
    if (!made.ok) throw new Error("made");
    const insert = (age: string) =>
      db().execute(sql`
        insert into commerce.form_responses (form_id, answers, contact_email, path, locale, delivery, created_at)
        values (${made.id}::uuid, '[]', null, '/', 'en', 'sent', now() - ${age}::interval)
      `);
    await insert("2 months");
    await insert("10 days");
    const removed = await admin.pruneFormResponses(new Date(), 36, 100);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect((await admin.listResponses(storeId, made.id)).responses).toHaveLength(1);
    // The rule's months win when they are fewer.
    await admin.saveForm(actor(), made.id, { ...contactDraft(), keepMonths: 36 });
    await insert("40 months");
    await admin.pruneFormResponses(new Date(), 36, 100);
    expect((await admin.listResponses(storeId, made.id)).responses).toHaveLength(1);
  });
});

describe("a page's own form after the move (D705 F2)", () => {
  it("is still found from a page drawn before the move, by the id the move gave it, and keeps the response", async () => {
    const { liftedFormId } = await import("./forms");
    const [row] = await db().execute<Row>(sql`select commerce.lifted_form_id(${storeId}::uuid, ${`old-${run}`}) as id`);
    expect(liftedFormId(storeId, `old-${run}`)).toBe(String(row.id));
    // The move made the form under that id and put a `form` component with the old component's id on the page.
    await db().execute(sql`
      insert into commerce.forms (id, store_id, kind, name, questions, delivery)
      values (${String(row.id)}::uuid, ${storeId}::uuid, 'message', 'Contact form (Kontakt)',
        ${JSON.stringify(contactDraft().questions)}::jsonb, ${JSON.stringify({ recipients: [`owner-${run}@example.com`], subject: "" })}::jsonb)
    `);
    const page = pageInput.parse({
      ...newPageContent(),
      title: "Moved",
      slug: `moved-${run}`,
      rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ id: `old-${run}`, type: "form", formId: String(row.id) }] }] }],
    });
    await db().execute(sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at)
      values (${storeId}::uuid, 'page', ${`moved-${run}`}, ${JSON.stringify(page)}::jsonb, ${JSON.stringify(page)}::jsonb, now())
    `);
    const values = { q1: "Ada", q2: `ada-${run}@example.com`, q3: "Hei" };
    // Sent with the old component's id, as a page cached before the move sends it.
    expect(await send(`old-${run}`, values)).toMatchObject({ status: 200, body: { ok: true } });
    // And with the form's own, as the page drawn after it sends it.
    expect(await send(String(row.id), values)).toMatchObject({ status: 200, body: { ok: true } });
    expect((await admin.listResponses(storeId, String(row.id))).responses).toHaveLength(2);
  });
});
