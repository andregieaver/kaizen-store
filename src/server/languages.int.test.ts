import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { t } from "@/lib/i18n";
import { fullCatalog } from "@/lib/ui-catalog-all";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

class AiError extends Error {}
/** A model that translates plain texts by marking them and leaves messages with arguments as they are (which is a valid translation of itself). */
const completeText = vi.fn(async (_connection: unknown, messages: { content: string }[]) => {
  const items = JSON.parse(messages[1].content) as { id: string; en: string }[];
  return { text: JSON.stringify(Object.fromEntries(items.map((i) => [i.id, /[{}]/.test(i.en) && /\{\d/.test(i.en) ? i.en : `DE ${i.en}`]))), region: null };
});
vi.mock("./ai", () => ({ AiError, aiFor: async () => null, completeText: (...args: Parameters<typeof completeText>) => completeText(...args) }));

const languages = await import("./languages");
const text = await import("./ui-text");
const localization = await import("./localization");
const { getStore } = await import("./stores");

/**
 * The platform's languages and their interface text (D111): choosing them,
 * translating with AI, a person's edits, and reading it back as `t()`.
 */

const connection = { textModel: "m", source: "platform" } as never;
const catalog = fullCatalog();
const plain = catalog.find((e) => e.kind === "text" && e.key.startsWith("ui:") && !/[{}]/.test(e.source))!;
let accountId: string;

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`lang-${Date.now().toString(36)}@example.com`}, 'Admin') returning id`);
  accountId = String(account.id);
  await db().execute(sql`delete from commerce.ui_translations where lang = 'de'`);
  await forgetAfrikaans();
});

/** Stores of earlier runs that were put in Afrikaans keep it switched on: take it from them. */
const forgetAfrikaans = () => db().execute(sql`update commerce.stores set locales = array_remove(locales, 'af-ZA') where 'af-ZA' = any(locales)`);

afterAll(async () => {
  await forgetAfrikaans();
  await db().execute(sql`delete from commerce.ui_translations where lang in ('de', 'af')`);
  await db().execute(sql`delete from commerce.platform_languages where lang = 'af'`);
  await closeDb();
});

describe("the platform's languages", () => {
  it("start with the languages stores could already be in, and take a new one from the world's", async () => {
    const before = await languages.listLanguages();
    expect(before.map((l) => l.lang)).toEqual(expect.arrayContaining(["nb", "sv", "da", "en", "de", "fr"]));
    expect(before.find((l) => l.lang === "de")).toMatchObject({ name: "German", locales: expect.arrayContaining(["de-DE", "de-AT"]), enabled: true });

    expect(await languages.addLanguage(accountId, "not a code")).toMatchObject({ ok: false });
    expect(await languages.addLanguage(accountId, "xx")).toMatchObject({ ok: false });
    expect(await languages.addLanguage(accountId, "af")).toEqual({ ok: true });
    expect((await languages.listLanguages()).find((l) => l.lang === "af")).toMatchObject({ name: "Afrikaans", locales: ["af-ZA"], direction: "ltr" });
    // Adding it again changes nothing.
    expect(await languages.addLanguage(accountId, "af")).toEqual({ ok: true });
  });

  it("switch a language off, unless English or one that stores use", async () => {
    expect(await languages.setLanguageEnabled(accountId, "en", false)).toMatchObject({ ok: false });
    expect(await languages.setLanguageEnabled(accountId, "nb", false)).toMatchObject({ ok: false, problem: expect.stringContaining("stores use") });
    expect(await languages.setLanguageEnabled(accountId, "af", false)).toEqual({ ok: true });
    expect((await languages.enabledLanguages()).some((l) => l.lang === "af")).toBe(false);
    expect(await languages.setLanguageEnabled(accountId, "af", true)).toEqual({ ok: true });
    expect(await languages.setLanguageEnabled(accountId, "zz", true)).toMatchObject({ ok: false });
  });

  it("set the locales a store can pick between", async () => {
    expect(await languages.setLanguageLocales(accountId, "af", ["af-ZA", "af-NA", "en-GB", "bad"])).toEqual({ ok: true });
    expect((await languages.listLanguages()).find((l) => l.lang === "af")?.locales).toEqual(["af-ZA", "af-NA"]);
    expect(await languages.setLanguageLocales(accountId, "af", ["nope"])).toMatchObject({ ok: false });
  });

  it("decide what a store can be in", async () => {
    const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`lg-${Date.now().toString(36)}@example.com`}, 'K', 'Sprak') returning id`);
    const slug = `lg-${Date.now().toString(36)}`;
    const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Sprak', null) as id`);
    // The template's countries, languages and currencies, as before D178 step 4 (a new store starts in its own country alone).
    await db().execute(sql`update commerce.stores set features = features || array['countries', 'languages', 'currencies'] where id = ${String(store.id)}::uuid`);
    const [acc] = await db().execute<Row>(sql`select a.id, a.email from commerce.accounts a join commerce.store_members m on m.account_id = a.id where m.store_id = ${String(store.id)}::uuid limit 1`);
    const member = { account: { id: String(acc.id), email: String(acc.email), name: "K", platformAdmin: false }, role: "owner" as const, store: (await getStore(slug))! };
    const asMember = async () => ({ ...member, store: (await getStore(slug))! });
    expect(await localization.saveLanguages(await asMember(), ["nb-NO", "sv-SE", "da-DK", "de-DE"], {})).toEqual({ ok: true });
    expect((await getStore(slug))!.localization.locales).toContain("de-DE");
    // A language the platform has switched off cannot be chosen.
    await languages.setLanguageEnabled(accountId, "af", false);
    expect(await localization.saveLanguages(await asMember(), ["nb-NO", "sv-SE", "da-DK", "af-ZA"], {})).toMatchObject({ ok: false });
    await languages.setLanguageEnabled(accountId, "af", true);
    expect(await localization.saveLanguages(await asMember(), ["nb-NO", "sv-SE", "da-DK", "af-ZA"], {})).toEqual({ ok: true });
  });
});

