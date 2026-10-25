import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { LegalFacts } from "@/lib/legal-facts";
import { jurisdictionsFor, LEGAL_SOURCES_BY_KEY, type LegalLanguage } from "@/lib/legal-sources";
import {
  isStarterRole,
  legalStarterSections,
  starterFactWords,
  starterLanguageOf,
  starterSlug,
  starterTitle,
  draftRows,
  type RenderedSection,
  type StarterRole,
} from "@/lib/legal-starters";
import {
  checkLegalDraft,
  factSheet,
  LEGAL_AI_WORDS,
  planLegalPage,
  readWriterAnswer,
  renderLegalPage,
  writerMessages,
  writerSettings,
  type ChatTurn,
  type CitedPassage,
  type SourceText,
} from "@/lib/legal-writer";

import { aiFor, AiError, completeText } from "./ai";
import { audit, passMembership, type Membership } from "./auth";
import { legalFacts } from "./legal-facts";
import { currentLegalTexts, readSourceKeys } from "./legal-sources";
import { makeDraftPage } from "./legal-starters";
import { log } from "./log";
import { ownerLanguages } from "./pages";
import { memberCan, NO_ACCESS } from "./permissions";
import type { Store } from "./stores";
import { typedRows } from "./typed-rows";

/**
 * The AI writing a store's legal pages (D311, unit L, `docs/ai-autopilot.md` 8.3, 8.4; L2): an owner asks for one kind of page
 * (`askForLegalPage()`); `runLegalWrites()` (after the press, and in the five-minute dispatcher) takes the write one language at a time:
 * the plan from the store's facts and the sources as read, one model call (and one more with the reasons when the checks refuse it), the
 * page made by code; when every language is done the page is saved as a **draft**, never published and never over an existing page. The
 * only writer of `commerce.legal_ai_writes`.
 */

/** Model calls for one language: the first, and one more told why the first was refused. */
export const WRITE_TRIES = 2;
const CLAIM_MS = 6 * 60_000;
const ANSWER_TOKENS = 12_000;

export type WriteStatus = "queued" | "running" | "written" | "failed";

type LanguageResult = { sections: RenderedSection[]; missing: string[]; cited: CitedPassage[] } | { problems: string[] };

export type WriterDeps = {
  /** The model's answer, or null without a text model; tests stand in for it. */
  complete?: (store: Store, accountId: string | null, messages: ChatTurn[]) => Promise<{ text: string; model: string } | null>;
  /** The sources as read (`currentLegalTexts()`). */
  texts?: SourceText[];
  now?: () => Date;
};

const defaultComplete: NonNullable<WriterDeps["complete"]> = async (store, accountId, messages) => {
  const connection = await aiFor(store.id, { feature: "legal_pages", accountId });
  if (!connection?.textModel) return null;
  const answer = await completeText(connection, messages, { maxTokens: ANSWER_TOKENS, temperature: 0.2, timeoutMs: 170_000 });
  return { text: answer.text, model: connection.textModel };
};

/** Why the AI cannot write a store's legal pages, or the law they would rest on. */
export type Availability = { ok: true } | { ok: false; reason: "country" | "ai" | "sources" };

export async function legalWriterAvailability(store: Store, facts?: LegalFacts, sourceKeys?: string[]): Promise<Availability> {
  const jurisdictions = jurisdictionsFor(facts ?? (await legalFacts(store)));
  if (jurisdictions.length === 0) return { ok: false, reason: "country" };
  const read = sourceKeys ?? (await readSourceKeys());
  if (!read.some((key) => {
    const j = LEGAL_SOURCES_BY_KEY[key]?.jurisdiction;
    return j !== undefined && jurisdictions.includes(j);
  }))
    return { ok: false, reason: "sources" };
  const connection = await aiFor(store.id, { feature: "legal_pages" });
  if (!connection?.textModel) return { ok: false, reason: "ai" };
  return { ok: true };
}

