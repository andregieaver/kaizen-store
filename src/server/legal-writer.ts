import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import type { LegalFacts } from "@/lib/legal-facts";
import { legalRoleNeeded } from "@/lib/legal-roles";
import { normalisedLegalText } from "@/lib/legal-passages";
import { jurisdictionsFor, LEGAL_SOURCES_BY_KEY, type LegalLanguage } from "@/lib/legal-sources";
import {
  isStarterRole,
  legalStarterSections,
  STARTER_ROLES,
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
import { featureOn } from "@/lib/store-features";

import { afterSaleOpen } from "./after-sale";
import { aiFor, AiError, completeText } from "./ai";
import { audit, passMembership, type Membership } from "./auth";
import { runningTestOf } from "./experiment-admin";
import { legalFacts } from "./legal-facts";
import { currentLegalTexts, readSourceKeys } from "./legal-sources";
import { draftContent, setLegalRole, type DraftBuilder } from "./legal-starters";
import { log } from "./log";
import { ownerLanguages, pagesTag, savePage } from "./pages";
import { memberCan, NO_ACCESS } from "./permissions";
import { refreshTag } from "./refresh";
import type { Store } from "./stores";
import { typedRows } from "./typed-rows";

/**
 * The AI writing and keeping a store's legal pages (D311, unit L, `docs/ai-autopilot.md` 8.3 to 8.6). An owner asks for one kind of page
 * (`askForLegalPage()`, L2), or turns the whole thing on (`turnOnLegalAi()`, L3), after which `runLegalUpkeep()` queues a write for each
 * kind the store needs and again when the store's facts or a cited passage of the law change. `runLegalWrites()` (after a press, and in the
 * five-minute dispatcher) takes each write one language at a time: the plan from the store's facts and the sources as read, one model call
 * (and one more with the reasons when the checks refuse it), the page made by code. The finished page is written into the kind's page as a
 * new version when that page is the AI's and no person changed it since, else saved as a draft beside it (`kept`); it is published when the
 * store has it on with `auto` and nothing is missing. The only writer of `commerce.legal_ai_writes` and `commerce.legal_ai_settings`.
 */

/** Model calls for one language: the first, and one more told why the first was refused. */
export const WRITE_TRIES = 2;
/** Writes the upkeep queues for one store in 24 hours at most; a burst of changes waits for the next day. */
export const LEGAL_WRITES_PER_DAY = 12;
/** How often the upkeep compares a store's facts and sources with its pages. */
export const UPKEEP_EVERY_HOURS = 24;
const UPKEEP_STORES_PER_RUN = 5;
/** The version of the sentence an owner agrees to when turning it on (`legal.ai.turnOn.sentence`); a change of its words raises it. */
export const LEGAL_AI_TERMS_VERSION = "2026-10-25";
const CLAIM_MS = 6 * 60_000;
const ANSWER_TOKENS = 12_000;

export type WriteStatus = "queued" | "running" | "written" | "published" | "kept" | "failed";
export type WriteWhy = "asked" | "first" | "source_changed" | "facts_changed";
export type PublishMode = "auto" | "ask";

/** A passage a page rests on, with the hash of its text as it was written from. */
type SourceMark = { source: string; passage: string; language: string; hash: string };

type LanguageResult = { sections: RenderedSection[]; missing: string[]; cited: CitedPassage[]; sources: SourceMark[] } | { problems: string[] };

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

const hashOf = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 32);

/** The hash a passage's text is compared by (normalised, so a change of spacing alone is not a change of the law). */
export const passageHash = (text: string) => hashOf(normalisedLegalText(text));

/** The hash of the facts a page is written from, with its languages. */
export const factsHash = (facts: LegalFacts, languages: readonly string[]) => hashOf({ facts, languages });

/** Why the AI cannot write a store's legal pages. */
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

const realOpenStore = (store: Store) => store.status === "active" && !store.isTemplate && !store.starter;

// ---------------------------------------------------------------------------
// The owner's choice
// ---------------------------------------------------------------------------

export type LegalAiSettings = { enabled: boolean; publish: PublishMode; turnedOnAt: Date | null; stoppedRoles: string[] };

