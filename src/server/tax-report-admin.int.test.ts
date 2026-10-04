import { sql } from "drizzle-orm";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FormState } from "@/components/admin/action-form";
import { closeDb, db } from "@/db/client";

import { addMember, auditRows, fakeAuthState, fakeSupabase, linkAuthUser, makeAccount } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
const auth = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => auth.client }));

const t = await import("./tax-reports-fixture");
const roles = await import("./store-roles");
const page = await import("../app/admin/(gated)/[store]/analytics/tax/page");
const loading = await import("../app/admin/(gated)/[store]/analytics/tax/loading");
const actions = await import("../app/admin/(gated)/[store]/analytics/tax/actions");
const exportRoute = await import("../app/admin/(gated)/[store]/analytics/tax/export/route");

type Row = Record<string, unknown>;

/**
 * The admin side of the VAT, OSS and IOSS reports (D161, `docs/wave-1c-reports.md` 5.3), against a real database and the real permission guards
 * (a stand-in for the sign-in only): the page is for members who may read analytics, the files are a POST for members who may write it, the
 * euro rates are the owner's, nothing of another store's is reachable, and a refusal goes back to the page with a fixed sentence.
 */

let own: Awaited<ReturnType<typeof t.sellerStore>>;
let other: Awaited<ReturnType<typeof t.sellerStore>>;
let ownerSub: string;
let writerSub: string;
let readerSub: string;
let strangerSub: string;

const signInAs = (sub: string | null) => {
  auth.client = fakeSupabase(fakeAuthState({ sub }));
};

const formOf = (values: Record<string, string>) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
};
const idle: FormState = { status: "idle", messages: [] };

const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) }) as never;

/** The page as the server draws it, as text: tags kept, entities undone. */
async function open(slug: string, search: Record<string, string> = {}): Promise<string> {
  const element = await page.default({ params: Promise.resolve({ store: slug }), searchParams: Promise.resolve(search) } as never);
  return renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}

const post = (slug: string, values: Record<string, string>, headers: Record<string, string> = { origin: "http://localhost", host: "localhost" }) =>
  exportRoute.POST(new Request(`http://localhost/admin/${slug}/analytics/tax/export`, { method: "POST", body: formOf(values), headers }) as never, ctx({ store: slug }));

const logRows = (storeId: string) =>
  db().execute<Row>(sql`select report, scheme, period_key, mode, rows, totals from commerce.tax_report_exports where store_id = ${storeId}::uuid order by exported_at, id`);

const Q3 = { kind: "oss", period: "2026-Q3", mode: "filing" };
const Q2 = { kind: "oss", period: "2026-Q2", mode: "filing" };
const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30", period: "custom" };

beforeAll(async () => {
  await t.insertEcb("2026-09-30", t.ECB_2026_09_30);
  own = await t.sellerStore("tax-adm");
  // September: a German and a Danish order. May: a Danish order whose quarter's last day has no stored euro rate.
  await t.paidOn(own, "2026-09-12", [["DEMO-MUG-WHITE", 1]], { market: t.markets.de });
  await t.paidOn(own, "2026-09-12", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk });
  await t.paidOn(own, "2026-05-10", [["DEMO-MUG-WHITE", 1]], { market: t.markets.dk });
  await t.issueBackdated(own.storeId);
  other = await t.sellerStore("tax-adm-other");

  ownerSub = await linkAuthUser(own.ownerId);
  await roles.ensureStoreRoles(own.storeId);
  const role = async (template: string) => String((await db().execute<Row>(sql`select id from commerce.store_roles where store_id = ${own.storeId}::uuid and template = ${template}`))[0].id);
  const writer = await makeAccount("writer");
  writerSub = await linkAuthUser(writer.id);
  await addMember(own.storeId, writer.id, "admin", { roleId: await role("analytics") });
  const reader = await makeAccount("reader");
  readerSub = await linkAuthUser(reader.id);
  await addMember(own.storeId, reader.id, "admin", { roleId: await role("read_only") });
  const stranger = await makeAccount("stranger");
  strangerSub = await linkAuthUser(stranger.id);
  await addMember(other.storeId, stranger.id, "owner");
}, 120_000);

beforeEach(() => {
  signInAs(ownerSub);
});

afterAll(async () => {
  await closeDb();
});

