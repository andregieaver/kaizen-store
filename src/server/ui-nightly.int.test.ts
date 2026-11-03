import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { isHandWrittenOnly, sourceHash } from "@/lib/ui-catalog";
import { fullCatalog } from "@/lib/ui-catalog-all";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

class AiError extends Error {}
/** A stand-in model, as `languages.int.test.ts` has: plain texts marked, messages with arguments left as they are (a valid translation of themselves). */
const ai = vi.hoisted(() => ({ down: false, calls: 0, connection: null as unknown }));
const completeText = vi.fn(async (_connection: unknown, messages: { content: string }[]) => {
  ai.calls += 1;
  if (ai.down) throw new AiError("down");
  const items = JSON.parse(messages[1].content) as { id: string; en: string }[];
  return { text: JSON.stringify(Object.fromEntries(items.map((i) => [i.id, /[{}]/.test(i.en) && /\{\d/.test(i.en) ? i.en : `IS ${i.en}`]))), region: null };
});
vi.mock("./ai", () => ({ AiError, aiFor: async () => ai.connection, completeText: (...args: Parameters<typeof completeText>) => completeText(...args) }));

const { runNightlyUiTranslations, translateNight, keptUpLanguages } = await import("./ui-nightly");
const { planGeneration } = await import("./ui-text");

/**
 * New interface text reaches the machine-translated languages by itself (D436), against a real database with a stand-in model: only
 * the texts a language translated before still lacks, never one it has (a person's, or one whose English changed since), never a
 * hand-written-only one and never a language nobody translated; capped, out of time, the AI down, paused, and once a day.
 */

const connection = { textModel: "m", source: "platform" } as never;
const catalog = fullCatalog();
const [personal, stale, current, other] = catalog.filter((e) => e.kind === "text" && e.key.startsWith("ui:"));

const rowsOf = async (lang: string) =>
  new Map(
    (await db().execute<Row>(sql`select key, text, source_hash, origin, reviewed_at from commerce.ui_translations where lang = ${lang}`)).map((r) => [String(r.key), r]),
  );
const put = (lang: string, key: string, text: string, origin: "ai" | "staff", hash: string) =>
  db().execute(sql`
    insert into commerce.ui_translations (lang, key, text, source_hash, origin, reviewed_at)
    values (${lang}, ${key}, ${text}, ${hash}, ${origin}, ${origin === "staff" ? sql`now()` : sql`null`})`);

/** Icelandic as a platform admin left it: a person's text, one translated from English that has changed since, one current; Basque with one text. */
async function seed() {
  await db().execute(sql`delete from commerce.ui_translations where lang = any(${sql`array['is', 'eu']::text[]`})`);
  await put("is", personal.key, "Handskrifað", "staff", sourceHash(personal.source));
  await put("is", stale.key, "Gamalt", "ai", "old");
  await put("is", current.key, "Nýtt", "ai", sourceHash(current.source));
  await put("eu", other.key, "Euskara", "ai", sourceHash(other.source));
}

let paused: boolean;

beforeAll(async () => {
  // The test database's languages start without interface text, as production's do (D436): a language another file left text in would be kept up too.
  await db().execute(sql`delete from commerce.ui_translations`);
  for (const [lang, locale, name] of [
    ["is", "is-IS", "Icelandic"],
    ["eu", "eu-ES", "Basque"],
  ]) {
    await db().execute(sql`
      insert into commerce.platform_languages (lang, locales, name) values (${lang}, array[${locale}]::text[], ${name})
      on conflict (lang) do update set enabled = true`);
  }
  await db().execute(sql`delete from commerce.cron_jobs where job = 'daily.ui-translations'`);
  const [row] = await db().execute<Row>(sql`select coalesce((select ai_autonomy_paused from commerce.platform_settings limit 1), false) as paused`);
  paused = Boolean(row.paused);
});

beforeEach(() => {
  ai.down = false;
  ai.calls = 0;
  ai.connection = connection;
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set ai_autonomy_paused = ${paused}`);
  await db().execute(sql`delete from commerce.platform_languages where lang = any(${sql`array['is', 'eu']::text[]`})`);
  await db().execute(sql`delete from commerce.cron_jobs where job = 'daily.ui-translations'`);
  await closeDb();
});

describe("the nightly interface translations (D436)", () => {
  it("do nothing, and say so, while no language has interface text, which is production's state today", async () => {
    expect(await keptUpLanguages()).toEqual([]);
    expect(await translateNight({ connection })).toEqual({ skipped: "no_language", languages: [], outOfTime: false });
    expect(ai.calls).toBe(0);
  });

  it("do nothing, and say so, without the platform's AI", async () => {
    await seed();
    ai.connection = null;
    expect(await translateNight()).toMatchObject({ skipped: "no_ai", languages: [] });
    expect(await translateNight({ connection: { textModel: null, source: "platform" } as never })).toMatchObject({ skipped: "no_ai" });
    expect(ai.calls).toBe(0);
    expect((await rowsOf("is")).size).toBe(3);
  });

  it("translate only the missing texts of the languages translated before, capped, as unreviewed drafts, and leave a person's text alone", async () => {
    await seed();
    // German, French and the others are switched on but nobody translated them: they stay English, and nothing is spent on them.
    expect((await keptUpLanguages()).map((l) => l.lang)).toEqual(["eu", "is"]);
    const plannedIs = await planGeneration("is", "missing");
    expect(plannedIs).toHaveLength(catalog.length - 3);
    expect(plannedIs.filter(isHandWrittenOnly)).toEqual([]);

    const [{ at: before }] = await db().execute<Row>(sql`select now()::text as at`);
    const night = await translateNight({ cap: 50 });
    // Icelandic lacks fewer texts than Basque, so it goes first; each gets 50, in two calls of 40 and 10.
    expect(night).toEqual({
      skipped: null,
      outOfTime: false,
      languages: [
        { lang: "is", missing: catalog.length - 3, sent: 50, saved: 50, refused: 0, failed: false },
        { lang: "eu", missing: catalog.length - 1, sent: 50, saved: 50, refused: 0, failed: false },
      ],
    });

    const is = await rowsOf("is");
    expect(is.size).toBe(53);
    // The first 50 missing ones, and nothing else.
    expect([...is.keys()].filter((k) => ![personal.key, stale.key, current.key].includes(k)).sort()).toEqual(plannedIs.slice(0, 50).sort());
    for (const key of plannedIs.slice(0, 50)) expect(is.get(key)).toMatchObject({ origin: "ai", reviewed_at: null, source_hash: sourceHash(catalog.find((e) => e.key === key)!.source) });
    // A person's text, and one translated from English that has changed since, are never touched: the night only fills what is missing.
    expect(is.get(personal.key)).toMatchObject({ text: "Handskrifað", origin: "staff" });
    expect(is.get(stale.key)).toMatchObject({ text: "Gamalt", source_hash: "old" });
    expect(is.get(current.key)).toMatchObject({ text: "Nýtt" });
    expect([...is.keys()].filter(isHandWrittenOnly)).toEqual([]);
    expect(is.has("ui:draftPay.heading")).toBe(false);
    expect((await rowsOf("eu")).size).toBe(51);
    // Languages nobody translated and the hand-written ones get nothing.
    const [others] = await db().execute<Row>(sql`select count(*)::int as n from commerce.ui_translations where lang <> all(${sql`array['is', 'eu']::text[]`})`);
    expect(Number(others.n)).toBe(0);

    // Audited as Translate is, with no account, and marked as the night's.
    const audits = await db().execute<Row>(sql`
      select account_id, area, details from commerce.audit_log
      where action = 'language.ui_generated' and details->>'lang' = 'is' and created_at >= ${String(before)}::timestamptz`);
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => a.account_id === null && a.area === "platform")).toBe(true);
    expect(audits.map((a) => (a.details as { saved: number; nightly: boolean }).saved).sort((a, b) => a - b)).toEqual([10, 40]);
    expect(audits.every((a) => (a.details as { nightly: boolean }).nightly === true)).toBe(true);

    // The next night takes the next ones: nothing is translated twice.
    await translateNight({ cap: 20 });
    expect((await rowsOf("is")).size).toBe(73);
    expect((await rowsOf("is")).get(personal.key)).toMatchObject({ text: "Handskrifað" });
  });

  it("stop starting calls when the night's time is up, and the rest waits", async () => {
    await seed();
    const out = await translateNight({ cap: 100, budgetMs: 0 });
    expect(out).toEqual({ skipped: null, languages: [], outOfTime: true });
    expect(ai.calls).toBe(0);
    // One call's time, then no more.
    const times = [0, 0, 5_000];
    const once = await translateNight({ cap: 100, budgetMs: 1_000, clock: () => times.shift() ?? 5_000 });
    expect(once).toMatchObject({ outOfTime: true, languages: [{ lang: "is", sent: 40, saved: 40 }] });
    expect((await rowsOf("is")).size).toBe(43);
    expect((await rowsOf("eu")).size).toBe(1);
  });

  it("leave a language for the next night when the AI does not answer, and try the others", async () => {
    await seed();
    ai.down = true;
    const night = await translateNight({ cap: 40 });
    expect(night.skipped).toBeNull();
    expect(night.languages.map((l) => [l.lang, l.saved, l.failed])).toEqual([
      ["is", 0, true],
      ["eu", 0, true],
    ]);
    expect((await rowsOf("is")).size).toBe(3);
  });

  it("wait while a platform admin has paused AI that acts on its own", async () => {
    await seed();
    await db().execute(sql`
      insert into commerce.platform_settings (id, ai_autonomy_paused) values (true, true)
      on conflict (id) do update set ai_autonomy_paused = excluded.ai_autonomy_paused`);
    try {
      expect(await translateNight({ cap: 40 })).toMatchObject({ skipped: "paused" });
      expect(ai.calls).toBe(0);
    } finally {
      await db().execute(sql`update commerce.platform_settings set ai_autonomy_paused = false`);
    }
  });

  it("run once a day from the five-minute dispatcher, kept in the ledger as daily.ui-translations", async () => {
    await seed();
    expect(await runNightlyUiTranslations({ fromHour: 24 })).toMatchObject({ skipped: "not_yet" });
    const first = await runNightlyUiTranslations({ fromHour: 0, cap: 5 });
    expect(first).toMatchObject({ skipped: null, languages: [{ lang: "is", saved: 5 }, { lang: "eu", saved: 5 }] });
    expect(await runNightlyUiTranslations({ fromHour: 0, cap: 5 })).toMatchObject({ skipped: "done_today" });
    expect((await rowsOf("is")).size).toBe(8);
    const [job] = await db().execute<Row>(sql`select every_seconds, runs, failures, last_ok_at from commerce.cron_jobs where job = 'daily.ui-translations'`);
    expect(job).toMatchObject({ every_seconds: 86400, runs: 1, failures: 0 });
    expect(job.last_ok_at).not.toBeNull();
  });
});