const settingsRow = z.object({
  enabled: z.boolean(),
  publish: z.enum(["auto", "ask"]),
  turned_on_at: z.union([z.date(), z.string()]).nullable().transform((v) => (v === null ? null : new Date(v))),
  stopped_roles: z.array(z.string()),
});

/** The store's choice; off (with `auto` as the choice offered) when it never chose. */
export async function legalAiSettings(storeId: string): Promise<LegalAiSettings> {
  const [row] = await typedRows(settingsRow, sql`select enabled, publish, turned_on_at, stopped_roles from commerce.legal_ai_settings where store_id = ${storeId}::uuid`);
  return row ? { enabled: row.enabled, publish: row.publish, turnedOnAt: row.turned_on_at, stoppedRoles: row.stopped_roles } : { enabled: false, publish: "auto", turnedOnAt: null, stoppedRoles: [] };
}

const isPublishMode = (value: unknown): value is PublishMode => value === "auto" || value === "ask";

/**
 * Turns it on: the owner agreed to the sentence (its version kept), with their choice of publishing; queues the first write of every kind the
 * store needs at once. Owners only.
 */
export async function turnOnLegalAi(member: Membership, publish: unknown, options: { sourceKeys?: string[] } = {}): Promise<{ ok: true; queued: number } | { ok: false; problems: string[] }> {
  if (!memberCan(member, "owner")) return { ok: false, problems: [NO_ACCESS] };
  if (!isPublishMode(publish)) return { ok: false, problems: ["Choose whether pages are published at once or kept as drafts."] };
  if (!realOpenStore(member.store)) return { ok: false, problems: ["The AI writes legal pages for an open store only."] };
  const available = await legalWriterAvailability(member.store, undefined, options.sourceKeys);
  if (!available.ok) return { ok: false, problems: [available.reason] };
  await db().execute(sql`
    insert into commerce.legal_ai_settings (store_id, enabled, publish, agreed, turned_on_by, turned_on_at, checked_at, updated_at)
    values (${member.store.id}::uuid, true, ${publish}, ${LEGAL_AI_TERMS_VERSION}, ${member.account.id}::uuid, now(), now(), now())
    on conflict (store_id) do update set enabled = true, publish = excluded.publish, agreed = excluded.agreed, turned_on_by = excluded.turned_on_by,
      turned_on_at = excluded.turned_on_at, checked_at = excluded.checked_at, updated_at = now()`);
  await audit(member.account.id, member.store.id, "store.legal_ai_on", { publish, agreed: LEGAL_AI_TERMS_VERSION }, { area: "website", target: { type: "store", id: member.store.id } });
  const queued = await upkeepStore(member, null);
  return { ok: true, queued };
}

/** Turns it off: nothing more is written; every page stays as it is. */
export async function turnOffLegalAi(member: Membership): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  if (!memberCan(member, "owner")) return { ok: false, problems: [NO_ACCESS] };
  await db().execute(sql`update commerce.legal_ai_settings set enabled = false, updated_at = now() where store_id = ${member.store.id}::uuid`);
  // A write not started yet would publish after the owner said stop.
  await db().execute(sql`
    update commerce.legal_ai_writes set status = 'failed', finished_at = now(), problems = '["Turned off before it was written."]'::jsonb
    where store_id = ${member.store.id}::uuid and status = 'queued' and why <> 'asked'`);
  await audit(member.account.id, member.store.id, "store.legal_ai_off", {}, { area: "website", target: { type: "store", id: member.store.id } });
  return { ok: true };
}

export async function setLegalAiPublish(member: Membership, publish: unknown): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  if (!memberCan(member, "owner")) return { ok: false, problems: [NO_ACCESS] };
  if (!isPublishMode(publish)) return { ok: false, problems: ["Choose whether pages are published at once or kept as drafts."] };
  await db().execute(sql`update commerce.legal_ai_settings set publish = ${publish}, updated_at = now() where store_id = ${member.store.id}::uuid`);
  await audit(member.account.id, member.store.id, "store.legal_ai_publish", { publish }, { area: "website", target: { type: "store", id: member.store.id } });
  return { ok: true };
}