/** The languages a page is written in: the main one among nb, sv, da and en (else English), then the store's others among the four. */
export async function pageLanguages(storeId: string): Promise<{ languages: LegalLanguage[]; english: boolean }> {
  const all = await ownerLanguages(storeId);
  const main = starterLanguageOf(all[0]?.locale);
  if (main === null) return { languages: ["en"], english: true };
  const others = all
    .slice(1)
    .map((l) => starterLanguageOf(l.locale))
    .filter((l): l is LegalLanguage => l !== null && l !== main);
  return { languages: [main, ...new Set(others)], english: false };
}

/** Asks the AI to write one kind of legal page; while a write of that kind runs, the same one is answered. Owners only. */
export async function askForLegalPage(
  member: Membership,
  role: string,
  /** The sources with a good read (tests give them; else they are read). */
  options: { sourceKeys?: string[] } = {},
): Promise<{ ok: true; id: string; already: boolean } | { ok: false; problems: string[] }> {
  if (!memberCan(member, "owner")) return { ok: false, problems: [NO_ACCESS] };
  if (!isStarterRole(role)) return { ok: false, problems: ["The AI does not write that kind of page."] };
  const { store } = member;
  if (store.status !== "active" || store.isTemplate || store.starter) return { ok: false, problems: ["The AI writes legal pages for an open store only."] };
  const available = await legalWriterAvailability(store, undefined, options.sourceKeys);
  if (!available.ok) return { ok: false, problems: [available.reason] };
  const [made] = await db().execute<{ id: string }>(sql`
    insert into commerce.legal_ai_writes (store_id, account_id, role, why)
    values (${store.id}::uuid, ${member.account.id}::uuid, ${role}, 'asked')
    on conflict (store_id, role) where status in ('queued', 'running') do nothing
    returning id`);
  if (!made) {
    const [running] = await db().execute<{ id: string }>(sql`
      select id from commerce.legal_ai_writes where store_id = ${store.id}::uuid and role = ${role} and status in ('queued', 'running')`);
    return { ok: true, id: String(running.id), already: true };
  }
  await audit(member.account.id, store.id, "store.legal_ai_asked", { role, write: made.id }, { area: "website", target: { type: "store", id: store.id } });
  return { ok: true, id: String(made.id), already: false };
}

const writeRow = z.object({
  id: z.string(),
  store_id: z.string(),
  account_id: z.string().nullable(),
  role: z.string(),
  status: z.enum(["queued", "running", "written", "failed"]),
  results: z.record(z.string(), z.unknown()),
  model: z.string().nullable(),
  slug: z.string(),
});
type WriteRow = z.infer<typeof writeRow>;

/** Takes the oldest waiting write (or one whose claim ran out). */
async function claim(): Promise<WriteRow | null> {
  const [row] = await typedRows(
    writeRow,
    sql`
      update commerce.legal_ai_writes w set status = 'running', claimed_until = now() + ${`${CLAIM_MS} milliseconds`}::interval
      from commerce.stores s
      where s.id = w.store_id and w.id = (
        select id from commerce.legal_ai_writes
        where status = 'queued' or (status = 'running' and claimed_until < now())
        order by created_at limit 1 for update skip locked
      )
      returning w.id, w.store_id, w.account_id, w.role, w.status, w.results, w.model, s.slug`,
  );
  return row ?? null;
}

async function finish(id: string, status: "written" | "failed", fields: { pageId?: string; languages?: string[]; problems?: string[] }) {
  await db().execute(sql`
    update commerce.legal_ai_writes set status = ${status}, claimed_until = null, finished_at = now(),
      page_id = ${fields.pageId ?? null}::uuid,
      languages = (select array_agg(l) from jsonb_array_elements_text(${fields.languages ? JSON.stringify(fields.languages) : null}::jsonb) l),
      problems = ${fields.problems && fields.problems.length > 0 ? JSON.stringify(fields.problems) : null}::jsonb
    where id = ${id}::uuid`);
}

