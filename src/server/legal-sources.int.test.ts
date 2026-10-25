import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));

const legal = await import("./legal-sources");
const { LEGAL_SOURCES, LEGAL_SOURCES_BY_KEY, passagesNamed } = await import("@/lib/legal-sources");
type Fetched = import("./replicate-fetch").Fetched;
type LegalFetch = import("./legal-sources").LegalFetch;

/**
 * Reading the official legal sources (D311, unit L, `docs/ai-autopilot.md` 8.2) with a stand-in for the network that answers in each
 * route's own format: every source read and kept, an unchanged text stored once, a source that fails never replacing a good read, a Danish
 * act no longer in force, a missing passage and an answer in the wrong language refused, Norwegian law from Lovdata's archive downloaded
 * once a run, reads due again on time, old reads pruned and nothing changed once kept.
 */

const bytes = (s: string) => new TextEncoder().encode(s);
const ok = (url: string, body: string): Fetched => ({ ok: true, url, status: 200, contentType: "text/plain", bytes: bytes(body) });

const WORDS: Record<string, string> = { en: "the trader and the consumer", sv: "näringsidkaren och konsumenten att", da: "den erhvervsdrivende og forbrugeren af" };

function cellar(key: string, language: string, extra = ""): string {
  const divs = passagesNamed(key).map((p) =>
    p.startsWith("anx_")
      ? `<div id="${p}"><p class="title-annex-1">ANNEX</p><p>${WORDS[language]} ${extra}</p></div>`
      : `<div class="eli-subdivision" id="${p}"><p class="title-article-norm">Article ${p.slice(4)}</p><div class="eli-title"><p class="stitle-article-norm">Title</p></div><div class="norm">${WORDS[language]} ${extra}</div></div>`,
  );
  return `<html xmlns="http://www.w3.org/1999/xhtml"><body>${divs.join("")}</body></html>`;
}

function riksdagen(key: string, doc: string): string {
  const sfs = doc.replace(/^sfs-(\d{4})-(\d+)$/, "$1:$2");
  const byChapter = new Map<string, string[]>();
  for (const p of passagesNamed(key)) {
    const [chapter, section] = p.includes(":") ? p.split(":") : ["", p];
    byChapter.set(chapter, [...(byChapter.get(chapter) ?? []), section]);
  }
  const parts = [`Lag (${sfs})\r\n\r\nSFS nr:     ${sfs}\r\n`];
  for (const [chapter, sections] of byChapter) {
    if (chapter) parts.push(`\r\n${chapter} kap. Kapitel\r\n`);
    for (const s of sections) parts.push(`\r\n${s.replace(/^(\d+)([a-z])$/, "$1 $2")} § Konsumenten har rätt. Lag (2014:14).\r\n`);
  }
  return parts.join("");
}

function retsinformation(key: string, status = "Valid"): string {
  const paragraphs = passagesNamed(key).map((p) => `<Paragraf localId="${p}"><Explicatus>§ ${p}.</Explicatus><Stk><Exitus><Linea><Char>Forbrugeren kan træde tilbage.</Char></Linea></Exitus></Stk></Paragraf>`);
  return `<Dokument><Meta><Status>${status}</Status></Meta><DokumentIndhold>${paragraphs.join("")}<Ikraft><Paragraf localId="154"><Char>Ikraft.</Char></Paragraf></Ikraft></DokumentIndhold></Dokument>`;
}

function lovdata(key: string): string {
  const articles = passagesNamed(key).map((p) => {
    const name = p.startsWith("gdpr/") ? p : `§${p}`;
    return `<article class="legalArticle" data-name="${name}"><h3 class="legalArticleHeader"><span class="legalArticleValue">${name}</span>. <span class="legalArticleTitle">Tittel</span></h3><article class="legalP">Forbrukeren kan gå fra avtalen.</article><article class="changesToParent">Endret ved lov.</article></article>`;
  });
  return `<!DOCTYPE html><html lang="nb"><body><header class="documentHeader"><dl><dd class="dokid">NL/lov/${key}</dd><dd class="lastChangeInForce">2026-01-01</dd></dl></header><main>${articles.join("")}</main></body></html>`;
}