/** The owner stops the AI writing one kind of page; it is never written again until handed back. */
export async function stopLegalPage(member: Membership, role: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  if (!memberCan(member, "owner")) return { ok: false, problems: [NO_ACCESS] };
  if (!isStarterRole(role)) return { ok: false, problems: ["The AI does not write that kind of page."] };
  await db().execute(sql`
    insert into commerce.legal_ai_settings (store_id, stopped_roles) values (${member.store.id}::uuid, array[${role}]::text[])
    on conflict (store_id) do update set stopped_roles = (select array_agg(distinct r) from unnest(commerce.legal_ai_settings.stopped_roles || array[${role}]::text[]) r), updated_at = now()`);
  await db().execute(sql`
    update commerce.legal_ai_writes set status = 'failed', finished_at = now(), problems = '["Stopped by the owner."]'::jsonb
    where store_id = ${member.store.id}::uuid and role = ${role} and status = 'queued'`);
  await audit(member.account.id, member.store.id, "store.legal_ai_stopped", { role }, { area: "website", target: { type: "store", id: member.store.id } });
  return { ok: true };
}

/** The owner hands a kind of page back: the AI writes it again, over the page chosen for it even where a person changed it. */
export async function handBackLegalPage(member: Membership, role: string, options: { sourceKeys?: string[] } = {}): Promise<{ ok: true; id: string } | { ok: false; problems: string[] }> {
  if (!memberCan(member, "owner")) return { ok: false, problems: [NO_ACCESS] };
  if (!isStarterRole(role)) return { ok: false, problems: ["The AI does not write that kind of page."] };
  await db().execute(sql`
    update commerce.legal_ai_settings set stopped_roles = array_remove(stopped_roles, ${role}), updated_at = now() where store_id = ${member.store.id}::uuid`);
  const asked = await askForLegalPage(member, role, { ...options, overwrite: true });
  if (!asked.ok) return asked;
  await audit(member.account.id, member.store.id, "store.legal_ai_handed_back", { role }, { area: "website", target: { type: "store", id: member.store.id } });
  return { ok: true, id: asked.id };
}

// ---------------------------------------------------------------------------
// Asking and queueing
// ---------------------------------------------------------------------------

/** Queues a write unless one of the kind runs; null when one runs (its id is then found) or the day's writes are used. */
async function queueWrite(storeId: string, accountId: string, role: StarterRole, why: WriteWhy, overwrite: boolean): Promise<string | null> {
  const [made] = await db().execute<{ id: string }>(sql`
    insert into commerce.legal_ai_writes (store_id, account_id, role, why, overwrite)
    values (${storeId}::uuid, ${accountId}::uuid, ${role}, ${why}, ${overwrite})
    on conflict (store_id, role) where status in ('queued', 'running') do nothing
    returning id`);
  return made ? String(made.id) : null;
}

