import { randomInt } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const { refreshRegisterCompany, registerFactsNow, watchRegister } = await import("./register-facts");
const { controlCenter } = await import("./control-center");

/**
 * Company facts from Brønnøysund (D891): a number is asked about once and kept, a sole trader keeps nothing but that it is one, the daily
 * watch fills the numbers stores hold, follows the feed and tells a store once when a company it sells to on payment terms is newly
 * bankrupt; a register that does not answer is asked once a run. The register is a stand-in here.
 */

/** A valid organisation number nobody else's test holds: eight random digits and their mod-11 check digit. */
function orgNumber(): string {
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const digits = Array.from({ length: 8 }, () => randomInt(10));
    digits[0] = 8 + randomInt(2);
    const check = 11 - (digits.reduce((sum, d, i) => sum + d * weights[i], 0) % 11);
    if (check === 10) continue;
    return digits.join("") + String(check === 11 ? 0 : check);
  }
}

const run = Date.now().toString(36);
const slug = `register-${run}`;
let storeId: string;
const COMPANY = orgNumber();
const SOLE = orgNumber();
const MISSING = orgNumber();
const NOW = new Date("2026-11-24T05:00:00Z");

const unit = (number: string, over: Record<string, unknown> = {}) => ({
  organisasjonsnummer: number,
  navn: "NORDFJORD ENERGI AS",
  organisasjonsform: { kode: "AS", beskrivelse: "Aksjeselskap" },
  naeringskode1: { kode: "35.111", beskrivelse: "Produksjon av elektrisitet fra vannkraft" },
  antallAnsatte: 120,
  harRegistrertAntallAnsatte: true,
  stiftelsesdato: "2009-03-01",
  forretningsadresse: { poststed: "BERGEN" },
  konkurs: false,
  ...over,
});
const accounts = [
  { regnskapstype: "SELSKAP", regnskapsperiode: { tilDato: "2025-12-31" }, valuta: "NOK", resultatregnskapResultat: { aarsresultat: 1, driftsresultat: { driftsresultat: 2, driftsinntekter: { sumDriftsinntekter: 8400202.0 } } }, egenkapitalGjeld: { egenkapital: { sumEgenkapital: 3 } } },
];

/** A register stand-in: answers by address, counts the calls. */
function register(answers: (url: URL) => { status: number; body?: unknown }) {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    const answer = answers(url);
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

let flagged = false;
const answers = (url: URL) => {
  const number = url.pathname.split("/").pop() ?? "";
  if (url.pathname.includes("/oppdateringer/")) {
    const asked = (url.searchParams.get("organisasjonsnummer") ?? "").split(",");
    return { status: 200, body: { _embedded: { oppdaterteEnheter: flagged && asked.includes(COMPANY) ? [{ organisasjonsnummer: COMPANY, endringstype: "Endring" }] : [] } } };
  }
  if (url.pathname.includes("/regnskap/")) return number === COMPANY ? { status: 200, body: accounts } : { status: 404 };
  if (number === COMPANY) return { status: 200, body: unit(COMPANY, flagged ? { konkurs: true, konkursdato: "2026-11-23" } : {}) };
  if (number === SOLE) return { status: 200, body: unit(SOLE, { navn: "NORDMANN OLA", organisasjonsform: { kode: "ENK", beskrivelse: "Enkeltpersonforetak" } }) };
  return { status: 404 };
};

async function kept(number: string) {
  const [row] = await db().execute<Row>(sql`select * from commerce.register_companies where organisation_number = ${number}`);
  return row;
}

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Register test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`
    insert into commerce.customer_companies (store_id, name, organisation_number, payment_terms)
    values (${storeId}::uuid, 'Nordfjord Energi', ${`NO ${COMPANY.slice(0, 3)} ${COMPANY.slice(3, 6)} ${COMPANY.slice(6)} MVA`}, 'net_30'),
           (${storeId}::uuid, 'Ola Nordmann', ${SOLE}, null),
           (${storeId}::uuid, 'Typo AS', ${MISSING}, null)
  `);
});