/** One language of a page: plan, the model (twice at most), the checks, the page made by code. */
export async function writeLanguage(input: {
  store: Store;
  accountId: string | null;
  role: StarterRole;
  language: LegalLanguage;
  facts: LegalFacts;
  texts: SourceText[];
  english: boolean;
  deps: WriterDeps;
}): Promise<{ result: LanguageResult; model: string | null }> {
  const { role, language, facts } = input;
  const sheet = factSheet(facts, starterFactWords(facts, language), language);
  const plan = planLegalPage({ role, language, facts, sheet, jurisdictions: jurisdictionsFor(facts), texts: input.texts });
  if (plan.sections.every((s) => s.passages.length === 0)) return { result: { problems: ["No official source could be read for this page yet."] }, model: null };
  const settings = writerSettings(facts);
  const complete = input.deps.complete ?? defaultComplete;
  let retry: { answer: string; problems: string[] } | undefined;
  let model: string | null = null;
  for (let attempt = 1; attempt <= WRITE_TRIES; attempt++) {
    let answer: { text: string; model: string } | null;
    try {
      answer = await complete(input.store, input.accountId, writerMessages(plan, sheet, settings, retry));
    } catch (error) {
      log("warn", "legal_writer.model_failed", { store: input.store.id, role, language }, error);
      return { result: { problems: [error instanceof AiError ? `The AI could not be reached: ${error.message}` : "The AI could not be reached."] }, model };
    }
    if (!answer) return { result: { problems: ["The store has no text model in its AI settings."] }, model };
    model = answer.model;
    const read = readWriterAnswer(answer.text);
    const checked = read.ok ? checkLegalDraft(read.sections, plan, sheet) : { ok: false as const, problems: [read.problem] };
    if (checked.ok && read.ok) {
      const starterForm = legalStarterSections("withdrawal_info", language, facts).find((s) => s.topic === "model_form") ?? null;
      const page = renderLegalPage({ plan, sections: read.sections, sheet, starterForm, writtenAt: (input.deps.now ?? (() => new Date()))(), english: input.english });
      return { result: page, model };
    }
    retry = { answer: answer.text.slice(0, 40_000), problems: checked.ok ? [] : checked.problems };
  }
  return { result: { problems: retry?.problems ?? ["The answer could not be used."] }, model };
}

/** Saves a write whose languages are all done: the main language's page, the others as its texts (D55), as a draft. */
async function savePageOf(member: Membership, write: WriteRow, results: Record<string, LanguageResult>, plan: { languages: LegalLanguage[]; english: boolean }) {
  const role = write.role as StarterRole;
  const main = plan.languages[0];
  const mainResult = results[main];
  if (!mainResult || "problems" in mainResult) {
    await finish(write.id, "failed", { problems: mainResult && "problems" in mainResult ? mainResult.problems : ["The page could not be written."] });
    return;
  }
  const made = await makeDraftPage(member, (language, id, translated) => {
    const result = results[language];
    if (!result || "problems" in result) return { ok: false, problems: ["not written"] };
    const title = starterTitle(role, language);
    return { ok: true, page: { title, slug: starterSlug(role, language), language, rows: draftRows(title, translated ? LEGAL_AI_WORDS.en.englishPage : null, result.sections, id) } };
  });
  if (!made.ok) {
    await finish(write.id, "failed", { problems: made.problems });
    return;
  }
  const written = [made.language, ...made.translations];
  const skipped = plan.languages.filter((l) => {
    const r = results[l];
    return !r || "problems" in r;
  });
  const problems = skipped.flatMap((l) => {
    const r = results[l];
    return r && "problems" in r ? r.problems.map((p) => `${l}: ${p}`) : [];
  });
  await finish(write.id, "written", { pageId: made.id, languages: written, problems });
  await audit(member.account.id, member.store.id, "store.legal_ai_draft_made", { role, page: made.id, languages: written, model: write.model }, { area: "website", target: { type: "page", id: made.id } });
}

