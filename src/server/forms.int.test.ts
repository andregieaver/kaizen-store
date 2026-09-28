import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, pageInput } from "@/lib/page-content";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

// Email is only kept (`logged`), never sent, without Resend's settings.
delete process.env.RESEND_API_KEY;

const forms = await import("./forms");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let storeId: string;
let otherStoreId: string;
const path = "/s/forms/no/kontakt";

const page = pageInput.parse({
  ...newPageContent(),
  title: "Kontakt",
  slug: "kontakt",
  rows: [
    {
      id: "r1",
      type: "row",
      layout: "1",
      columns: [
        {
          id: "c1",
          blocks: [
            {
              id: `contact-${run}`,
              type: "emailForm",
              recipients: [`post-${run}@example.com`, `salg-${run}@example.com`],
              subject: "",
              fields: [
                { id: "name", kind: "name", label: "", required: true },
                { id: "mail", kind: "email", label: "", required: true },
                { id: "msg", kind: "textarea", label: "", required: true },
              ],
              submitLabel: "",
              successMessage: "",
            },
            { id: `news-${run}`, type: "newsletter", recipients: [`liste-${run}@example.com`], askName: true, placeholder: "", submitLabel: "", successMessage: "", consent: "" },
            { id: `direct-${run}`, type: "newsletter", recipients: [`liste-${run}@example.com`], confirm: false, placeholder: "", submitLabel: "", successMessage: "", consent: "" },
            { id: `nowhere-${run}`, type: "newsletter", recipients: [], placeholder: "", submitLabel: "", successMessage: "", consent: "" },
          ],
        },
      ],
    },
  ],
});

async function newStore(name: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${name}-${run}@example.com`}, 'Kari', 'Skjema') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`${name}-${run}`}, 'Skjema', null) as id
  `);
  return String(store.id);
}