beforeEach(() => {
  flagged = false;
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.register_companies where organisation_number in (${COMPANY}, ${SOLE}, ${MISSING})`);
  await closeDb();
});

describe("a company's facts", () => {
  it("are asked of the register once and kept, with the latest accounts", async () => {
    const reg = register(answers);
    const view = await registerFactsNow(COMPANY, { fetch: reg.fetch, now: NOW });
    expect(view).toMatchObject({ status: "company", facts: { name: "Nordfjord Energi AS", employees: 120, municipality: "Bergen", redFlag: null }, accounts: { year: 2025, revenueMinor: 840020200 } });
    expect(reg.calls).toHaveLength(2);
    await registerFactsNow(COMPANY, { fetch: reg.fetch, now: NOW });
    expect(reg.calls).toHaveLength(2);
  });

  it("of a sole trader keep nothing but that it is one", async () => {
    expect(await refreshRegisterCompany(SOLE, { accounts: true }, { fetch: register(answers).fetch })).toEqual({ status: "sole_trader", newFlag: null });
    expect(await kept(SOLE)).toMatchObject({ status: "sole_trader", org_form: "ENK", name: null, municipality: null, employees: null, red_flag: null });
  });
});

describe("the daily watch", () => {
  it("fills the numbers stores hold, then tells the store once when a company on payment terms is newly bankrupt", async () => {
    await db().execute(sql`delete from commerce.register_companies where organisation_number in (${COMPANY}, ${SOLE}, ${MISSING})`);
    const alerts: [string, string, string][] = [];
    const alert = async (store: string, company: string, flag: string) => (alerts.push([store, company, flag]), { ok: true, sent: 1 });
    const first = await watchRegister({ fetch: register(answers).fetch, now: NOW, alert: alert as never });
    expect(first.added).toBeGreaterThanOrEqual(3);
    expect((await kept(MISSING))?.status).toBe("not_found");
    expect((await kept(COMPANY))?.status).toBe("company");
    expect(alerts).toEqual([]);

    flagged = true;
    const second = await watchRegister({ fetch: register(answers).fetch, now: NOW, alert: alert as never });
    expect(second.changed).toBeGreaterThanOrEqual(1);
    expect(await kept(COMPANY)).toMatchObject({ red_flag: "bankrupt" });
    const [company] = await db().execute<Row>(sql`select id from commerce.customer_companies where store_id = ${storeId}::uuid and name = 'Nordfjord Energi'`);
    expect(alerts).toEqual([[storeId, String(company.id), "bankrupt"]]);

    // Still bankrupt the next day: not news, so nobody is told again.
    await watchRegister({ fetch: register(answers).fetch, now: NOW, alert: alert as never });
    expect(alerts).toHaveLength(1);

    // The store's Home lists it while the store sells to businesses, and a store that does not never reads its companies.
    const [owner] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`${slug}@example.com`}`);
    const account = { id: String(owner.id), email: String(owner.email), name: null, platformAdmin: false } as never;
    await db().execute(sql`update commerce.stores set features = array['shop', 'business'] where id = ${storeId}::uuid`);
    expect((await controlCenter(account, slug)).stores[0]).toMatchObject({ companiesFlagged: { n: 1, first: String(company.id) } });
    await db().execute(sql`update commerce.stores set features = array['shop'] where id = ${storeId}::uuid`);
    expect((await controlCenter(account, slug)).stores[0]).not.toHaveProperty("companiesFlagged");
  });

  it("asks a register that does not answer only once a run", async () => {
    await db().execute(sql`delete from commerce.register_companies where organisation_number in (${COMPANY}, ${SOLE}, ${MISSING})`);
    let calls = 0;
    const down = (async () => {
      calls++;
      throw new Error("connect ECONNREFUSED");
    }) as typeof globalThis.fetch;
    const out = await watchRegister({ fetch: down, now: NOW });
    expect(calls).toBe(1);
    expect(out.added).toBe(0);
  });
});