describe("the page", () => {
  it("shows an owner the OSS view of the worked example: Part 2b in euro at the ECB rate, Part 5 as the total due, and the line that this is not a tax return", async () => {
    const out = await open(own.slug, { view: "oss", quarter: "2026-Q3" });
    expect(out).toContain("They are not a tax return and Kaizen files nothing.");
    expect(out).toContain("OSS return for Q3 2026");
    expect(out).toContain("€52.44");
    expect(out).toContain("€133.77");
    expect(out).toContain("€33.44");
    expect(out).toContain("7.4755");
    expect(out).toContain("Q3 2026: submit and pay by 31 October 2026.");
    // Owner: the files and the rate forms.
    expect(out).toContain('name="kind" value="oss"');
    expect(out).toContain('name="kind" value="oss_detail"');
    expect(out).toContain("Enter a rate");
  });

  it("opens on the last completed quarter and filing mode when the address says nothing but the view", async () => {
    const out = await open(own.slug, { view: "oss" });
    expect(out).toContain("OSS return for Q3 2026");
    expect(out).toContain("Filing mode shows what a return for the period holds");
  });

  it("shows the VAT view for a range, with the table, the chart's data, the reconciliation, and nothing of another store", async () => {
    const out = await open(own.slug, SEPTEMBER);
    expect(out).toContain("VAT by country and rate");
    expect(out).toContain("OSS Union scheme, part 2b");
    expect(out).toContain(">DE<");
    expect(out).toContain(">DK<");
    expect(out).toContain("Made from 2 invoices and 0 credit notes.");
    expect(out).toContain("Reconciliation");
    expect(out).toContain("Equal: every difference is named.");
    expect(out).toContain("Data behind the chart");
    expect(out).toContain('name="kind" value="vat"');
    expect(out).toContain('name="last" value="2026-09-30"');
    // The picker has no comparison control, and its links name their period.
    expect(out).not.toContain("Compare with");
    expect(out).toContain("period=30d");
  });

  it("opens the VAT view on the last month when the address names no period", async () => {
    const out = await open(own.slug);
    expect(out).toContain("1 Sep – 30 Sep 2026");
    expect(out).toContain("Made from 2 invoices and 0 credit notes.");
  });

  it("says IOSS is off, with the reason and the settings, for a store with no number and no marked sale, and offers no file", async () => {
    const out = await open(own.slug, { view: "ioss", month: "2026-09" });
    expect(out).toContain("IOSS is off");
    expect(out).toContain("Needs an IOSS number and the markets it applies to");
    expect(out).toContain(`/admin/${own.slug}/settings/tax`);
    expect(out).not.toContain("analytics/tax/export");
  });

  it("says an OSS quarter with a currency whose rate is not stored is incomplete, holds the return data back and offers the owner a way out", async () => {
    const out = await open(own.slug, { view: "oss", quarter: "2026-Q2" });
    expect(out).toContain("This return is incomplete");
    expect(out).toContain("DKK on 30 June 2026");
    expect(out).toContain("Fetch from the ECB");
    expect(out).toMatch(/<button type="submit" disabled=""[^>]*>Export OSS return data \(CSV\)<\/button>/);
  });

  it("is for a member who may read analytics: the figures, no files and no rate forms for a read-only member", async () => {
    signInAs(readerSub);
    const vat = await open(own.slug, SEPTEMBER);
    expect(vat).toContain("VAT by country and rate");
    expect(vat).toContain("Exports need the analytics role with write access.");
    expect(vat).not.toContain("analytics/tax/export");
    const oss = await open(own.slug, { view: "oss", quarter: "2026-Q2" });
    expect(oss).not.toContain("Fetch from the ECB");
    expect(oss).not.toContain('name="reason"');
    expect(oss).toContain("Only an owner can fetch a rate from the ECB or enter one.");
    expect(oss).not.toContain("analytics/tax/export");
  });

  it("gives a member with analytics write access the files but not the rate forms: those are the owner's", async () => {
    signInAs(writerSub);
    const out = await open(own.slug, { view: "oss", quarter: "2026-Q3" });
    expect(out).toContain('name="kind" value="oss"');
    expect(out).not.toContain("Enter a rate");
    expect(out).not.toContain('name="reason"');
  });

  it("is a 404 for a stranger and a redirect or 404 for nobody signed in, and a stranger's own store shows only its own figures", async () => {
    signInAs(strangerSub);
    await expect(open(own.slug, SEPTEMBER)).rejects.toThrow("NEXT_NOT_FOUND");
    const theirs = await open(other.slug, SEPTEMBER);
    expect(theirs).toContain("No invoice or credit note is dated in this period");
    expect(theirs).not.toContain(">DK<");
    signInAs(null);
    await expect(open(own.slug, SEPTEMBER)).rejects.toThrow(/REDIRECT|NEXT_NOT_FOUND/);
  });

  it("turns the export problem of the address into a fixed sentence, and never writes anything else from the address", async () => {
    const known = await open(own.slug, { view: "oss", quarter: "2026-Q2", export: "incomplete" });
    expect(known).toContain("No file was made");
    expect(known).toContain("The return data was not exported: it is incomplete.");
    const unknown = await open(own.slug, { ...SEPTEMBER, export: "<script>alert(1)</script>" });
    expect(unknown).not.toContain("No file was made");
    expect(unknown).not.toContain("alert(1)");
    const junk = await open(own.slug, { view: "<img src=x>", quarter: "<b>", mode: "<i>" });
    expect(junk).not.toContain("<img src=x>");
    expect(junk).not.toContain("<b>");
  });

  it("has a loading placeholder in the admin's own style", () => {
    const out = renderToString(loading.default());
    expect(out).toContain("animate-pulse");
    expect(out).toContain("Not a tax return");
  });
});