/** One step of a write: the next language, or the save when all are done. */
async function step(write: WriteRow, deps: WriterDeps): Promise<void> {
  const member = write.account_id ? await passMembership(write.slug, write.account_id) : null;
  if (!member || !memberCan(member, "owner")) {
    await finish(write.id, "failed", { problems: ["The person who asked is no longer an owner of the store."] });
    return;
  }
  if (member.store.status !== "active") {
    await finish(write.id, "failed", { problems: ["The store is not open."] });
    return;
  }
  const role = write.role as StarterRole;
  const facts = await legalFacts(member.store);
  const plan = await pageLanguages(member.store.id);
  const results = write.results as Record<string, LanguageResult>;
  const next = plan.languages.find((l) => !(l in results));
  if (!next) {
    await savePageOf(member, write, results, plan);
    return;
  }
  const texts = deps.texts ?? (await currentLegalTexts());
  const { result, model } = await writeLanguage({ store: member.store, accountId: write.account_id, role, language: next, facts, texts, english: plan.english, deps });
  const all = { ...results, [next]: result };
  await db().execute(sql`
    update commerce.legal_ai_writes set results = ${JSON.stringify(all)}::jsonb, model = coalesce(${model}, model),
      claimed_until = now() + ${`${CLAIM_MS} milliseconds`}::interval
    where id = ${write.id}::uuid`);
  // The main language failing ends the write at once: no page without it.
  if (next === plan.languages[0] && "problems" in result) {
    await finish(write.id, "failed", { problems: result.problems });
    return;
  }
  if (plan.languages.every((l) => l in all)) await savePageOf(member, { ...write, results: all, model: model ?? write.model }, all, plan);
  else await db().execute(sql`update commerce.legal_ai_writes set status = 'queued', claimed_until = null where id = ${write.id}::uuid and status = 'running'`);
}

/** The job: steps of waiting writes until the time is used (after the press, and in the five-minute dispatcher). */
export async function runLegalWrites(deps: WriterDeps = {}, budgetMs = 120_000): Promise<{ steps: number }> {
  const start = Date.now();
  let steps = 0;
  while (Date.now() - start < budgetMs) {
    const write = await claim();
    if (!write) break;
    try {
      await step(write, deps);
    } catch (error) {
      log("error", "legal_writer.step_failed", { write: write.id }, error);
      await finish(write.id, "failed", { problems: ["The write stopped with an error."] });
    }
    steps++;
  }
  return { steps };
}

export type LegalWriteState = {
  id: string;
  role: string;
  status: WriteStatus;
  createdAt: Date;
  page: { id: string; title: string } | null;
  languages: string[];
  problems: string[];
};

const stateRow = z.object({
  id: z.string(),
  role: z.string(),
  status: z.enum(["queued", "running", "written", "failed"]),
  created_at: z.union([z.date(), z.string()]).transform((v) => new Date(v)),
  page_id: z.string().nullable(),
  title: z.string().nullable(),
  languages: z.array(z.string()).nullable(),
  problems: z.array(z.string()).nullable(),
});

/** The newest write of each kind for the Legal page. */
export async function legalWrites(storeId: string): Promise<Record<string, LegalWriteState>> {
  const rows = await typedRows(
    stateRow,
    sql`select distinct on (w.role) w.id, w.role, w.status, w.created_at, w.page_id, coalesce(nullif(p.draft ->> 'title', ''), p.slug) as title, w.languages, w.problems
        from commerce.legal_ai_writes w left join commerce.pages p on p.id = w.page_id and p.store_id = w.store_id
        where w.store_id = ${storeId}::uuid order by w.role, w.created_at desc`,
  );
  return Object.fromEntries(
    rows.map((r) => [
      r.role,
      {
        id: r.id,
        role: r.role,
        status: r.status,
        createdAt: r.created_at,
        page: r.page_id ? { id: r.page_id, title: r.title ?? "" } : null,
        languages: r.languages ?? [],
        problems: r.problems ?? [],
      },
    ]),
  );
}
