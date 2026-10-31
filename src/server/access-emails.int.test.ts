import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const { approveAccessRequest, createAccessRequest, declineAccessRequest } = await import("./platform");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let admin: Account;

const emailsTo = (to: string) =>
  db().execute<Row>(sql`select kind, subject from commerce.email_messages where to_address = ${to} order by created_at, kind`);
const requestOf = async (email: string) =>
  (await db().execute<Row>(sql`select id, locale from commerce.access_requests where email = ${email} order by created_at desc limit 1`))[0];

beforeAll(async () => {
  const [a] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`access-admin-${run}@example.com`}, 'Platform', true) returning id, email
  `);
  admin = { id: String(a.id), email: String(a.email), name: "Platform", platformAdmin: true };
});

afterAll(async () => {
  await closeDb();
});

describe("a request's emails in its own language (D312 P6)", () => {
  it("tells a Norwegian requester in Norwegian that the request came, once, and the admin starts in Norwegian when approved", async () => {
    const email = `kari-${run}@example.com`;
    await createAccessRequest({ name: "Kari", email, storeName: "Karis Kaker", message: "", lang: "nb" });
    // A second request while the first waits is merged and sends nothing again.
    await createAccessRequest({ name: "Kari", email, storeName: "Karis Kaker", message: "", lang: "nb" });
    const request = await requestOf(email);
    expect(request.locale).toBe("nb-NO");
    expect(await emailsTo(email)).toEqual([{ kind: "platform.access_received", subject: "Vi har fått forespørselen din om Karis Kaker" }]);

    expect(await approveAccessRequest(admin, String(request.id), `kari-${run}`, "Karis Kaker", "https://example.com")).toMatchObject({ ok: true });
    const sent = await emailsTo(email);
    expect(sent).toContainEqual({ kind: "platform.access_approved", subject: "Karis Kaker er klar i Kaizena Flow" });
    const [account] = await db().execute<Row>(sql`select admin_locale from commerce.accounts where lower(email) = lower(${email})`);
    expect(account.admin_locale).toBe("nb-NO");
  });

  it("writes in English when the form was English, and tells a declined requester", async () => {
    const email = `per-${run}@example.com`;
    await createAccessRequest({ name: "Per", email, storeName: "Per's Shop", message: "" });
    const request = await requestOf(email);
    expect(request.locale).toBe("en");
    await declineAccessRequest(admin, String(request.id));
    // Declining again does nothing more.
    await declineAccessRequest(admin, String(request.id));
    expect(await emailsTo(email)).toEqual([
      { kind: "platform.access_received", subject: "We got your request for Per's Shop" },
      { kind: "platform.access_declined", subject: "Your request for Per's Shop" },
    ]);
  });
});

describe("the terms a requester accepts (PSI REG-02)", () => {
  it("records when the form's sender accepted the terms and which published version, and nothing for a request made another way", async () => {
    const fromForm = `terms-${run}@example.com`;
    const other = `noterms-${run}@example.com`;
    await createAccessRequest({ name: "Tove", email: fromForm, storeName: "Toves Te", message: "", termsAccepted: true }, { quiet: true });
    await createAccessRequest({ name: "Ola", email: other, storeName: "Olas Ost", message: "" }, { quiet: true });
    const [expected] = await db().execute<Row>(sql`
      select to_char(coalesce(published_at, updated_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as v from commerce.pages
      where store_id is null and type = 'page' and slug = 'terms' and published is not null`);
    const [a] = await db().execute<Row>(sql`select terms_accepted_at, terms_version from commerce.access_requests where email = ${fromForm}`);
    const [b] = await db().execute<Row>(sql`select terms_accepted_at, terms_version from commerce.access_requests where email = ${other}`);
    expect(a.terms_accepted_at).not.toBeNull();
    expect(a.terms_version ?? null).toBe(expected?.v ?? null);
    expect(b).toMatchObject({ terms_accepted_at: null, terms_version: null });
  });
});