describe("the files", () => {
  it("serve the OSS return data to a member with write access as a CSV download that is never cached, log it, and write it to the activity log without amounts", async () => {
    signInAs(writerSub);
    const before = (await logRows(own.storeId)).length;
    const response = await post(own.slug, Q3);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="oss-${own.slug}-2026-Q3-filing.csv"`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes).slice(1);
    expect(body.split("\r\n")[0]).toBe("scheme,tax_period,part,member_state_of_consumption,dispatch_member_state,vat_rate_percent,rate_kind,taxable_amount_eur,vat_amount_eur,correction_period,mode,registration,currency");
    expect(body).toContain("union,2026-Q3,2b,DK,SE,25,standard,133.77,33.44,,filing,union,EUR");
    expect(body).toContain("union,2026-Q3,5,,,,,,52.44,,filing,union,EUR");
    const rows = await logRows(own.storeId);
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)).toMatchObject({ report: "oss", scheme: "union", period_key: "2026-Q3", mode: "filing" });
    const audits = await auditRows(own.storeId, "analytics.tax_report_exported");
    expect(JSON.stringify(audits.at(-1)?.details)).not.toContain("52.44");
  });

  it("serve the VAT report of a range and the reconciliation, and the conversion detail", async () => {
    const vat = await post(own.slug, { kind: "vat", from: "2026-09-01", last: "2026-09-30" });
    expect(vat.status).toBe(200);
    expect(vat.headers.get("Content-Disposition")).toBe(`attachment; filename="vat-${own.slug}-2026-09-01_2026-09-30.csv"`);
    expect(await vat.text()).toContain("period_from,period_to,country,vat_rate_percent");
    const reconciliation = await post(own.slug, { kind: "reconciliation", from: "2026-09-01", last: "2026-09-30" });
    expect(reconciliation.status).toBe(200);
    expect(await reconciliation.text()).toContain("period_from,period_to,currency,cause,direction,orders,vat_original");
    const detail = await post(own.slug, { ...Q3, kind: "oss_detail" });
    expect(detail.status).toBe(200);
    expect(detail.headers.get("Content-Disposition")).toContain(`oss-detail-${own.slug}-2026-Q3-filing.csv`);
  });

  it("are a 404 for a member who may only read, for a stranger and for nobody signed in, and write nothing", async () => {
    const before = (await logRows(own.storeId)).length;
    for (const sub of [readerSub, strangerSub, null]) {
      signInAs(sub);
      expect((await post(own.slug, Q3)).status).toBe(404);
    }
    expect((await logRows(own.storeId)).length).toBe(before);
  });

  it("are a 403 from another site: they come only from the admin itself", async () => {
    const before = (await logRows(own.storeId)).length;
    expect((await post(own.slug, Q3, { origin: "https://evil.example", host: "localhost" })).status).toBe(403);
    expect((await logRows(own.storeId)).length).toBe(before);
  });

  it("are the store's own: another store's owner exporting from their own store gets their own, empty, figures", async () => {
    signInAs(strangerSub);
    const response = await post(other.slug, { kind: "vat", from: "2026-09-01", last: "2026-09-30" });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain(",DK,");
    expect(body.trim().split("\r\n")).toHaveLength(1);
  });

  it("send the person back with a code, never a file, for a period it cannot read", async () => {
    for (const values of [{ kind: "vat", from: "2026-10-10", last: "2026-10-01" }, { kind: "oss", period: "2026-09" }, { kind: "ioss", period: "2026-Q3" }, { kind: "everything" }, {}]) {
      const response = await post(own.slug, values as Record<string, string>);
      expect(response.status).toBe(303);
      expect(new URL(response.headers.get("location")!).searchParams.get("export")).toBe("period");
    }
    const vat = await post(own.slug, { kind: "vat", from: "2020-01-01", last: "2026-10-01" });
    const location = new URL(vat.headers.get("location")!);
    expect(location.pathname).toBe(`/admin/${own.slug}/analytics/tax`);
  });

  it("refuse an incomplete return with a code, log nothing, and still serve its conversion detail, which shows the gap", async () => {
    const before = (await logRows(own.storeId)).length;
    const refused = await post(own.slug, Q2);
    expect(refused.status).toBe(303);
    const location = new URL(refused.headers.get("location")!);
    expect(location.pathname).toBe(`/admin/${own.slug}/analytics/tax`);
    expect(location.searchParams.get("view")).toBe("oss");
    expect(location.searchParams.get("quarter")).toBe("2026-Q2");
    expect(location.searchParams.get("export")).toBe("incomplete");
    expect((await logRows(own.storeId)).length).toBe(before);
    const detail = await post(own.slug, { ...Q2, kind: "oss_detail" });
    expect(detail.status).toBe(200);
    expect((await logRows(own.storeId)).length).toBe(before + 1);
  });
});

describe("the euro rates", () => {
  it("are the owner's: a member who is not an owner, a stranger and nobody signed in are refused, and nothing is stored or logged", async () => {
    const before = await db().execute<Row>(sql`select count(*)::int as n from commerce.tax_rate_overrides where store_id = ${own.storeId}::uuid`);
    const values = { currency: "DKK", day: "2026-06-30", rate: "7.46", reason: "The accountant's rate for the quarter" };
    for (const sub of [writerSub, readerSub, strangerSub, null]) {
      signInAs(sub);
      expect(await actions.setRateOverrideAction(own.slug, idle, formOf(values))).toEqual({ status: "error", messages: ["You do not have access to this."] });
      expect(await actions.fetchEcbRateAction(own.slug, idle, formOf({ currency: "DKK", day: "2026-09-30" }))).toEqual({ status: "error", messages: ["You do not have access to this."] });
    }
    const after = await db().execute<Row>(sql`select count(*)::int as n from commerce.tax_rate_overrides where store_id = ${own.storeId}::uuid`);
    expect(after[0].n).toBe(before[0].n);
    expect(await auditRows(own.storeId, "analytics.tax_rate_override_set")).toEqual([]);
  });

  it("let an owner fetch the ECB's rate: a day already stored answers from the table, never from the network", async () => {
    const result = await actions.fetchEcbRateAction(own.slug, idle, formOf({ currency: "DKK", day: "2026-09-30" }));
    expect(result).toEqual({ status: "ok", messages: ["The ECB's rate for 2026-09-30 was already stored: 7.4755."] });
  });

  it("answer a fetch that cannot be done in plain words, and change nothing", async () => {
    expect(await actions.fetchEcbRateAction(own.slug, idle, formOf({ currency: "DKK", day: "2999-01-01" }))).toMatchObject({ status: "error", messages: ["That day has not come yet."] });
    expect(await actions.fetchEcbRateAction(own.slug, idle, formOf({ currency: "EUR", day: "2026-09-30" }))).toMatchObject({ status: "error" });
    expect(await actions.fetchEcbRateAction(own.slug, idle, formOf({ currency: "DKK", day: "not a day" }))).toMatchObject({ status: "error" });
    expect(await actions.fetchEcbRateAction(own.slug, idle, formOf({}))).toMatchObject({ status: "error" });
  });

  it("let an owner enter a rate with a reason: it makes the incomplete quarter whole, is shown with its reason, and is written to the activity log", async () => {
    const result = await actions.setRateOverrideAction(own.slug, idle, formOf({ currency: "DKK", day: "2026-06-30", rate: "7,46", reason: "The accountant's rate for the quarter" }));
    expect(result).toEqual({ status: "ok", messages: ["Saved your rate for DKK on 2026-06-30: 7.46."] });
    const out = await open(own.slug, { view: "oss", quarter: "2026-Q2" });
    expect(out).not.toContain("This return is incomplete");
    expect(out).toContain("Owner's rate: The accountant's rate for the quarter");
    expect(out).toContain("Change your rate");
    const [audit] = await auditRows(own.storeId, "analytics.tax_rate_override_set");
    expect(audit).toMatchObject({ area: "analytics" });
    expect(audit.details).toMatchObject({ currency: "DKK", day: "2026-06-30", rate: "7.46", previous: null });
    // And now the return data can be exported.
    expect((await post(own.slug, Q2)).status).toBe(200);
  });

  it("answer a rate that is not a rate, a reason that is too short, or a day that has not come, with the reasons, and store nothing", async () => {
    const bad = await actions.setRateOverrideAction(own.slug, idle, formOf({ currency: "DKK", day: "2026-09-30", rate: "free", reason: "short" }));
    expect(bad.status).toBe("error");
    expect(bad.messages.join(" ")).toMatch(/rate is a positive number/);
    expect(bad.messages.join(" ")).toMatch(/at least 10 characters/);
    const future = await actions.setRateOverrideAction(own.slug, idle, formOf({ currency: "DKK", day: "2999-01-01", rate: "7.5", reason: "A rate for the future" }));
    expect(future.status).toBe("error");
    const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.tax_rate_overrides where store_id = ${own.storeId}::uuid and rate_date = '2026-09-30'`);
    expect(row.n).toBe(0);
  });

  it("are the store's own: another store's owner enters a rate for their store only", async () => {
    signInAs(strangerSub);
    expect(await actions.setRateOverrideAction(other.slug, idle, formOf({ currency: "DKK", day: "2026-06-30", rate: "9", reason: "Their own accountant's rate" })).then((r) => r.status)).toBe("ok");
    signInAs(ownerSub);
    const out = await open(own.slug, { view: "oss", quarter: "2026-Q2" });
    expect(out).toContain("7.46");
    expect(out).not.toContain("Their own accountant");
  });
});

