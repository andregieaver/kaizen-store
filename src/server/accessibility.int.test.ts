import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent } from "@/lib/page-content";
import { templateSettings } from "@/lib/theme";

import { addMember, auditRows, makeAccount, makeStore, membershipOf, run } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const a11y = await import("./accessibility");
const pages = await import("./pages");

type Row = Record<string, unknown>;

/**
 * The accessibility statement (wave 1, 1e, docs/wave-1-trust.md 2.3): what the owner says is saved only when a claim has an assessment behind it,
 * the site's own facts are read from the site, and the draft says "has not been assessed" until an audit entry says otherwise. Hand-written, flagged for
 * review, never published by the generator.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let owner: Awaited<ReturnType<typeof membershipOf>>;

const text = (value: unknown) => JSON.stringify(value);
const statement = async () => {
  const made = await a11y.createStatementDraft(owner);
  if (!made.ok) throw new Error(made.problems.join());
  return { made, page: (await pages.getPageForEdit(store.id, made.id))! };
};

beforeAll(async () => {
  store = await makeStore("a11y");
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
    select ${store.id}::uuid, code, currency, default_locale, locales, true from commerce.countries where code in ('NO') on conflict do nothing
  `);
  // Norwegian and English (D178: Several languages on).
  await db().execute(sql`update commerce.stores set country = 'NO', locales = array['nb-NO', 'en-GB'], features = features || array['languages'], contact_email = 'butikk@example.com', name = 'Keramikken' where id = ${store.id}::uuid`);
  owner = await membershipOf(store.slug, store.account, "owner");
});

afterAll(async () => {
  await closeDb();
});

describe("what the owner says", () => {
  it("defaults to `not assessed`", async () => {
    expect(await a11y.getA11ySettings(store.id)).toMatchObject({ status: "not_assessed", assessedBy: null, assessedOn: null, microenterprise: false, knownIssues: "" });
  });

  it("refuses to say the site meets the requirements without who assessed it and when, and says what is missing", async () => {
    expect(await a11y.saveA11ySettings(owner, { status: "full" })).toMatchObject({ ok: false, problems: [expect.stringContaining("who assessed it and on what date")] });
    expect(await a11y.saveA11ySettings(owner, { status: "full", assessedBy: "Tilgjengelighet AS" })).toMatchObject({ ok: false });
    expect(await a11y.saveA11ySettings(owner, { status: "full", assessedOn: "2026-09-01" })).toMatchObject({ ok: false });
    expect(await a11y.saveA11ySettings(owner, { status: "full", assessedBy: "X", assessedOn: "2026-02-30" })).toMatchObject({ ok: false, problems: [expect.stringContaining("not a date")] });
    expect(await a11y.getA11ySettings(store.id)).toMatchObject({ status: "not_assessed" });
    // The database holds the same rule, whatever the form does.
    await expect(db().execute(sql`insert into commerce.accessibility_settings (store_id, status) values (${store.id}::uuid, 'full')`)).rejects.toThrow();
  });

  it("saves an assessment with its evidence and reads it back; a claim of partial needs notes or an assessor", async () => {
    expect(await a11y.saveA11ySettings(owner, { status: "partial" })).toMatchObject({ ok: false });
    expect(await a11y.saveA11ySettings(owner, { status: "partial", assessmentNote: "Our own check found missing alt texts.", knownIssues: "The size chart has no table headers\nThe filter is hard to use by keyboard" })).toEqual({ ok: true });
    expect(await a11y.getA11ySettings(store.id)).toMatchObject({ status: "partial", assessmentNote: "Our own check found missing alt texts." });
    expect(await a11y.saveA11ySettings(owner, { status: "full", assessedBy: " Tilgjengelighet AS ", assessedOn: "2026-09-01", reportUrl: "https://example.com/report.pdf", microenterprise: "on", contactEmail: "uu@example.com", preparedOn: "2026-09-05", reviewedOn: "2026-09-10" })).toEqual({ ok: true });
    expect(await a11y.getA11ySettings(store.id)).toMatchObject({ status: "full", assessedBy: "Tilgjengelighet AS", assessedOn: "2026-09-01", microenterprise: true, contactEmail: "uu@example.com", preparedOn: "2026-09-05", knownIssues: "" });
  });

  it("refuses a report address that is not http(s), a reviewed date before the prepared one and an email that is none", async () => {
    expect(await a11y.saveA11ySettings(owner, { status: "not_assessed", reportUrl: "javascript:alert(1)" })).toMatchObject({ ok: false });
    expect(await a11y.saveA11ySettings(owner, { status: "not_assessed", preparedOn: "2026-09-05", reviewedOn: "2026-09-01" })).toMatchObject({ ok: false, problems: [expect.stringContaining("reviewed before")] });
    expect(await a11y.saveA11ySettings(owner, { status: "not_assessed", contactEmail: "nobody" })).toMatchObject({ ok: false });
  });

  it("writes the change down as the status before and after, never the notes, and is for owners only", async () => {
    await a11y.saveA11ySettings(owner, { status: "not_assessed", assessmentNote: "A SECRET NOTE" });
    const log = (await auditRows(store.id, "store.accessibility_updated")).at(-1)!;
    expect(log).toMatchObject({ area: "settings", details: { to: "not_assessed" } });
    expect(JSON.stringify(log)).not.toContain("A SECRET NOTE");
    const admin = await makeAccount("a11y-admin");
    await addMember(store.id, admin.id, "admin");
    const member = await membershipOf(store.slug, admin, "admin");
    expect(await a11y.saveA11ySettings(member, { status: "not_assessed" })).toEqual({ ok: false, problems: ["You do not have access to this."] });
    expect(await a11y.createStatementDraft(member)).toEqual({ ok: false, problems: ["You do not have access to this."] });
  });
});

describe("what the site itself knows", () => {
  it("counts the colour pairs below 4.5 to 1, the pictures with no alt text and the published pages with a blocking issue, and gives the site's addresses and languages", async () => {
    const settings = templateSettings("minimal");
    const poor = { ...settings, light: { ...settings.light, text: "#999999", background: "#aaaaaa" } };
    await db().execute(sql`update commerce.stores set theme = ${JSON.stringify({ base: "minimal", savedId: null, settings: poor })}::jsonb where id = ${store.id}::uuid`);
    await db().execute(sql`
      insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, alt, alt_source, alt_written_at)
      values (${store.id}::uuid, 'image', ${`https://example.com/a-${run}.webp`}, 'b', ${`a-${run}`}, 'a.webp', 'image/webp', '', null, null),
             (${store.id}::uuid, 'image', ${`https://example.com/b-${run}.webp`}, 'b', ${`b-${run}`}, 'b.webp', 'image/webp', 'A bowl', 'staff', now()),
             (${store.id}::uuid, 'video', ${`https://example.com/c-${run}.mp4`}, 'b', ${`c-${run}`}, 'c.mp4', 'video/mp4', '', null, null)
    `);
    const picture = { id: crypto.randomUUID(), type: "image", image: { url: "https://example.com/a.webp", thumbnailUrl: "https://example.com/a-480.webp", alt: "", width: 10, height: 10 } };
    const row = { id: crypto.randomUUID(), type: "row", layout: "1", columns: [{ id: crypto.randomUUID(), blocks: [picture] }] };
    const saved = await pages.savePage(owner.account, store.id, null, { ...newPageContent(), title: "Bad page", slug: `bad-${run}`, rows: [row] } as never, { publish: true, acknowledgedIssues: ["image_alt"] });
    expect(saved.ok).toBe(true);
    const facts = await a11y.a11yFacts((await (await import("./stores")).getStore(store.slug))!);
    expect(facts.themeWarnings).toBeGreaterThan(0);
    expect(facts.mediaWithoutAlt).toEqual({ missing: 1, total: 2 });
    expect(facts.pagesWithBlockingIssues).toBeGreaterThanOrEqual(1);
    expect(facts.countries[0]).toBe("NO");
    expect(facts.siteAddresses[0]).toMatch(new RegExp(`/s/${store.slug}/no$`));
    expect(facts.languages).toEqual(expect.arrayContaining(["Norwegian Bokmål", "English"]));
  });
});

describe("the statement", () => {
  it("says `has not been assessed` by default, with the review notice first, in the main language and the others as translations; a draft, never published", async () => {
    await a11y.saveA11ySettings(owner, { status: "not_assessed" });
    const { made, page } = await statement();
    expect(made).toMatchObject({ language: "nb", translatedNotice: false });
    expect(page.state).toBe("draft");
    const body = text(page.draft.rows);
    expect(body).toContain("legal-review-notice");
    expect(body).toMatch(/har ikke vurdert dette nettstedet/i);
    expect(body).not.toMatch(/Dette nettstedet oppfyller/);
    expect(made.translations).toContain("en-GB");
    expect(text(page.draft.translations?.["en-GB"])).toMatch(/has not assessed this website/i);
    const [row] = await db().execute<Row>(sql`select published_at from commerce.pages where id = ${made.id}::uuid`);
    expect(row.published_at).toBeNull();
    expect((await auditRows(store.id, "store.legal_starter_made")).at(-1)).toMatchObject({ target_id: made.id, details: { role: "accessibility" } });
  });

  it("names the assessor and date only when they are given, says `meets` only then, and adds the microenterprise sentence only when ticked", async () => {
    await a11y.saveA11ySettings(owner, { status: "full", assessedBy: "Tilgjengelighet AS", assessedOn: "2026-09-01", microenterprise: false });
    const full = text((await statement()).page.draft.rows);
    expect(full).toContain("Tilgjengelighet AS");
    expect(full).toContain("2026-09-01");
    expect(full).toMatch(/Dette nettstedet oppfyller Web Content/);
    expect(full).not.toMatch(/svært liten bedrift/i);
    await a11y.saveA11ySettings(owner, { status: "full", assessedBy: "Tilgjengelighet AS", assessedOn: "2026-09-01", microenterprise: true });
    expect(text((await statement()).page.draft.rows)).toMatch(/svært liten bedrift/i);
  });

  it("prints the enforcement body of the store's country as unverified with `check with the authority`, and the contact email defaults to the store's", async () => {
    await a11y.saveA11ySettings(owner, { status: "not_assessed" });
    const body = text((await statement()).page.draft.rows);
    expect(body).toContain("Digitaliseringsdirektoratet");
    expect(body).toMatch(/sjekk med myndigheten/i);
    expect(body).toContain("butikk@example.com");
  });

  it("makes another draft each time and leaves the first as it was", async () => {
    const first = await a11y.createStatementDraft(owner);
    const second = await a11y.createStatementDraft(owner);
    if (!first.ok || !second.ok) throw new Error("statement");
    expect(second.id).not.toBe(first.id);
    expect(second.slug).not.toBe(first.slug);
  });

  it("lists the site's own problems in the known issues, from the facts and not from the owner's say-so", async () => {
    await a11y.saveA11ySettings(owner, { status: "partial", assessmentNote: "own check", knownIssues: "The size chart has no headers" });
    const body = text((await statement()).page.draft.rows);
    expect(body).toContain("The size chart has no headers");
    expect(body).toMatch(/uten alternativ tekst: 1 av 2/);
  });
});
