import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import Bunzip from "seek-bzip";
import { z } from "zod";

import { db } from "@/db/client";
import {
  cellarLanguage,
  cellarPassages,
  consolidationQuery,
  latestConsolidation,
  lovdataPassages,
  lovdataVersion,
  missingPassages,
  retsinformationPassages,
  retsinformationStatus,
  riksdagenPassages,
  tarFile,
  type Passage,
} from "@/lib/legal-passages";
import { CELLAR_LANGUAGE, LEGAL_SOURCE_HOSTS, LEGAL_SOURCES, passagesNamed, type LegalLanguage, type LegalSource } from "@/lib/legal-sources";

import { log } from "./log";
import { safeFetch, type FetchOptions, type Fetched } from "./replicate-fetch";
import { typedRows } from "./typed-rows";

/**
 * Reads the official legal sources (D311, unit L, `docs/ai-autopilot.md` 8.2): each source of the register in each of its languages, fetched
 * by code from its official host only, cut into passages by `src/lib/legal-passages.ts`, checked for every passage a topic names, and kept
 * as a read (`commerce.legal_source_reads`) with its text stored once by hash (`commerce.legal_source_texts`). The only writer of both.
 * Runs in the five-minute dispatcher a few reads at a time: a source is read again a week after its last good read, a day after a failed
 * one. A failed read never replaces a good one: pages rest on the newest good read.
 */

/** A source read well is read again after this many days. */
export const READ_EVERY_DAYS = 7;
/** A failed read is tried again after this many hours. */
export const RETRY_HOURS = 24;
/** How many reads one run makes (each is one or two requests of up to a few hundred kilobytes). */
export const READS_PER_RUN = 3;
/** Reads older than this are pruned, except the newest good one of each source and language. */
export const KEEP_READS_DAYS = 90;

const MAX_BYTES = 4_000_000;
const TIMEOUT_MS = 20_000;

/** How a source is fetched; tests pass a stand-in. */
export type LegalFetch = (url: string, options: FetchOptions) => Promise<Fetched>;

const HOSTS: readonly string[] = LEGAL_SOURCE_HOSTS;

/** `safeFetch()` to the register's hosts only, the answer's own address included (a redirect elsewhere is refused). */
export const officialFetch: LegalFetch = async (url, options) => {
  if (!HOSTS.includes(new URL(url).hostname)) return { ok: false, problem: "That is not one of the official sources' hosts." };
  const fetched = await safeFetch(url, options);
  if (fetched.ok && !HOSTS.includes(new URL(fetched.url).hostname)) return { ok: false, problem: "The source redirected away from its official host." };
  return fetched;
};

/** `unpack` decompresses Lovdata's archive (bzip2); tests serve it unpacked. */
export type ReadDeps = { fetch?: LegalFetch; today?: string; unpack?: (bytes: Uint8Array) => Uint8Array };

const bunzip = (bytes: Uint8Array): Uint8Array => new Uint8Array(Bunzip.decode(bytes));

type Outcome = { ok: true; version: string; passages: Passage[] } | { ok: false; version: string | null; problem: string };

/** Lovdata's open data: every Norwegian act in force, updated with its amendments (NLOD 2.0). */
export const LOVDATA_ARCHIVE = "https://api.lovdata.no/v1/publicData/get/gjeldende-lover.tar.bz2";
const ARCHIVE_MAX_BYTES = 50_000_000;
const ARCHIVE_KEPT_MS = 10 * 60_000;

/** The archive, downloaded once for every Norwegian source read within a few minutes (one run reads several), decompressed. */
let archiveMemo: { fetch: LegalFetch; at: number; archive: Promise<{ ok: true; bytes: Uint8Array } | { ok: false; problem: string }> } | null = null;

