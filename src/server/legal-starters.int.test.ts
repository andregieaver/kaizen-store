import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent } from "@/lib/page-content";

import { addMember, auditRows, makeAccount, makeStore, membershipOf, run } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const ls = await import("./legal-starters");
const pages = await import("./pages");
const stores = await import("./stores");
const seo = await import("./seo");
const exps = await import("./experiment-admin");
const facts = await import("./legal-facts");

type Row = Record<string, unknown>;

/**
 * The legal pages screen's server side (wave 1, 1e, docs/wave-1-trust.md 2.1): a starter is a draft made from the store's own facts in its main
 * language with the other languages among the four written as translations, never published and never over an existing page; a legal role is a
 * published page at its own address that stays in the sitemap and is never tested; and what checkout says about the terms.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let owner: Awaited<ReturnType<typeof membershipOf>>;

async function reload() {
  owner = await membershipOf(store.slug, store.account, "owner");
  return owner;
}

beforeAll(async () => {
  store = await makeStore("legal");
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
    select ${store.id}::uuid, code, currency, default_locale, locales, true from commerce.countries where code in ('NO', 'SE') on conflict do nothing
  `);
  await db().execute(sql`
    update commerce.stores set country = 'NO', legal_name = 'Kaizen Keramikk AS', organisation_number = '999 888 777', contact_email = 'butikk@keramikk.example',
      postal_address = 'Storgata 1, 0155 Oslo', locales = array['nb-NO', 'en-GB'] where id = ${store.id}::uuid
  `);
  await reload();
});

afterAll(async () => {
  await closeDb();
});

const contentOf = async (id: string) => (await pages.getPageForEdit(store.id, id))!;
const text = (value: unknown) => JSON.stringify(value);

describe("making a starter", () => {
  it("makes a draft in the main language with the store's facts, the review notice first, and the other languages as translations of the same blocks", async () => {
    const made = await ls.createLegalStarter(owner, "terms");
    if (!made.ok) throw new Error(made.problems.join());
    expect(made).toMatchObject({ language: "nb", translatedNotice: false });
    expect(made.slug).toBe("kjopsvilkar");
    // English (chosen), then Swedish and Danish (the store's other markets' own languages) are written too.
    expect([...made.translations].sort()).toEqual(["da-DK", "en-GB", "sv-SE"]);
    const page = await contentOf(made.id);
    expect(page.state).toBe("draft");
    expect(page.draft.title).toBe("Kjøpsvilkår");
    const body = text(page.draft.rows);
    expect(body).toContain("Kaizen Keramikk AS");
    expect(body).toContain("999 888 777");
    expect(body).toContain("butikk@keramikk.example");
    expect(body).toContain("legal-review-notice");
    // A fact the store does not hold is a visible placeholder, never an invented sentence.
    expect(body).toContain("[[");
    expect(page.draft.translations?.["en-GB"]).toBeTruthy();
    expect(Object.keys(page.draft.translations?.["sv-SE"] ?? {}).length).toBeGreaterThan(5);
    // The English words are over the same blocks: the title is translated.
    expect(page.draft.translations?.["en-GB"]?.title).toBe("Terms of sale");
    const [log] = (await auditRows(store.id, "store.legal_starter_made")).slice(-1);
    expect(log).toMatchObject({ area: "website", target_type: "page", target_id: made.id, details: { role: "terms", page: made.id, language: "nb" } });
  });

  it("is never published and is out of the published pages until the owner publishes it", async () => {
    const made = await ls.createLegalStarter(owner, "privacy");
    if (!made.ok) throw new Error("starter");
    const [row] = await db().execute<Row>(sql`select published_at from commerce.pages where id = ${made.id}::uuid`);
    expect(row.published_at).toBeNull();
    expect((await pages.listPublishedPages(store.id)).some((p) => p.id === made.id)).toBe(false);
    expect(await pages.findPublishedPage(store.id, made.slug)).toBeNull();
  });

  it("makes another draft each time and never touches the first", async () => {
    const first = await ls.createLegalStarter(owner, "returns_policy");
    const second = await ls.createLegalStarter(owner, "returns_policy");
    if (!first.ok || !second.ok) throw new Error("starter");
    expect(second.id).not.toBe(first.id);
    expect(second.slug).toBe(`${first.slug}-2`);
    const before = await contentOf(first.id);
    await ls.createLegalStarter(owner, "returns_policy");
    expect((await contentOf(first.id)).updatedAt).toBe(before.updatedAt);
  });

  it("makes all six kinds", async () => {
    for (const kind of ["terms", "privacy", "returns_policy", "shipping_policy", "withdrawal_info", "imprint"] as const) {
      const made = await ls.createLegalStarter(owner, kind);
      expect(made.ok).toBe(true);
    }
    expect(await ls.createLegalStarter(owner, "accessibility" as never)).toEqual({ ok: false, problems: ["That kind of page has no starter."] });
  });

  it("fills the facts from the database: the shipping rate of each market, the return window, who pays and the carriers", async () => {
    await db().execute(sql`delete from commerce.shipping_rates where store_id = ${store.id}::uuid`);
    await db().execute(sql`insert into commerce.shipping_rates (store_id, market_code, currency, amount_minor, free_over_minor) values (${store.id}::uuid, 'NO', 'NOK', 7900, 100000), (${store.id}::uuid, 'SE', 'SEK', 9900, null)`);
    await db().execute(sql`
      insert into commerce.return_settings (store_id, window_days, who_pays_return, refund_when) values (${store.id}::uuid, 30, 'store', 'request')
      on conflict (store_id) do update set window_days = 30, who_pays_return = 'store', refund_when = 'request'
    `);
    const live = (await stores.getStore(store.slug))!;
    const f = await facts.legalFacts(live);
    expect(f.shipping.find((s) => s.code === "NO")).toMatchObject({ rateMinor: 7900, freeAboveMinor: 100000, currency: "NOK" });
    expect(f.shipping.find((s) => s.code === "SE")).toMatchObject({ rateMinor: 9900, freeAboveMinor: null });
    expect(f.returns).toMatchObject({ windowDays: 30, whoPays: "store", refundWhen: "request" });
    expect(f.legalName).toBe("Kaizen Keramikk AS");
    expect(f.links.withdraw).toMatch(/\/no\/withdraw$/);
    // The VAT number is the hook the lead replaces at the merge: no tax profile in this lane.
    expect(f.vat).toEqual({ number: null, registered: null });
    expect(await facts.taxFactsOf(store.id)).toBeNull();
    const shipping = await ls.createLegalStarter(await reload(), "shipping_policy");
    const returns = await ls.createLegalStarter(owner, "returns_policy");
    if (!shipping.ok || !returns.ok) throw new Error("starter");
    const body = text((await contentOf(shipping.id)).draft.rows);
    // The amounts are formatted for the language (a non-breaking space between the figure and the currency).
    expect(body).toMatch(/Norge: 79,00.kr, og gratis for bestillinger over 1.000,00.kr\./);
    expect(body).toMatch(/Sverige: 99,00.SEK\./);
    const policy = text((await contentOf(returns.id)).draft.rows);
    expect(policy).toMatch(/30 dager/);
  });

  it("for a main language outside the four makes it in English with the notice saying so, and writes no translations", async () => {
    const german = await makeStore("legal-de");
    await db().execute(sql`
      insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
      select ${german.id}::uuid, code, currency, default_locale, locales, true from commerce.countries where code in ('NO') on conflict do nothing
    `);
    await db().execute(sql`update commerce.stores set country = 'NO', locales = array['de-DE'], legal_name = 'Keramik GmbH' where id = ${german.id}::uuid`);
    const member = await membershipOf(german.slug, german.account, "owner");
    const made = await ls.createLegalStarter(member, "terms");
    if (!made.ok) throw new Error(made.problems.join());
    expect(made).toMatchObject({ language: "en", translatedNotice: true, translations: [] });
    const page = (await pages.getPageForEdit(german.id, made.id))!;
    expect(page.draft.title).toBe("Terms of sale");
    expect(page.draft.translations).toBeUndefined();
    expect(text(page.draft.rows)).toMatch(/translated|reviewed/i);
  });

  it("is for owners only", async () => {
    const admin = await makeAccount("legal-admin");
    await addMember(store.id, admin.id, "admin");
    const member = await membershipOf(store.slug, admin, "admin");
    expect(await ls.createLegalStarter(member, "terms")).toEqual({ ok: false, problems: ["You do not have access to this."] });
    expect(await ls.setLegalRole(member, "terms", null)).toEqual({ ok: false, problems: ["You do not have access to this."] });
    expect(await ls.setTermsMode(member, "off")).toEqual({ ok: false, problems: ["You do not have access to this."] });
  });
});

describe("publishing a starter and choosing it", () => {
  let termsId: string;
  let slug: string;

  it("asks before publishing when the placeholders were filled in the main language only: the translations the shoppers read still hold them", async () => {
    const made = await ls.createLegalStarter(await reload(), "imprint");
    if (!made.ok) throw new Error("starter");
    const page = await contentOf(made.id);
    expect(JSON.stringify(page.draft.translations)).toContain("[[");
    // The owner fills every bracket in the Norwegian text and deletes the notice, and leaves the English and the other translations as they were.
    const rows = JSON.parse(JSON.stringify(page.draft.rows).replace(/\[\[[^\]]*\]\]/g, "fylt inn")) as typeof page.draft.rows;
    const edited = { ...page.draft, rows: rows.filter((row) => !JSON.stringify(row).includes("legal-review-notice")) };
    expect(JSON.stringify(edited.rows)).not.toContain("[[");
    const held = await pages.savePage(owner.account, store.id, made.id, edited, { publish: true });
    expect(held).toMatchObject({ ok: false, code: "needs_confirmation" });
    if (held.ok || !held.issues) throw new Error("issues");
    expect(held.issues.map((i) => i.rule)).toEqual(expect.arrayContaining(["placeholder"]));
    expect(held.issues.some((i) => /translation/.test(i.message))).toBe(true);
    expect((await contentOf(made.id)).state).toBe("draft");
    // With the translations cleaned of brackets too, it publishes without a question.
    const clean = { ...edited, translations: JSON.parse(JSON.stringify(edited.translations).replace(/\[\[[^\]]*\]\]/g, "filled in")) };
    expect(await pages.savePage(owner.account, store.id, made.id, clean, { publish: true })).toMatchObject({ ok: true });
  });

  it("asks before publishing: the notice and the placeholders are blocking issues, and nothing is published without the owner's yes", async () => {
    const made = await ls.createLegalStarter(await reload(), "terms");
    if (!made.ok) throw new Error("starter");
    termsId = made.id;
    slug = made.slug;
    const page = await contentOf(made.id);
    const held = await pages.savePage(owner.account, store.id, made.id, page.draft, { publish: true });
    expect(held).toMatchObject({ ok: false, code: "needs_confirmation" });
    if (held.ok || !held.issues) throw new Error("issues");
    expect([...new Set(held.issues.map((i) => i.rule))]).toEqual(expect.arrayContaining(["legal_notice", "placeholder"]));
    expect((await contentOf(made.id)).state).toBe("draft");
    const ok = await pages.savePage(owner.account, store.id, made.id, page.draft, { publish: true, acknowledgedIssues: ["legal_notice", "placeholder", "contrast", "image_alt", "empty_link", "heading_empty"] });
    expect(ok).toMatchObject({ ok: true });
    expect((await contentOf(made.id)).state).toBe("published");
    const log = (await auditRows(store.id, "store.page_published_with_issues")).at(-1)!;
    expect(log.details).toMatchObject({ page: made.id, issues: expect.arrayContaining([{ rule: "legal_notice", count: 1 }]) });
    // Counts only: not one word of the page.
    expect(JSON.stringify(log)).not.toContain("Kaizen Keramikk");
  });

  it("refuses a draft as a role, then makes the published page the terms, served at its own address and linked in the store's legal pages", async () => {
    const draft = await ls.createLegalStarter(owner, "privacy");
    if (!draft.ok) throw new Error("starter");
    expect(await ls.setLegalRole(owner, "privacy", draft.id)).toMatchObject({ ok: false, problems: [expect.stringContaining("Publish the page")] });
    expect(await ls.setLegalRole(owner, "terms", termsId)).toEqual({ ok: true });
    const live = (await stores.getStore(store.slug))!;
    expect(live.legalPages).toEqual({ terms: termsId });
    expect(live.pageRoles).toEqual({});
    // At its own address: the role does not redirect it.
    expect(await pages.findPublishedPage(store.id, slug)).toMatchObject({ page: { id: termsId } });
    const [log] = (await auditRows(store.id, "store.legal_role_changed")).slice(-1);
    expect(log).toMatchObject({ area: "website", target_type: "page", target_id: termsId, details: { role: "terms" } });
  });

  it("stays in the sitemap's pages once published, where a page chosen for a D112 role does not", async () => {
    const roleDraft = await pages.savePage(owner.account, store.id, null, { ...newPageContent(), title: "Blog home", slug: `bloghome-${run}` }, { publish: true });
    if (!roleDraft.ok) throw new Error("page");
    await pages.setPageRole(owner.account, store.id, "blog", roleDraft.id);
    const listed = (await seo.listPublicStores()).find((s) => s.id === store.id)!;
    expect(listed.rolePageIds).toContain(roleDraft.id);
    expect(listed.rolePageIds).not.toContain(termsId);
  });

  it("gives a page one place only: not a second role, not the front page, not All products", async () => {
    expect(await ls.setLegalRole(owner, "privacy", termsId)).toMatchObject({ ok: false, problems: [expect.stringContaining("terms of sale")] });
    await pages.setFrontPage(owner.account, store.id, null);
    const other = await pages.savePage(owner.account, store.id, null, { ...newPageContent(), title: "Front", slug: `front-${run}` }, { publish: true });
    if (!other.ok) throw new Error("page");
    await pages.setFrontPage(owner.account, store.id, other.id);
    expect(await ls.setLegalRole(owner, "imprint", other.id)).toMatchObject({ ok: false, problems: [expect.stringContaining("front page")] });
    expect(await ls.setLegalRole(owner, "terms", "55555555-5555-4555-8555-555555555555")).toMatchObject({ ok: false, problems: [expect.stringContaining("no longer exists")] });
  });

  it("is never the target of an A/B test, in the admin's check and in the database", async () => {
    expect(await exps.createExperiment(owner.account, store.id, { name: "Test terms", pageId: termsId, goal: "orders" })).toMatchObject({ ok: false, problems: [expect.stringContaining("legal page is never tested")] });
    await expect(
      db().execute(sql`insert into commerce.experiments (store_id, name, hypothesis, target_page_id, primary_goal, goal_params, traffic_share, audience, min_days, min_visitors) values (${store.id}::uuid, 'x', '', ${termsId}::uuid, 'orders', '{}'::jsonb, 1, '{}'::jsonb, 7, 0)`),
    ).rejects.toThrow();
  });

  it("cannot be given a legal role while it is in a running test", async () => {
    const heading = (text: string) => ({ id: crypto.randomUUID(), type: "row" as const, layout: "1" as const, columns: [{ id: crypto.randomUUID(), blocks: [{ id: crypto.randomUUID(), type: "heading" as const, level: 2 as const, text }] }] });
    const page = await pages.savePage(owner.account, store.id, null, { ...newPageContent(), title: "Imprint draft", slug: `imprint-${run}`, rows: [heading("Who we are")] }, { publish: true });
    if (!page.ok) throw new Error("page");
    const test = await exps.createExperiment(owner.account, store.id, { name: "Test imprint", pageId: page.id, goal: "orders" });
    if (!test.ok) throw new Error(test.problems.join());
    // Version B must differ from the original before a test may start.
    const info = (await exps.getExperiment(store.id, test.id))!;
    const versionId = info.variants.find((v) => v.key === "b")!.pageId!;
    const version = (await pages.getPageForEdit(store.id, versionId, "variant"))!;
    const changed = await pages.savePage(owner.account, store.id, versionId, { ...version.draft, title: "Imprint (B)", rows: [...version.draft.rows, heading("Who we really are")] }, { publish: true, type: "variant", variantOf: "page" });
    if (!changed.ok) throw new Error(changed.problems.join());
    const started = await exps.startExperiment(owner.account, store.id, test.id);
    if (!started.ok) throw new Error(started.problems.join());
    expect(await ls.setLegalRole(owner, "imprint", page.id)).toMatchObject({ ok: false, problems: [expect.stringContaining("A/B test")] });
  });

  it("is let go with null, and the checkout then names no page for it", async () => {
    expect(await ls.setLegalRole(owner, "terms", null)).toEqual({ ok: true });
    expect((await stores.getStore(store.slug))!.legalPages).toEqual({});
    expect(await ls.setLegalRole(owner, "blog" as never, null)).toEqual({ ok: false, problems: ["That is not a legal page."] });
  });
});

describe("what checkout says about the terms", () => {
  it("cannot be a tick box while no published terms page is chosen, and is saved once one is", async () => {
    const solo = await makeStore("legal-mode");
    const member = await membershipOf(solo.slug, solo.account, "owner");
    expect(await ls.setTermsMode(member, "checkbox")).toMatchObject({ ok: false, problems: [expect.stringContaining("terms page")] });
    expect(await ls.setTermsMode(member, "bogus")).toEqual({ ok: false, problems: ["Choose link, tick box or off."] });
    expect(await ls.setTermsMode(member, "off")).toEqual({ ok: true });
    expect((await stores.getStore(solo.slug))!.termsAtCheckout).toBe("off");
    expect((await auditRows(solo.id, "store.terms_mode_changed")).at(-1)).toMatchObject({ area: "website".replace("website", "settings"), changes: { termsAtCheckout: { from: "link", to: "off" } } });
    // The same again writes nothing.
    expect(await ls.setTermsMode(member, "off")).toEqual({ ok: true });
    expect(await auditRows(solo.id, "store.terms_mode_changed")).toHaveLength(1);
    const page = await pages.savePage(member.account, solo.id, null, { ...newPageContent(), title: "Vilkår", slug: "vilkar" }, { publish: true });
    if (!page.ok) throw new Error("page");
    await ls.setLegalRole(member, "terms", page.id);
    expect(await ls.setTermsMode(member, "checkbox")).toEqual({ ok: true });
    expect((await stores.getStore(solo.slug))!.termsAtCheckout).toBe("checkbox");
  });
});

describe("the screen's overview", () => {
  it("lists the seven kinds with what is chosen, the draft starters made, the choosable pages and what is missing", async () => {
    const view = await ls.legalOverview(await reload());
    expect(view.roles.map((r) => r.role)).toEqual(["terms", "privacy", "returns_policy", "shipping_policy", "withdrawal_info", "imprint", "accessibility"]);
    expect(view.roles.find((r) => r.role === "accessibility")?.starter).toBe(false);
    expect(view.roles.find((r) => r.role === "privacy")?.draft).toMatchObject({ published: false });
    expect(view.roles.find((r) => r.role === "terms")?.page).toBeNull();
    expect(view.missing).toEqual(expect.arrayContaining([expect.stringContaining("VAT number")]));
    // The front page chosen earlier is not offered.
    const front = (await stores.getStore(store.slug))!.frontPageId;
    expect(view.choosable.some((p) => p.id === front)).toBe(false);
    expect(view.termsAtCheckout).toBe("link");
  });
});