/** Asks the AI to write one kind of legal page; while a write of that kind runs, the same one is answered. Owners only. */
export async function askForLegalPage(
  member: Membership,
  role: string,
  /** The sources with a good read (tests give them; else they are read); `overwrite`: handed back, so it may write over a person's page. */
  options: { sourceKeys?: string[]; overwrite?: boolean } = {},
): Promise<{ ok: true; id: string; already: boolean } | { ok: false; problems: string[] }> {
  if (!memberCan(member, "owner")) return { ok: false, problems: [NO_ACCESS] };
  if (!isStarterRole(role)) return { ok: false, problems: ["The AI does not write that kind of page."] };
  const { store } = member;
  if (!realOpenStore(store)) return { ok: false, problems: ["The AI writes legal pages for an open store only."] };
  const available = await legalWriterAvailability(store, undefined, options.sourceKeys);
  if (!available.ok) return { ok: false, problems: [available.reason] };
  const made = await queueWrite(store.id, member.account.id, role, "asked", Boolean(options.overwrite));
  if (!made) {
    const [running] = await db().execute<{ id: string }>(sql`
      select id from commerce.legal_ai_writes where store_id = ${store.id}::uuid and role = ${role} and status in ('queued', 'running')`);
    return { ok: true, id: String(running.id), already: true };
  }
  await audit(member.account.id, store.id, "store.legal_ai_asked", { role, write: made }, { area: "website", target: { type: "store", id: store.id } });
  return { ok: true, id: made, already: false };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const writeRow = z.object({
  id: z.string(),
  store_id: z.string(),
  account_id: z.string().nullable(),
  role: z.string(),
  why: z.enum(["asked", "first", "source_changed", "facts_changed"]),
  status: z.enum(["queued", "running", "written", "published", "kept", "failed"]),
  results: z.record(z.string(), z.unknown()),
  model: z.string().nullable(),
  overwrite: z.boolean(),
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
      returning w.id, w.store_id, w.account_id, w.role, w.why, w.status, w.results, w.model, w.overwrite, s.slug`,
  );
  return row ?? null;
}

type Finish = { pageId?: string; languages?: string[]; problems?: string[]; sources?: SourceMark[]; factsHash?: string; savedHash?: string | null };

async function finish(id: string, status: "written" | "published" | "kept" | "failed", fields: Finish) {
  await db().execute(sql`
    update commerce.legal_ai_writes set status = ${status}, claimed_until = null, finished_at = now(),
      page_id = ${fields.pageId ?? null}::uuid,
      languages = (select array_agg(l) from jsonb_array_elements_text(${fields.languages ? JSON.stringify(fields.languages) : null}::jsonb) l),
      problems = ${fields.problems && fields.problems.length > 0 ? JSON.stringify(fields.problems) : null}::jsonb,
      sources = ${fields.sources ? JSON.stringify(fields.sources) : null}::jsonb,
      facts_hash = ${fields.factsHash ?? null}, saved_hash = ${fields.savedHash ?? null}
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
      // Each passage cited, with the hash of the text it was written from, so the upkeep knows when the law it rests on changes.
      const sources = page.cited.flatMap((c) => {
        const offered = plan.offered.get(`${c.source}|${c.passage}`);
        return offered ? [{ source: c.source, passage: c.passage, language: offered.language, hash: passageHash(offered.text) }] : [];
      });
      return { result: { ...page, sources }, model };
    }
    retry = { answer: answer.text.slice(0, 40_000), problems: checked.ok ? [] : checked.problems };
  }
  return { result: { problems: retry?.problems ?? ["The answer could not be used."] }, model };
}

const pageRow = z.object({ id: z.string(), slug: z.string(), hash: z.string() });

/** The page chosen for a kind, with the md5 of its draft as stored. */
async function rolePage(storeId: string, role: StarterRole) {
  const [row] = await typedRows(
    pageRow,
    sql`select p.id, p.slug, md5(p.draft::text) as hash from commerce.page_roles r join commerce.pages p on p.id = r.page_id and p.store_id = r.store_id
        where r.store_id = ${storeId}::uuid and r.role = ${role}`,
  );
  return row ?? null;
}

/** Whether a page is the AI's and nobody changed it since: a write of the store saved exactly the draft it holds now. */
async function untouchedAiPage(storeId: string, page: { id: string; hash: string }): Promise<boolean> {
  const [row] = await db().execute<{ n: string }>(sql`
    select count(*)::text as n from commerce.legal_ai_writes where store_id = ${storeId}::uuid and page_id = ${page.id}::uuid and saved_hash = ${page.hash}`);
  return Number(row?.n ?? 0) > 0;
}

async function savedHashOf(pageId: string): Promise<string | null> {
  const [row] = await db().execute<{ hash: string }>(sql`select md5(draft::text) as hash from commerce.pages where id = ${pageId}::uuid`);
  return row ? String(row.hash) : null;
}

/**
 * The draft an earlier write of this kind made beside the kind's page (or for a kind with no page), when nobody changed it since: written
 * again in place, so a person's page gets one AI draft beside it, not one per change.
 */