beforeAll(async () => {
  storeId = await newStore("forms");
  otherStoreId = await newStore("forms-other");
  // The owner's emails are in the store's main language: its own country's.
  await db().execute(sql`update commerce.stores set country = 'NO' where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at)
    values (${storeId}::uuid, 'page', 'kontakt', ${JSON.stringify(page)}::jsonb, ${JSON.stringify(page)}::jsonb, now())
  `);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.form_submissions where store_id in (${storeId}::uuid, ${otherStoreId}::uuid)`);
  await closeDb();
});

const request = (block: string, values: Record<string, string | boolean>, extra: Record<string, unknown> = {}) => ({
  store: storeId,
  block,
  values,
  consent: true,
  website: "",
  lang: "nb",
  path,
  elapsed: 8000,
  ...extra,
});

const emails = (to: string) =>
  db().execute<Row>(sql`select kind, subject, html, text, status from commerce.email_messages where to_address = ${to} order by created_at`);

describe("forms (D93)", () => {
  it("emails a message to each of the form's recipients, never to the visitor", async () => {
    const result = await forms.submitForm(
      request(`contact-${run}`, { name: "Kari Nordmann", mail: `kari-${run}@example.com`, msg: "Hei!\nHar dere gavekort?" }),
      `visitor-a-${run}`,
    );
    expect(result).toEqual({ status: 200, body: { ok: true, outcome: "sent" } });
    for (const to of [`post-${run}@example.com`, `salg-${run}@example.com`]) {
      const [email] = await emails(to);
      expect(email).toMatchObject({ kind: "form.message", status: "logged", subject: "Ny melding fra Skjema" });
      expect(String(email.text)).toContain("Navn:\nKari Nordmann");
      expect(String(email.text)).toContain("Har dere gavekort?");
      expect(String(email.text)).toContain(path);
    }
    expect(await emails(`kari-${run}@example.com`)).toHaveLength(0);
    const [row] = await db().execute<Row>(sql`select status, payload, email from commerce.form_submissions where store_id = ${storeId}::uuid and kind = 'message'`);
    // The message is in the emails kept; the submission only counts.
    expect(row).toEqual({ status: "logged", payload: null, email: null });
  });

  it("says what to correct, and sends nothing for robots, other sites' forms or forms with nowhere to send", async () => {
    expect(await forms.submitForm(request(`contact-${run}`, { name: "", mail: "kari@", msg: "Hei" }), `visitor-b-${run}`)).toEqual({
      status: 422,
      body: { ok: false, errors: { name: "Fyll ut dette feltet.", mail: "Skriv en gyldig e-postadresse." } },
    });
    const robot = await forms.submitForm(request(`contact-${run}`, { name: "Bot", mail: `bot-${run}@example.com`, msg: "Buy" }, { website: "http://spam" }), `visitor-b-${run}`);
    expect(robot).toEqual({ status: 200, body: { ok: true, outcome: "sent" } });
    expect(await forms.submitForm(request(`contact-${run}`, { name: "A", mail: `a-${run}@example.com`, msg: "Hei" }, { store: otherStoreId }), `visitor-b-${run}`)).toMatchObject({ status: 404 });
    expect(await forms.submitForm(request(`nowhere-${run}`, { email: `a-${run}@example.com` }), `visitor-b-${run}`)).toMatchObject({ status: 404 });
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.form_submissions where visitor = ${`visitor-b-${run}`}`);
    expect(count.n).toBe(0);
  });

  it("stops a visitor after five sends in an hour", async () => {
    const visitor = `visitor-c-${run}`;
    for (let i = 0; i < forms.VISITOR_HOURLY; i++) {
      expect((await forms.submitForm(request(`contact-${run}`, { name: "A", mail: `c-${run}@example.com`, msg: `Nr ${i}` }), visitor)).status).toBe(200);
    }
    expect(await forms.submitForm(request(`contact-${run}`, { name: "A", mail: `c-${run}@example.com`, msg: "En til" }), visitor)).toEqual({
      status: 429,
      body: { ok: false, error: "For mange forsøk. Prøv igjen senere." },
    });
  });

  let link: string;

  it("asks a subscriber to confirm first, from the store's own address, and only once a day", async () => {
    const to = `ny-${run}@example.com`;
    const result = await forms.submitForm(request(`news-${run}`, { email: to.toUpperCase(), name: "Ola" }, { lang: "en" }), `visitor-d-${run}`);
    expect(result).toEqual({ status: 200, body: { ok: true, outcome: "confirm" } });
    const [email] = await emails(to);
    expect(email).toMatchObject({ kind: "form.confirm", subject: "Confirm your sign-up to the newsletter from Skjema" });
    link = String(email.text).match(/https?:\/\/\S+\/api\/forms\/confirm\?t=[A-Za-z0-9_-]+/)![0];
    // The list hears nothing until the address is confirmed.
    expect(await emails(`liste-${run}@example.com`)).toHaveLength(0);
    const [row] = await db().execute<Row>(sql`select status, token_hash, payload from commerce.form_submissions where email = ${to}`);
    expect(row).toMatchObject({ status: "pending", payload: { name: "Ola", consent: "Yes, email me the newsletter. I can unsubscribe at any time." } });
    expect(String(row.token_hash)).not.toBe(new URL(link).searchParams.get("t"));

    await forms.submitForm(request(`news-${run}`, { email: to }, { lang: "en" }), `visitor-e-${run}`);
    expect(await emails(to)).toHaveLength(1);
  });

  it("emails the confirmed sign-up with its consent to the recipients, and returns the visitor to the page", async () => {
    const token = new URL(link).searchParams.get("t")!;
    const { location } = await forms.confirmSignup(token);
    expect(location).toMatch(new RegExp(`${path}\\?newsletter=confirmed&form=news-${run}$`));
    const [email] = await emails(`liste-${run}@example.com`);
    expect(email).toMatchObject({ kind: "form.subscription", subject: "Ny påmelding til nyhetsbrevet fra Skjema" });
    expect(String(email.text)).toContain(`ny-${run}@example.com`);
    expect(String(email.text)).toContain("Samtykke:\nYes, email me the newsletter.");
    expect(String(email.text)).toContain("Bekreftet:");
    const [row] = await db().execute<Row>(sql`select status, token_hash, payload, confirmed_at from commerce.form_submissions where email = ${`ny-${run}@example.com`}`);
    expect(row).toMatchObject({ status: "logged", token_hash: null, payload: null });
    expect(row.confirmed_at).not.toBeNull();
    // A link works once.
    expect((await forms.confirmSignup(token)).location).not.toContain("newsletter=");
    expect(await emails(`liste-${run}@example.com`)).toHaveLength(1);
  });

  it("does not take a link opened too late", async () => {
    await forms.submitForm(request(`news-${run}`, { email: `sen-${run}@example.com` }), `visitor-f-${run}`);
    const [email] = await emails(`sen-${run}@example.com`);
    const token = String(email.text).match(/confirm\?t=([A-Za-z0-9_-]+)/)![1];
    await db().execute(sql`update commerce.form_submissions set created_at = now() - interval '8 days' where email = ${`sen-${run}@example.com`}`);
    expect((await forms.confirmSignup(token)).location).toMatch(/newsletter=expired/);
    const [row] = await db().execute<Row>(sql`select status, payload from commerce.form_submissions where email = ${`sen-${run}@example.com`}`);
    expect(row).toEqual({ status: "expired", payload: null });
    expect(await emails(`liste-${run}@example.com`)).toHaveLength(1);
  });

  it("without confirming, emails the sign-up at once", async () => {
    const result = await forms.submitForm(request(`direct-${run}`, { email: `rett-${run}@example.com` }), `visitor-g-${run}`);
    expect(result).toEqual({ status: 200, body: { ok: true, outcome: "sent" } });
    expect(await emails(`rett-${run}@example.com`)).toHaveLength(0);
    const list = await emails(`liste-${run}@example.com`);
    expect(String(list.at(-1)!.text)).toContain(`rett-${run}@example.com`);
  });

  it("forgets sends after 30 days", async () => {
    await db().execute(sql`update commerce.form_submissions set created_at = now() - interval '31 days' where visitor = ${`visitor-a-${run}`}`);
    expect(await forms.pruneFormSubmissions()).toBeGreaterThanOrEqual(1);
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.form_submissions where visitor = ${`visitor-a-${run}`}`);
    expect(count.n).toBe(0);
  });
});