describe("a period that changed after it was exported", () => {
  it("says so on the OSS view once the rate it was made with is changed, as advice and not as a block", async () => {
    signInAs(ownerSub);
    expect((await post(own.slug, Q3)).status).toBe(200);
    const quiet = await open(own.slug, { view: "oss", quarter: "2026-Q3" });
    expect(quiet).toContain("Last exported on");
    expect(quiet).not.toContain("This period has changed since you exported it");
    // The accountant uses another rate for the quarter: the figures move by 0.11 euro.
    expect((await actions.setRateOverrideAction(own.slug, idle, formOf({ currency: "DKK", day: "2026-09-30", rate: "7.5", reason: "The accountant's rate for the quarter" }))).status).toBe("ok");
    const changed = await open(own.slug, { view: "oss", quarter: "2026-Q3" });
    expect(changed).toContain("This period has changed since you exported it");
    expect(changed).toContain("VAT -€0.11");
    expect(changed).toContain("belongs in your next return as a correction");
    expect(changed).toContain("Owner's rate: The accountant's rate for the quarter");
    // Exporting again is allowed, and the new figures are what the next change is compared with.
    expect((await post(own.slug, Q3)).status).toBe(200);
    expect(await open(own.slug, { view: "oss", quarter: "2026-Q3" })).not.toContain("This period has changed since you exported it");
  });

  it("says so on the VAT view when an invoice is dated into a range after the range was exported", async () => {
    expect((await post(own.slug, { kind: "vat", from: "2026-09-01", last: "2026-09-30" })).status).toBe(200);
    expect(await open(own.slug, SEPTEMBER)).not.toContain("This period has changed since you exported it");
    // A third order, paid on 20 September and invoiced afterwards (invoicing is switched off while it is paid, so the invoice waits).
    await db().execute(sql`update commerce.invoice_settings set enabled = false where store_id = ${own.storeId}::uuid`);
    await t.paidOn(own, "2026-09-20", [["DEMO-MUG-WHITE", 1]], { market: t.markets.de });
    await t.issueBackdated(own.storeId);
    const out = await open(own.slug, SEPTEMBER);
    expect(out).toContain("Made from 3 invoices and 0 credit notes.");
    expect(out).toContain("This period has changed since you exported it");
  });
});