async function draftBeside(storeId: string, role: StarterRole, notId: string | null) {
  const [row] = await typedRows(
    pageRow,
    sql`select p.id, p.slug, md5(p.draft::text) as hash from commerce.legal_ai_writes w
        join commerce.pages p on p.id = w.page_id and p.store_id = w.store_id
        where w.store_id = ${storeId}::uuid and w.role = ${role} and w.status in ('kept', 'written') and w.saved_hash = md5(p.draft::text)
          and p.published is null and (${notId}::uuid is null or p.id <> ${notId}::uuid)
        order by w.finished_at desc nulls last limit 1`,
  );
  return row ?? null;
}

/** Saves a page as new, trying the kind's address and then `-2`, `-3` where it is taken. */
async function saveNew(member: Membership, content: Record<string, unknown>, slug: string, publish: boolean) {
  let made: Awaited<ReturnType<typeof savePage>> | null = null;
  for (let n = 1; n <= 8; n++) {
    made = await savePage(member.account, member.store.id, null, { ...content, slug: n === 1 ? slug : `${slug}-${n}` }, { publish, type: "page" });
    if (made.ok || !made.problems.some((p) => /address|slug/i.test(p))) break;
  }
  return made;
}

/**
 * Saves a write whose languages are all done. Into the kind's page as a new version when it is the AI's and unchanged by a person (or handed
 * back); otherwise a new page, beside a person's page (`kept`) or in the kind's place when it had none. Published when the store has it on
 * with `auto`, nothing is missing and the page is in no running test; a refused publish leaves the draft and says why.
 */
async function savePageOf(member: Membership, write: WriteRow, results: Record<string, LanguageResult>, plan: { languages: LegalLanguage[]; english: boolean }, facts: LegalFacts) {
  const role = write.role as StarterRole;
  const main = plan.languages[0];
  const mainResult = results[main];
  if (!mainResult || "problems" in mainResult) {
    await finish(write.id, "failed", { problems: mainResult && "problems" in mainResult ? mainResult.problems : ["The page could not be written."] });
    return;
  }
  const done = plan.languages.flatMap((l) => {
    const r = results[l];
    return r && !("problems" in r) ? [{ language: l, result: r }] : [];
  });
  const missing = [...new Set(done.flatMap((d) => d.result.missing))];
  const sources = done.flatMap((d) => d.result.sources);
  const skippedProblems = plan.languages.flatMap((l) => {
    const r = results[l];
    return r && "problems" in r ? r.problems.map((p) => `${l}: ${p}`) : [];
  });
  const build: DraftBuilder = (language, id, translated) => {
    const result = results[language];
    if (!result || "problems" in result) return { ok: false, problems: ["not written"] };
    const title = starterTitle(role, language);
    return { ok: true, page: { title, slug: starterSlug(role, language), language, rows: draftRows(title, translated ? LEGAL_AI_WORDS.en.englishPage : null, result.sections, id) } };
  };
  const built = await draftContent(member.store.id, build);
  if (!built.ok) {
    await finish(write.id, "failed", { problems: built.problems });
    return;
  }
  const settings = await legalAiSettings(member.store.id);
  const current = await rolePage(member.store.id, role);
  const inTest = current ? await runningTestOf(member.store.id, current.id) : null;
  const intoCurrent = current !== null && !inTest && (write.overwrite || (await untouchedAiPage(member.store.id, current)));
  const kept = current !== null && !intoCurrent;
  const wantsPublish = settings.enabled && settings.publish === "auto" && missing.length === 0 && !kept;
  const problems = [...skippedProblems];
  if (missing.length > 0 && settings.enabled && settings.publish === "auto") problems.push(`Not published: the page needs details the store has not given (${missing.join(", ")}).`);
  if (inTest) problems.push("The page chosen for it is in a running A/B test, so the AI made a draft beside it.");
  else if (kept) problems.push("The page chosen for it was written or changed by a person, so the AI left it alone and made a draft beside it.");

  let pageId: string;
  let published = false;
  const content = built.content as unknown as Record<string, unknown>;
  const beside = intoCurrent || wantsPublish ? null : await draftBeside(member.store.id, role, current?.id ?? null);
  if (intoCurrent && current) {
    // A new version of the kind's own page, at its own address.
    let saved = await savePage(member.account, member.store.id, current.id, { ...content, slug: current.slug }, { publish: wantsPublish, type: "page" });
    if (!saved.ok && wantsPublish) {
      problems.push(`Not published: ${saved.problems.join(" ")}`);
      saved = await savePage(member.account, member.store.id, current.id, { ...content, slug: current.slug }, { publish: false, type: "page" });
    }
    if (!saved.ok) {
      await finish(write.id, "failed", { problems: saved.problems });
      return;
    }
    pageId = current.id;
    published = wantsPublish && problems.every((p) => !p.startsWith("Not published"));
  } else if (beside) {
    // The AI's own draft from before, still as it left it: a new version of it.
    const saved = await savePage(member.account, member.store.id, beside.id, { ...content, slug: beside.slug }, { publish: false, type: "page" });
    if (!saved.ok) {
      await finish(write.id, "failed", { problems: saved.problems });
      return;
    }
    pageId = beside.id;
  } else {
    let made = await saveNew(member, content, built.starter.slug, wantsPublish);
    if (made && !made.ok && wantsPublish) {
      problems.push(`Not published: ${made.problems.join(" ")}`);
      made = await saveNew(member, content, built.starter.slug, false);
    }
    if (!made || !made.ok) {
      await finish(write.id, "failed", { problems: made ? made.problems : ["The page could not be made."] });
      return;
    }
    pageId = made.id;
    published = wantsPublish && problems.every((p) => !p.startsWith("Not published"));
    // A kind with no page gets this one in its place once it is published.
    if (published && current === null) {
      const placed = await setLegalRole(member, role, pageId);
      if (!placed.ok) problems.push(`Published, but not chosen for its place: ${placed.problems.join(" ")}`);
    }
  }
  refreshTag(pagesTag(member.store.id));
  const languages = [built.language, ...built.translations];
  const status = kept ? "kept" : published ? "published" : "written";
  await finish(write.id, status, {
    pageId,
    languages,
    problems,
    sources,
    factsHash: factsHash(facts, plan.languages),
    savedHash: await savedHashOf(pageId),
  });
  await audit(
    member.account.id,
    member.store.id,
    published ? "store.legal_ai_published" : "store.legal_ai_draft_made",
    { role, page: pageId, languages, model: write.model, why: write.why, ...(kept && { kept: true }) },
    { area: "website", target: { type: "page", id: pageId } },
  );
}

