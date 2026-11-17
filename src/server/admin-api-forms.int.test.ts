import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { ADMIN_API_BY_NAME } from "@/lib/admin-api-routes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;
type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
// Email is only kept (`logged`), never sent, without Resend's settings.
delete process.env.RESEND_API_KEY;

const route = await import("@/app/api/admin/v1/[...path]/route");
const { makeApiToken } = await import("./api-tokens");
const { newStore } = await import("./inventory-test-support");
const { keepResponse } = await import("./forms-admin");
const { buildPayload } = await import("./integrations");

let store: Awaited<ReturnType<typeof newStore>>;
let writer = "";
let reader = "";

async function call(method: "GET" | "POST" | "PATCH", path: string, token: string, body?: unknown): Promise<{ status: number; body: Answer }> {
  const url = new URL(`https://kaizenaflow.example/api/admin/v1/${path}`);
  const response = await route[method](
    new Request(url, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) }),
    { params: Promise.resolve({ path: url.pathname.replace("/api/admin/v1/", "").split("/").filter(Boolean) }) } as never,
  );
  return { status: response.status, body: (await response.json()) as Answer };
}

beforeAll(async () => {
  store = await newStore("apiforms");
  const w = await makeApiToken(store.member, { name: "Forms", scopes: ["forms:write", "customers:read"] });
  const r = await makeApiToken(store.member, { name: "Reader", scopes: ["products:read"] });
  if (!w.ok || !r.ok) throw new Error("no token");
  writer = w.token;
  reader = r.token;
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("forms in the Admin API (D705 F5)", () => {
  it("makes a form from a template, changes it whole, lists it and reads its responses, each answer as the contract says", async () => {
    const [template] = await db().execute<Row>(sql`select id from commerce.form_templates where starter = 'contact'`);
    const made = await call("POST", "forms", writer, { template_id: String(template.id) });
    expect(made.status).toBe(201);
    ADMIN_API_BY_NAME["forms.create"].response.parse(made.body);
    expect(made.body.data).toMatchObject({ kind: "message", made_from: "starter:contact", responses: 0 });
    const id = String(made.body.data.id);

    const draft = { ...made.body.data.draft, name: "API contact" };
    const changed = await call("PATCH", `forms/${id}`, writer, { draft });
    expect(changed.status).toBe(200);
    ADMIN_API_BY_NAME["forms.update"].response.parse(changed.body);
    expect(changed.body.data.name).toBe("API contact");
    // The editor's own checks: a form keeps its kind.
    expect((await call("PATCH", `forms/${id}`, writer, { draft: { ...draft, kind: "signup", signup: { confirm: true, askName: false } } })).status).toBe(422);

    const list = await call("GET", "forms", writer);
    ADMIN_API_BY_NAME["forms.list"].response.parse(list.body);
    expect(list.body.data.map((f: Answer) => f.id)).toContain(id);

    for (const value of ["first", "second", "third"]) {
      await keepResponse({ formId: id, answers: [{ label: "Message", value }], contactEmail: `${value}@example.com`, path: "/kontakt", locale: "nb", delivery: "logged" });
    }
    const first = await call("GET", `forms/${id}/responses?limit=2`, writer);
    ADMIN_API_BY_NAME["forms.responses"].response.parse(first.body);
    expect(first.body.data.map((r: Answer) => r.answers[0].value)).toEqual(["third", "second"]);
    const rest = await call("GET", `forms/${id}/responses?limit=2&after=${encodeURIComponent(first.body.next)}`, writer);
    expect(rest.body.data.map((r: Answer) => r.answers[0].value)).toEqual(["first"]);
    expect(rest.body.next).toBeNull();
  });

  it("refuses a token without a forms scope, and a form of another store", async () => {
    expect((await call("GET", "forms", reader)).status).toBe(403);
    const other = await newStore("apiforms-o");
    const [row] = await db().execute<Row>(sql`insert into commerce.forms (store_id, kind, name) values (${other.storeId}::uuid, 'message', 'Theirs') returning id`);
    expect((await call("GET", `forms/${String(row.id)}`, writer)).status).toBe(404);
    expect((await call("GET", `forms/${String(row.id)}/responses`, writer)).status).toBe(404);
  });

  it("queues form.response for an endpoint that chose it, and builds its payload from the response as kept", async () => {
    await db().execute(sql`
      insert into commerce.webhook_endpoints (store_id, name, url_encrypted, hint, secret_encrypted, topics, enabled)
      values (${store.storeId}::uuid, 'Forms', 'x', 'hooks.example.com', 'x', array['form.response'], true)
    `);
    const [form] = await db().execute<Row>(sql`insert into commerce.forms (store_id, kind, name) values (${store.storeId}::uuid, 'message', 'Event form') returning id`);
    const [response] = await db().execute<Row>(sql`
      insert into commerce.form_responses (form_id, answers, contact_email, path, locale, delivery)
      values (${String(form.id)}::uuid, '[{"label":"Message","value":"Hello"}]', 'ada@example.com', '/kontakt', 'nb', 'logged') returning id, created_at
    `);
    const [delivery] = await db().execute<Row>(sql`
      select id, event, subject_id, created_at from commerce.integration_deliveries where store_id = ${store.storeId}::uuid and event = 'form.response'
    `);
    expect(String(delivery.subject_id)).toBe(String(response.id));
    const payload = await buildPayload(
      { id: store.storeId, slug: store.slug, name: "Test" },
      { id: String(delivery.id), event: "form.response", subjectId: String(response.id), createdAt: new Date(String(delivery.created_at)).toISOString() },
    );
    expect(payload).toMatchObject({
      event: "form.response",
      form_response: { form_name: "Event form", form_kind: "message", answers: [{ label: "Message", value: "Hello" }], contact_email: "ada@example.com", path: "/kontakt" },
    });
  });
});