function lovdataArchive(get: LegalFetch, unpack: (bytes: Uint8Array) => Uint8Array): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; problem: string }> {
  if (archiveMemo && archiveMemo.fetch === get && Date.now() - archiveMemo.at < ARCHIVE_KEPT_MS) return archiveMemo.archive;
  const archive = (async () => {
    const fetched = await get(LOVDATA_ARCHIVE, { maxBytes: ARCHIVE_MAX_BYTES, timeoutMs: 60_000, accept: "application/x-bzip2" });
    if (!fetched.ok) return { ok: false as const, problem: `Lovdata's open data could not be read: ${fetched.problem}` };
    try {
      return { ok: true as const, bytes: unpack(fetched.bytes) };
    } catch {
      return { ok: false as const, problem: "Lovdata's open data could not be unpacked." };
    }
  })();
  archiveMemo = { fetch: get, at: Date.now(), archive };
  return archive;
}

const text = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes);
const clip = (problem: string) => (problem.length > 500 ? `${problem.slice(0, 497)}...` : problem);

/** Fetches one source in one language and cuts it into passages, without writing anything. */
export async function fetchSource(source: LegalSource, language: LegalLanguage, deps: ReadDeps = {}): Promise<Outcome> {
  const get = deps.fetch ?? officialFetch;
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  if (!source.languages.includes(language)) return { ok: false, version: null, problem: `${source.key} has no text in ${language}.` };
  const route = source.route;
  let outcome: Outcome;
  switch (route.kind) {
    case "cellar": {
      if (language === "nb") return { ok: false, version: null, problem: "EU law has no Norwegian text in Cellar." };
      const query = `https://publications.europa.eu/webapi/rdf/sparql?query=${encodeURIComponent(consolidationQuery(route.celex))}`;
      const listed = await get(query, { maxBytes: 200_000, timeoutMs: TIMEOUT_MS, accept: "text/csv" });
      if (!listed.ok) return { ok: false, version: null, problem: `The list of consolidated versions could not be read: ${listed.problem}` };
      const version = latestConsolidation(text(listed.bytes), route.celex);
      const page = await get(`https://publications.europa.eu/resource/celex/${version}`, {
        maxBytes: MAX_BYTES,
        timeoutMs: TIMEOUT_MS,
        accept: "application/xhtml+xml",
        acceptLanguage: CELLAR_LANGUAGE[language],
      });
      if (!page.ok) return { ok: false, version, problem: `The act could not be read: ${page.problem}` };
      const passages = cellarPassages(text(page.bytes));
      const written = cellarLanguage(passages);
      if (passages.length > 0 && written !== language) return { ok: false, version, problem: `The act came back in ${written ?? "an unknown language"}, not ${language}.` };
      outcome = { ok: true, version, passages };
      break;
    }
    case "riksdagen": {
      const page = await get(`https://data.riksdagen.se/dokument/${route.doc}.text`, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS, accept: "text/plain" });
      if (!page.ok) return { ok: false, version: route.doc, problem: `The act could not be read: ${page.problem}` };
      const body = text(page.bytes);
      const sfs = route.doc.replace(/^sfs-(\d{4})-(\d+)$/, "$1:$2");
      if (!body.includes(`SFS nr:`) || !body.includes(sfs)) return { ok: false, version: route.doc, problem: `The answer is not SFS ${sfs}.` };
      outcome = { ok: true, version: route.doc, passages: riksdagenPassages(body, today) };
      break;
    }
    case "retsinformation": {
      const page = await get(`https://www.retsinformation.dk/eli/${route.eli}/xml`, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS, accept: "application/xml" });
      if (!page.ok) return { ok: false, version: route.eli, problem: `The act could not be read: ${page.problem}` };
      const body = text(page.bytes);
      const status = retsinformationStatus(body);
      if (status !== "Valid") return { ok: false, version: route.eli, problem: `The act is no longer in force (${status ?? "no status"}): the register needs its current version.` };
      outcome = { ok: true, version: route.eli, passages: retsinformationPassages(body) };
      break;
    }
    case "lovdata": {
      const archive = await lovdataArchive(get, deps.unpack ?? bunzip);
      if (!archive.ok) return { ok: false, version: route.file, problem: archive.problem };
      const file = tarFile(archive.bytes, `nl/${route.file}.xml`);
      if (!file) return { ok: false, version: route.file, problem: `The act ${route.file} is not in Lovdata's open data (repealed or renamed): the register needs it.` };
      const html = text(file);
      outcome = { ok: true, version: lovdataVersion(html) ?? route.file, passages: lovdataPassages(html) };
      break;
    }
  }
  if (!outcome.ok) return outcome;
  if (outcome.passages.length === 0) return { ok: false, version: outcome.version, problem: "No passages could be cut from the answer." };
  const missing = missingPassages(outcome.passages, passagesNamed(source.key));
  if (missing.length > 0) return { ok: false, version: outcome.version, problem: clip(`Passages the register names are not in the text: ${missing.join(", ")}.`) };
  return outcome;
}

