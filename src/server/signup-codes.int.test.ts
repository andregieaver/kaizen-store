import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, pageInput } from "@/lib/page-content";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

// Email is only kept (`logged`), never sent, without Resend's settings.
delete process.env.RESEND_API_KEY;

const forms = await import("./forms");

/** Sign-up forms that give a welcome code and tag (wave 5 unit J3, D304, `docs/wave-5-marketing.md` 11.3). */

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const path = "/s/signup/no/bli-med";
let storeId: string;
let otherStoreId: string;
let discountId: string;
let otherDiscountId: string;

const newsletter = (id: string, extra: Record<string, unknown>) => ({
  id,
  type: "newsletter",
  recipients: [`liste-${run}@example.com`],
  placeholder: "",
  submitLabel: "",
  successMessage: "",
  consent: "",
  ...extra,
});

async function newStore(name: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${name}-${run}@example.com`}, 'Kari', 'Velkommen') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${name}-${run}`}, 'Velkommen', null) as id`);
  return String(store.id);
}

const discount = async (store: string, code: string, unique = true) =>
  String(
    (
      await db().execute<Row>(sql`
        insert into commerce.discount_codes (store_id, code, kind, percent, unique_codes) values (${store}::uuid, ${code}, 'percent', 10, ${unique}) returning id
      `)
    )[0].id,
  );

beforeAll(async () => {
  storeId = await newStore("signup");
  otherStoreId = await newStore("signup-other");
  discountId = await discount(storeId, `HELLO${run}`.toUpperCase());
  otherDiscountId = await discount(otherStoreId, `THEIRS${run}`.toUpperCase());
  const page = pageInput.parse({
    ...newPageContent(),
    title: "Bli med",
    slug: "bli-med",
    rows: [
      {
        id: "r1",
        type: "row",
        layout: "1",
        columns: [
          {
            id: "c1",
            blocks: [
              newsletter(`a-${run}`, { incentive: discountId, tags: ["Popup", "Spring sale"] }),
              newsletter(`b-${run}`, { incentive: discountId }),
              newsletter(`c-${run}`, { incentive: otherDiscountId }),
            ],
          },
        ],
      },
    ],
  });
  await db().execute(sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at)
    values (${storeId}::uuid, 'page', 'bli-med', ${JSON.stringify(page)}::jsonb, ${JSON.stringify(page)}::jsonb, now())
  `);
});

afterAll(async () => {
  for (const id of [storeId, otherStoreId]) {
    await db().execute(sql`delete from commerce.signup_incentives where store_id = ${id}::uuid`);
    await db().execute(sql`delete from commerce.customer_tags where store_id = ${id}::uuid`);
    await db().execute(sql`delete from commerce.form_submissions where store_id = ${id}::uuid`);
    await db().execute(sql`delete from commerce.marketing_subscribers where store_id = ${id}::uuid`);
  }
  await closeDb();
});

const emails = (to: string) => db().execute<Row>(sql`select kind, subject, text from commerce.email_messages where to_address = ${to} order by created_at`);

/** Signs `to` up on a form and opens the confirmation link. */
async function signUpAndConfirm(form: string, to: string, visitor: string) {
  const result = await forms.submitForm(
    { store: storeId, block: form, values: { email: to }, consent: true, website: "", lang: "en", path, elapsed: 8000 },
    visitor,
  );
  expect(result.status).toBe(200);
  const confirm = (await emails(to)).filter((e) => e.kind === "form.confirm").at(-1)!;
  const token = new URL(String(confirm.text).match(/https?:\/\/\S+\/api\/forms\/confirm\?t=[A-Za-z0-9_-]+/)![0]).searchParams.get("t")!;
  await forms.confirmSignup(token);
}

const codesOf = async (to: string) =>
  (
    await db().execute<Row>(sql`
      select i.code from commerce.signup_incentives s join commerce.discount_code_items i on i.store_id = s.store_id and i.id = s.code_item_id
      where s.store_id = ${storeId}::uuid and s.email = ${to}
    `)
  ).map((r) => String(r.code));

describe("sign-up welcome codes and tags (D304 J3)", () => {
  it("gives nothing before the address is confirmed, then one code by email and the form's tags", async () => {
    const to = `kari-${run}@example.com`;
    await forms.submitForm({ store: storeId, block: `a-${run}`, values: { email: to }, consent: true, website: "", lang: "en", path, elapsed: 8000 }, `v1-${run}`);
    expect(await codesOf(to)).toEqual([]);
    const confirm = (await emails(to))[0];
    const token = new URL(String(confirm.text).match(/https?:\/\/\S+\/api\/forms\/confirm\?t=[A-Za-z0-9_-]+/)![0]).searchParams.get("t")!;
    await forms.confirmSignup(token);
    const codes = await codesOf(to);
    expect(codes).toHaveLength(1);
    expect(codes[0]).toMatch(new RegExp(`^HELLO${run.toUpperCase()}-[A-Z2-9]{8}$`));
    const welcome = (await emails(to)).find((e) => e.kind === "form.welcome_code")!;
    expect(welcome.subject).toBe("Your welcome code from Velkommen");
    // The log keeps the email without the code.
    expect(String(welcome.text)).not.toContain(codes[0]);
    const tags = await db().execute<Row>(sql`select label from commerce.customer_tags where store_id = ${storeId}::uuid and email = ${to} order by label`);
    expect(tags.map((t) => t.label)).toEqual(["Popup", "Spring sale"]);
  });

  it("gives an address one code of a discount, whichever form it confirms on", async () => {
    const to = `kari-${run}@example.com`;
    await signUpAndConfirm(`b-${run}`, to, `v2-${run}`);
    expect(await codesOf(to)).toHaveLength(1);
    expect((await emails(to)).filter((e) => e.kind === "form.welcome_code")).toHaveLength(1);
  });

  it("gives no code of another store's discount, nor of one switched off", async () => {
    const ola = `ola-${run}@example.com`;
    await signUpAndConfirm(`c-${run}`, ola, `v3-${run}`);
    expect(await codesOf(ola)).toEqual([]);
    await db().execute(sql`update commerce.discount_codes set active = false where id = ${discountId}::uuid`);
    const per = `per-${run}@example.com`;
    await signUpAndConfirm(`b-${run}`, per, `v4-${run}`);
    expect(await codesOf(per)).toEqual([]);
    // The sign-up itself still went through.
    expect((await emails(`liste-${run}@example.com`)).length).toBeGreaterThan(0);
  });
});