/** A tar archive of the files (ustar headers with a name and an octal size), as Lovdata's open data is once unpacked. */
function tar(files: Record<string, string>): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const [name, body] of Object.entries(files)) {
    const data = bytes(body);
    const header = new Uint8Array(512);
    header.set(bytes(name), 0);
    header.set(bytes(`${data.length.toString(8).padStart(11, "0")}\0`), 124);
    header.set(bytes("ustar\0"), 257);
    chunks.push(header, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  chunks.push(new Uint8Array(1024));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const ARCHIVE = tar(Object.fromEntries(LEGAL_SOURCES.flatMap((s) => (s.route.kind === "lovdata" ? [[`nl/${s.route.file}.xml`, lovdata(s.key)]] : []))));
/** The stand-in serves the archive unpacked. */
const unpack = (b: Uint8Array) => b;

type Network = { urls: string[]; historic?: boolean; wrongLanguage?: boolean; dropPassage?: string; changed?: boolean };

/** A network that answers each official route as it would. */
function network(state: Network): LegalFetch {
  return async (url, options) => {
    state.urls.push(url);
    if (url.startsWith("https://publications.europa.eu/webapi/rdf/sparql")) {
      const celex = /0(\d{4}[LR]\d{4})-/.exec(decodeURIComponent(url))?.[1] ?? "";
      return ok(url, `"c"\n"0${celex}-20180701"\n"0${celex}-20260927"\n`);
    }
    const celex = /resource\/celex\/0(\d{4}[LR]\d{4})-\d{8}$/.exec(url);
    if (celex) {
      const source = LEGAL_SOURCES.find((s) => s.route.kind === "cellar" && s.route.celex.slice(1) === celex[1])!;
      const language = state.wrongLanguage ? "en" : ({ swe: "sv", dan: "da", eng: "en" } as Record<string, string>)[options.acceptLanguage ?? "eng"];
      const page = cellar(source.key, language, state.changed ? "amended" : "");
      return ok(url, state.dropPassage ? page.replace(`id="${state.dropPassage}"`, 'id="art_999"') : page);
    }
    const sfs = /data\.riksdagen\.se\/dokument\/(sfs-\d{4}-\d+)\.text$/.exec(url);
    if (sfs) return ok(url, riksdagen(LEGAL_SOURCES.find((s) => s.route.kind === "riksdagen" && s.route.doc === sfs[1])!.key, sfs[1]));
    const eli = /retsinformation\.dk\/eli\/(lta\/\d{4}\/\d+)\/xml$/.exec(url);
    if (eli) return ok(url, retsinformation(LEGAL_SOURCES.find((s) => s.route.kind === "retsinformation" && s.route.eli === eli[1])!.key, state.historic ? "Historic" : "Valid"));
    if (url === legal.LOVDATA_ARCHIVE) return { ok: true, url, status: 200, contentType: "application/x-bzip2", bytes: ARCHIVE };
    return { ok: false, problem: `unexpected ${url}` };
  };
}

const PAIRS = LEGAL_SOURCES.reduce((n, s) => n + s.languages.length, 0);

async function readAll(state: Network, now: Date) {
  for (let i = 0; i < Math.ceil(PAIRS / legal.READS_PER_RUN) + 1; i++) await legal.readDueLegalSources({ fetch: network(state), today: "2026-10-25", unpack }, now);
}

beforeEach(async () => {
  await db().execute(sql`delete from commerce.legal_source_reads`);
  await db().execute(sql`delete from commerce.legal_source_texts`);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.legal_source_reads`);
  await db().execute(sql`delete from commerce.legal_source_texts`);
  await closeDb();
});

describe("reading the sources", () => {
  it("reads every source in each of its languages, a few a run, and keeps what pages rest on", async () => {
    const state: Network = { urls: [] };
    const now = new Date();
    const first = await legal.readDueLegalSources({ fetch: network(state), today: "2026-10-25", unpack }, now);
    expect(first).toMatchObject({ read: legal.READS_PER_RUN, failed: 0 });
    await readAll(state, now);
    expect(await legal.dueReads(now)).toEqual([]);
    const texts = await legal.currentLegalTexts();
    expect(texts).toHaveLength(PAIRS);
    const crdSv = texts.find((t) => t.sourceKey === "eu-crd" && t.language === "sv")!;
    expect(crdSv.version).toBe("02011L0083-20260927");
    expect(crdSv.passages.map((p) => p.key)).toEqual(expect.arrayContaining(["art_9", "anx_I"]));
    // Every request went to an official host.
    for (const url of state.urls) expect(["publications.europa.eu", "data.riksdagen.se", "www.retsinformation.dk", "api.lovdata.no"]).toContain(new URL(url).hostname);
    // Norwegian law comes from Lovdata's archive, downloaded once for the Norwegian sources a run reads, not once each.
    expect(texts.find((t) => t.sourceKey === "no-popplyl")?.passages.map((p) => p.key)).toContain("gdpr/a13");
    expect(texts.find((t) => t.sourceKey === "no-arl")?.version).toBe("NL/lov/no-arl@2026-01-01");
    const downloads = state.urls.filter((u) => u === legal.LOVDATA_ARCHIVE).length;
    expect(downloads).toBeGreaterThan(0);
    expect(downloads).toBeLessThan(LEGAL_SOURCES.filter((s) => s.route.kind === "lovdata").length);
  });

  it("is read again a week after a good read, keeping an unchanged text once, and a changed one beside it", async () => {
    const state: Network = { urls: [] };
    // Reads are timed by the database's clock, so the days after are counted from now.
    const start = new Date();
    const day = 86_400_000;
    await readAll(state, start);
    const [{ n: textsBefore }] = await db().execute<{ n: string }>(sql`select count(*)::text as n from commerce.legal_source_texts`);
    expect(await legal.dueReads(new Date(start.getTime() + 6 * day))).toEqual([]);
    const week = new Date(start.getTime() + 7 * day + 60_000);
    expect((await legal.dueReads(week)).length).toBe(PAIRS);
    await readAll(state, week);
    const [{ n: textsAfter }] = await db().execute<{ n: string }>(sql`select count(*)::text as n from commerce.legal_source_texts`);
    expect(textsAfter).toBe(textsBefore);
    await readAll({ urls: [], changed: true }, new Date(start.getTime() + 14 * day + 120_000));
    const crd = (await legal.currentLegalTexts()).find((t) => t.sourceKey === "eu-crd" && t.language === "en")!;
    expect(crd.passages[0].text).toContain("amended");
  });
});

describe("a read that fails", () => {
  it("never replaces a good read, and is tried again a day later", async () => {
    const source = LEGAL_SOURCES_BY_KEY["dk-forbrugeraftale"];
    expect(await legal.readSource(source, "da", { fetch: network({ urls: [] }) })).toEqual({ ok: true });
    const failed = await legal.readSource(source, "da", { fetch: network({ urls: [], historic: true }) });
    expect(failed).toMatchObject({ ok: false, problem: expect.stringContaining("no longer in force (Historic)") });
    expect((await legal.currentLegalTexts()).find((t) => t.sourceKey === "dk-forbrugeraftale")).toBeTruthy();
    const states = await legal.legalSourceStates();
    expect(states.find((s) => s.sourceKey === "dk-forbrugeraftale")).toMatchObject({ lastGood: expect.any(Date), lastFailed: { problem: expect.stringContaining("register needs") } });
  });

  it("names a passage the register needs that the text lacks, and refuses an answer in another language", async () => {
    const crd = LEGAL_SOURCES_BY_KEY["eu-crd"];
    expect(await legal.readSource(crd, "sv", { fetch: network({ urls: [], dropPassage: "art_16" }) })).toMatchObject({ ok: false, problem: expect.stringContaining("art_16") });
    expect(await legal.readSource(crd, "sv", { fetch: network({ urls: [], wrongLanguage: true }) })).toMatchObject({ ok: false, problem: "The act came back in en, not sv." });
    expect(await legal.currentLegalTexts()).toEqual([]);
  });

  it("never fetches from a host outside the register", async () => {
    expect(await legal.officialFetch("https://evil.example/eli/lta/2025/1184/xml", { maxBytes: 10 })).toMatchObject({ ok: false, problem: expect.stringContaining("official") });
  });
});

describe("keeping", () => {
  it("prunes reads older than 90 days except the newest good one, and texts no read names", async () => {
    // Reads are written as old as they need to be: the trigger refuses moving a read's time afterwards.
    const hash = "kept-text";
    await db().execute(sql`insert into commerce.legal_source_texts (hash, passages) values (${hash}, '[]'::jsonb), ('orphan', '[]'::jsonb)`);
    await db().execute(sql`
      insert into commerce.legal_source_reads (source_key, language, version, status, text_hash, passage_count, read_at) values
        ('se-kkl', 'sv', 'sfs-2022-260', 'ok', ${hash}, 1, now() - interval '200 days'),
        ('se-kkl', 'sv', 'sfs-2022-260', 'ok', ${hash}, 1, now() - interval '100 days'),
        ('se-kkl', 'sv', 'sfs-2022-260', 'failed', null, null, now() - interval '95 days')`);
    expect(await legal.pruneLegalSourceReads()).toBe(2);
    const [{ n }] = await db().execute<{ n: string }>(sql`select count(*)::text as n from commerce.legal_source_reads`);
    expect(n).toBe("1");
    const texts = await db().execute<{ hash: string }>(sql`select hash from commerce.legal_source_texts`);
    expect(texts.map((t) => t.hash)).toEqual([hash]);
  });

  it("changes no read or text once kept", async () => {
    await legal.readSource(LEGAL_SOURCES_BY_KEY["se-ehandel"], "sv", { fetch: network({ urls: [] }) });
    const refused = (query: ReturnType<typeof sql>) =>
      db()
        .execute(query)
        .then(() => null, (error: { cause?: { message?: string } }) => String(error.cause?.message));
    expect(await refused(sql`update commerce.legal_source_reads set problem = 'x'`)).toMatch(/legal_sources\.fixed/);
    expect(await refused(sql`update commerce.legal_source_texts set passages = '[]'::jsonb`)).toMatch(/legal_sources\.fixed/);
  });
});