/** The hash a text is stored by: sha256 of its passages as stored. */
export const textHash = (passages: readonly Passage[]): string => createHash("sha256").update(JSON.stringify(passages)).digest("hex");

/** Reads one source in one language and keeps the read. */
export async function readSource(source: LegalSource, language: LegalLanguage, deps: ReadDeps = {}): Promise<{ ok: boolean; problem?: string }> {
  let outcome: Outcome;
  try {
    outcome = await fetchSource(source, language, deps);
  } catch (error) {
    log("warn", "legal_source.read_threw", { source: source.key, language }, error);
    outcome = { ok: false, version: null, problem: "The read stopped with an error." };
  }
  if (outcome.ok) {
    const hash = textHash(outcome.passages);
    await db().transaction(async (tx) => {
      await tx.execute(sql`
        insert into commerce.legal_source_texts (hash, passages) values (${hash}, ${JSON.stringify(outcome.passages)}::jsonb)
        on conflict (hash) do nothing`);
      await tx.execute(sql`
        insert into commerce.legal_source_reads (source_key, language, version, status, text_hash, passage_count)
        values (${source.key}, ${language}, ${outcome.version}, 'ok', ${hash}, ${outcome.passages.length})`);
    });
    return { ok: true };
  }
  await db().execute(sql`
    insert into commerce.legal_source_reads (source_key, language, version, status, problem)
    values (${source.key}, ${language}, ${outcome.version}, 'failed', ${clip(outcome.problem)})`);
  log("warn", "legal_source.read_failed", { source: source.key, language });
  return { ok: false, problem: outcome.problem };
}

/** A `timestamptz` as node-postgres hands it over, as a Date. */
const when = z.union([z.date(), z.string()]).transform((v) => new Date(v));

const lastRead = z.object({ source_key: z.string(), language: z.string(), status: z.string(), read_at: when });

/** The source and language pairs due a read, the never-read first, then the longest waiting. */
export async function dueReads(now: Date = new Date()): Promise<{ source: LegalSource; language: LegalLanguage }[]> {
  const rows = await typedRows(
    lastRead,
    sql`select distinct on (source_key, language) source_key, language, status, read_at
        from commerce.legal_source_reads order by source_key, language, read_at desc`,
  );
  const last = new Map(rows.map((r) => [`${r.source_key} ${r.language}`, r]));
  const due: { source: LegalSource; language: LegalLanguage; since: number }[] = [];
  for (const source of LEGAL_SOURCES) {
    for (const language of source.languages) {
      const row = last.get(`${source.key} ${language}`);
      if (!row) {
        due.push({ source, language, since: 0 });
        continue;
      }
      const wait = row.status === "ok" ? READ_EVERY_DAYS * 86_400_000 : RETRY_HOURS * 3_600_000;
      if (now.getTime() - row.read_at.getTime() >= wait) due.push({ source, language, since: row.read_at.getTime() });
    }
  }
  return due.sort((a, b) => a.since - b.since).map(({ source, language }) => ({ source, language }));
}