/** One step of a write: the next language, or the save when all are done. */
async function step(write: WriteRow, deps: WriterDeps): Promise<void> {
  const member = write.account_id ? await passMembership(write.slug, write.account_id) : null;
  if (!member || !memberCan(member, "owner")) {
    await finish(write.id, "failed", { problems: ["The person it writes for is no longer an owner of the store."] });
    return;
  }
  if (member.store.status !== "active") {
    await finish(write.id, "failed", { problems: ["The store is not open."] });
    return;
  }
  const role = write.role as StarterRole;
  // The upkeep's writes stop when the owner turned it off or stopped the kind since they were queued.
  if (write.why !== "asked") {
    const settings = await legalAiSettings(member.store.id);
    if (!settings.enabled || settings.stoppedRoles.includes(role)) {
      await finish(write.id, "failed", { problems: [settings.enabled ? "Stopped by the owner." : "Turned off before it was written."] });
      return;
    }
  }
  const facts = await legalFacts(member.store);
  const plan = await pageLanguages(member.store.id);
  const results = write.results as Record<string, LanguageResult>;
  const next = plan.languages.find((l) => !(l in results));
  if (!next) {
    await savePageOf(member, write, results, plan, facts);
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
  if (plan.languages.every((l) => l in all)) await savePageOf(member, { ...write, results: all, model: model ?? write.model }, all, plan, facts);
  else await db().execute(sql`update commerce.legal_ai_writes set status = 'queued', claimed_until = null where id = ${write.id}::uuid and status = 'running'`);
}

/** The job: steps of waiting writes until the time is used (after a press, and in the five-minute dispatcher). */
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

// ---------------------------------------------------------------------------
// Keeping current
// ---------------------------------------------------------------------------

const latestRow = z.object({
  role: z.string(),
  status: z.enum(["written", "published", "kept", "failed"]),
  facts_hash: z.string().nullable(),
  sources: z.array(z.object({ source: z.string(), passage: z.string(), language: z.string(), hash: z.string() })).nullable(),
});

/** Whether a passage a page rests on reads differently now (one no longer found counts as changed). */
function sourcesChanged(marks: readonly SourceMark[], texts: readonly SourceText[]): boolean {
  const byText = new Map(texts.map((t) => [`${t.sourceKey}|${t.language}`, t]));
  return marks.some((m) => {
    const text = byText.get(`${m.source}|${m.language}`);
    if (!text) return false; // A source not read now is not evidence of a change.
    const passage = text.passages.find((p) => p.key === m.passage);
    return !passage || passageHash(passage.text) !== m.hash;
  });
}

/**
 * Compares one store's pages with its facts and the law now, and queues a write for each kind that needs one: never written (`first`), its
 * facts changed (`facts_changed`) or a passage it cites changed (`source_changed`). Kinds the store does not need or the owner stopped are
 * left; at most `LEGAL_WRITES_PER_DAY` writes a day.
 */
async function upkeepStore(member: Membership, texts: SourceText[] | null): Promise<number> {
  const { store } = member;
  const settings = await legalAiSettings(store.id);
  if (!settings.enabled) return 0;
  const [{ n: today }] = await db().execute<{ n: string }>(sql`
    select count(*)::text as n from commerce.legal_ai_writes where store_id = ${store.id}::uuid and why <> 'asked' and created_at > now() - interval '24 hours'`);
  let room = LEGAL_WRITES_PER_DAY - Number(today);
  if (room <= 0) return 0;
  const facts = await legalFacts(store);
  const plan = await pageLanguages(store.id);
  const hash = factsHash(facts, plan.languages);
  const shopOn = featureOn(store, "shop");
  const afterSale = shopOn || (await afterSaleOpen(store.id));
  const latest = await typedRows(
    latestRow,
    sql`select distinct on (role) role, status, facts_hash, sources from commerce.legal_ai_writes
        where store_id = ${store.id}::uuid and status in ('written', 'published', 'kept', 'failed') order by role, finished_at desc nulls last`,
  );
  const byRole = new Map(latest.map((r) => [r.role, r]));
  let read: SourceText[] | null = texts;
  let queued = 0;
  for (const role of STARTER_ROLES) {
    if (room <= 0) break;
    if (!legalRoleNeeded(role, shopOn, afterSale) || settings.stoppedRoles.includes(role)) continue;
    const last = byRole.get(role);
    let why: WriteWhy | null = null;
    if (!last || last.status === "failed" || last.facts_hash === null) why = "first";
    else if (last.facts_hash !== hash) why = "facts_changed";
    else {
      read ??= await currentLegalTexts();
      if (sourcesChanged(last.sources ?? [], read)) why = "source_changed";
    }
    if (!why) continue;
    if (await queueWrite(store.id, member.account.id, role, why, false)) {
      queued++;
      room--;
    }
  }
  return queued;
}

const dueStore = z.object({ store_id: z.string(), slug: z.string(), turned_on_by: z.string().nullable() });

/** The five-minute dispatcher's upkeep: a few stores with it on whose last comparison is older than `UPKEEP_EVERY_HOURS`. */
export async function runLegalUpkeep(deps: { texts?: SourceText[] } = {}): Promise<{ stores: number; queued: number }> {
  const due = await typedRows(
    dueStore,
    sql`
      update commerce.legal_ai_settings a set checked_at = now()
      from commerce.stores s
      where s.id = a.store_id and a.store_id in (
        select x.store_id from commerce.legal_ai_settings x join commerce.stores y on y.id = x.store_id
        where x.enabled and y.status = 'active' and not (y.is_template or y.starter)
          and (x.checked_at is null or x.checked_at < now() - ${`${UPKEEP_EVERY_HOURS} hours`}::interval)
        order by x.checked_at nulls first limit ${UPKEEP_STORES_PER_RUN} for update of x skip locked
      )
      returning a.store_id, s.slug, a.turned_on_by`,
  );
  let texts: SourceText[] | null = deps.texts ?? null;
  let queued = 0;
  for (const row of due) {
    const member = row.turned_on_by ? await passMembership(row.slug, row.turned_on_by) : null;
    if (!member || !memberCan(member, "owner")) {
      log("warn", "legal_upkeep.no_owner", { store: row.store_id });
      continue;
    }
    texts ??= await currentLegalTexts();
    try {
      queued += await upkeepStore(member, texts);
    } catch (error) {
      log("error", "legal_upkeep.store_failed", { store: row.store_id }, error);
    }
  }
  return { stores: due.length, queued };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type LegalWriteState = {
  id: string;
  role: string;
  why: WriteWhy;
  status: WriteStatus;
  createdAt: Date;
  finishedAt: Date | null;
  page: { id: string; title: string } | null;
  languages: string[];
  problems: string[];
};

const stateRow = z.object({
  id: z.string(),
  role: z.string(),
  why: z.enum(["asked", "first", "source_changed", "facts_changed"]),
  status: z.enum(["queued", "running", "written", "published", "kept", "failed"]),
  created_at: z.union([z.date(), z.string()]).transform((v) => new Date(v)),
  finished_at: z.union([z.date(), z.string()]).nullable().transform((v) => (v === null ? null : new Date(v))),
  page_id: z.string().nullable(),
  title: z.string().nullable(),
  languages: z.array(z.string()).nullable(),
  problems: z.array(z.string()).nullable(),
});

/** The newest write of each kind for the Legal page and the AI manager. */
export async function legalWrites(storeId: string): Promise<Record<string, LegalWriteState>> {
  const rows = await typedRows(
    stateRow,
    sql`select distinct on (w.role) w.id, w.role, w.why, w.status, w.created_at, w.finished_at, w.page_id,
          coalesce(nullif(p.draft ->> 'title', ''), p.slug) as title, w.languages, w.problems
        from commerce.legal_ai_writes w left join commerce.pages p on p.id = w.page_id and p.store_id = w.store_id
        where w.store_id = ${storeId}::uuid order by w.role, w.created_at desc`,
  );
  return Object.fromEntries(
    rows.map((r) => [
      r.role,
      {
        id: r.id,
        role: r.role,
        why: r.why,
        status: r.status,
        createdAt: r.created_at,
        finishedAt: r.finished_at,
        page: r.page_id ? { id: r.page_id, title: r.title ?? "" } : null,
        languages: r.languages ?? [],
        problems: r.problems ?? [],
      },
    ]),
  );
}

const STATUS_WORDS: Record<WriteStatus, string> = {
  queued: "waiting to be written",
  running: "being written",
  written: "written as a draft",
  published: "written and published",
  kept: "drafted beside the page a person wrote",
  failed: "not written",
};
const WHY_WORDS: Record<WriteWhy, string> = { asked: "asked for", first: "the first write", source_changed: "the law it cites changed", facts_changed: "the store's details changed" };

/** The AI manager's `legal_pages_status` (read-only, owners): whether it is on, and where each kind of page stands. */
export async function legalStatusTool(ctx: { store: Store }) {
  const [settings, writes, available] = await Promise.all([legalAiSettings(ctx.store.id), legalWrites(ctx.store.id), legalWriterAvailability(ctx.store)]);
  return {
    on: settings.enabled,
    publishing: settings.publish === "auto" ? "published as soon as the checks pass" : "kept as drafts for the owner to publish",
    ...(available.ok ? {} : { cannotWrite: available.reason === "country" ? "the store is not established in Norway, Sweden or Denmark" : available.reason === "ai" ? "no text model is set" : "the official sources have not been read yet" }),
    pages: STARTER_ROLES.map((role) => {
      const w = writes[role];
      return {
        kind: role,
        stopped: settings.stoppedRoles.includes(role),
        ...(w
          ? { status: STATUS_WORDS[w.status], because: WHY_WORDS[w.why], when: (w.finishedAt ?? w.createdAt).toISOString().slice(0, 10), page: w.page?.title ?? null, problems: w.problems }
          : { status: "never written by the AI" }),
      };
    }),
    note: "The owner turns this on, chooses publishing, stops or hands back a page and writes one again on Settings → Legal; no tool changes it.",
  };
}