describe("a language's interface text", () => {
  it("is planned, translated in chunks, checked and kept as a draft", async () => {
    const keys = await text.planGeneration("de", "missing");
    expect(keys).toHaveLength(catalog.length);
    const chunk = keys.slice(0, 60);
    const result = await text.generateChunk(connection, { accountId }, { lang: "de", name: "German" }, chunk);
    expect(result).toMatchObject({ ok: true, saved: 60, problems: [] });
    expect((await text.planGeneration("de", "missing")).length).toBe(catalog.length - 60);
    const rows = await text.uiRows("de");
    expect(rows.size).toBe(60);
    expect([...rows.values()].every((r) => r.origin === "ai" && !r.reviewed)).toBe(true);
    // The rest.
    const rest = await text.generateChunk(connection, { accountId }, { lang: "de", name: "German" }, (await text.planGeneration("de", "missing")));
    expect(rest).toMatchObject({ ok: true, problems: [] });
    expect(await text.planGeneration("de", "missing")).toEqual([]);
  });

  it("is read back as t() and emailText(), key by key with English for what is missing", async () => {
    await text.reloadUi("de");
    const de = t("de") as unknown as Record<string, unknown>;
    const path = plain.key.slice(3).split(".");
    const value = path.reduce<unknown>((node, k) => (node as Record<string, unknown>)[k], de);
    expect(value).toBe(`DE ${plain.source}`);
    expect(t("de").stay.nights(2)).toBe("2 nights");
    expect(t("xx").stay.nights(2)).toBe("2 nights");
    expect(text.uiTextsFor("de")?.[plain.key]).toBe(`DE ${plain.source}`);
    expect(text.uiTextsFor("nb")).toBeNull();
  });

  it("refuses a model that fails, and one that answers wrongly", async () => {
    completeText.mockRejectedValueOnce(new AiError("down"));
    expect(await text.generateChunk(connection, { accountId }, { lang: "de", name: "German" }, [plain.key])).toMatchObject({ ok: false, problem: "down" });
    completeText.mockResolvedValueOnce({ text: JSON.stringify({ "0": "" }), region: null });
    const bad = await text.generateChunk(connection, { accountId }, { lang: "de", name: "German" }, [plain.key]);
    expect(bad).toMatchObject({ ok: true, saved: 0 });
    expect((bad as { problems: unknown[] }).problems).toHaveLength(1);
    expect(await text.generateChunk(connection, { accountId }, { lang: "nb", name: "Norwegian" }, [plain.key])).toMatchObject({ ok: false });
  });

  it("takes a person's edits, checked, kept as reviewed and never replaced by the AI", async () => {
    const nights = "ui:stay.nights";
    expect(await text.saveUiEdits(accountId, "de", [{ key: nights, text: "# Nächte" }])).toMatchObject({ ok: false });
    expect(await text.saveUiEdits(accountId, "de", [{ key: "ui:nope", text: "x" }])).toMatchObject({ ok: false });
    expect(await text.saveUiEdits(accountId, "de", [{ key: nights, text: "{0, plural, one {# Nacht} other {# Nächte}}" }, { key: plain.key, text: "Von Hand" }])).toEqual({ ok: true, saved: 2 });
    expect(t("de").stay.nights(1)).toBe("1 Nacht");
    expect(t("de").stay.nights(3)).toBe("3 Nächte");
    const row = (await text.uiRows("de")).get(nights)!;
    expect(row).toMatchObject({ origin: "staff", reviewed: true });
    // "Everything again" leaves what a person wrote.
    expect(await text.planGeneration("de", "all")).not.toContain(nights);
    await text.generateChunk(connection, { accountId }, { lang: "de", name: "German" }, [nights, plain.key]);
    expect((await text.uiRows("de")).get(plain.key)?.text).toBe("Von Hand");
  });

  it("notices English that changed, and counts what a person has read", async () => {
    await db().execute(sql`update commerce.ui_translations set source_hash = 'old' where lang = 'de' and key = ${plain.key}`);
    // A person's text is not planned for the AI; an AI one is.
    const other = catalog.find((e) => e.key !== plain.key && e.kind === "text")!;
    await db().execute(sql`update commerce.ui_translations set source_hash = 'old' where lang = 'de' and key = ${other.key}`);
    expect(await text.planGeneration("de", "stale")).toEqual([other.key]);
    const coverage = (await text.uiCoverage()).de;
    expect(coverage).toMatchObject({ total: catalog.length, translated: catalog.length, stale: 2 });
    expect(coverage.reviewed).toBe(2);
    expect(await text.markUiReviewed(accountId, "de", null)).toBe(catalog.length - 2);
    expect((await text.uiCoverage()).de.reviewed).toBe(catalog.length);
    expect((await text.uiCounts()).de).toEqual({ translated: catalog.length, reviewed: catalog.length });
  });

  it("can be cleared to start again", async () => {
    expect(await text.clearUiTexts(accountId, "de")).toBe(catalog.length);
    expect(t("de").stay.nights(1)).toBe("1 night");
    expect(text.uiTextsFor("de")).not.toBeNull();
  });
});