/** The five-minute dispatcher's job: a few due reads, then old reads pruned. */
export async function readDueLegalSources(deps: ReadDeps = {}, now: Date = new Date()): Promise<{ read: number; failed: number; pruned: number }> {
  let read = 0;
  let failed = 0;
  for (const { source, language } of (await dueReads(now)).slice(0, READS_PER_RUN)) {
    const result = await readSource(source, language, deps);
    if (result.ok) read++;
    else failed++;
  }
  const pruned = await pruneLegalSourceReads(now);
  return { read, failed, pruned };
}

/** Reads older than `KEEP_READS_DAYS` go, except the newest good one of each source and language; then texts no read names. */
export async function pruneLegalSourceReads(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - KEEP_READS_DAYS * 86_400_000);
  const gone = await db().execute(sql`
    delete from commerce.legal_source_reads r
    where r.read_at < ${cutoff.toISOString()}::timestamptz
      and r.id not in (
        select distinct on (source_key, language) id from commerce.legal_source_reads
        where status = 'ok' order by source_key, language, read_at desc
      )
    returning r.id`);
  await db().execute(sql`
    delete from commerce.legal_source_texts t
    where not exists (select 1 from commerce.legal_source_reads r where r.text_hash = t.hash)`);
  return gone.length;
}

export type LegalText = { sourceKey: string; language: LegalLanguage; version: string | null; readAt: Date; passages: Passage[] };

const passageRow = z.object({ key: z.string(), title: z.string(), text: z.string() });
const current = z.object({
  source_key: z.string(),
  language: z.enum(["nb", "sv", "da", "en"]),
  version: z.string().nullable(),
  read_at: when,
  passages: z.array(passageRow),
});

/** The newest good read of every source and language, with its passages: what pages rest on (unit L2). */
export async function currentLegalTexts(): Promise<LegalText[]> {
  const rows = await typedRows(
    current,
    sql`select distinct on (r.source_key, r.language) r.source_key, r.language, r.version, r.read_at, t.passages
        from commerce.legal_source_reads r join commerce.legal_source_texts t on t.hash = r.text_hash
        where r.status = 'ok' order by r.source_key, r.language, r.read_at desc`,
  );
  return rows.map((r) => ({ sourceKey: r.source_key, language: r.language, version: r.version, readAt: r.read_at, passages: r.passages }));
}

export type SourceState = { sourceKey: string; language: LegalLanguage; lastGood: Date | null; version: string | null; lastFailed: { at: Date; problem: string } | null };

const stateRow = z.object({
  source_key: z.string(),
  language: z.enum(["nb", "sv", "da", "en"]),
  last_good: when.nullable(),
  version: z.string().nullable(),
  failed_at: when.nullable(),
  problem: z.string().nullable(),
});

/** Each source and language as last read: its newest good read, and a failure since then if any (for the platform's view and the report). */
export async function legalSourceStates(): Promise<SourceState[]> {
  const rows = await typedRows(
    stateRow,
    sql`select k.source_key, k.language, g.read_at as last_good, g.version, f.read_at as failed_at, f.problem
        from (select distinct source_key, language from commerce.legal_source_reads) k
        left join lateral (select read_at, version from commerce.legal_source_reads
          where source_key = k.source_key and language = k.language and status = 'ok' order by read_at desc limit 1) g on true
        left join lateral (select read_at, problem from commerce.legal_source_reads
          where source_key = k.source_key and language = k.language and status = 'failed' and (g.read_at is null or read_at > g.read_at)
          order by read_at desc limit 1) f on true
        order by k.source_key, k.language`,
  );
  return rows.map((r) => ({
    sourceKey: r.source_key,
    language: r.language,
    lastGood: r.last_good,
    version: r.version,
    lastFailed: r.failed_at && r.problem ? { at: r.failed_at, problem: r.problem } : null,
  }));
}
