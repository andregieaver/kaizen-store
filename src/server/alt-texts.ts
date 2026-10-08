import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { altTextPrompt, parseAltTexts, splitAltTexts, type AltLanguage } from "@/lib/alt-text";
import { siteUrl } from "@/lib/site";

import { aiFor, AiError, completeText, imagePart, seeing, type AiConnection } from "./ai";
import { mediaUses, type MediaOwner } from "./media-library";
import { getStore } from "./stores";

type Row = Record<string, unknown>;

/**
 * Alt texts written by the site's AI (D89). The text model looks at each
 * picture in the owner's media library (its small copy, sent as bytes) and
 * writes what it shows in each of the site's languages, told the site's
 * name and where the picture is used; the texts are saved on the library
 * item, marked as the AI's, and the site shows them wherever a picture has
 * no alt text of its own (`commerce.media_alt()`, `libraryAlts()`). Staff's
 * alt texts are never written over. Without AI, or a model that sees
 * pictures, nothing is written and the reason is given.
 */

/** Pictures described at once, and at most per call from the library (each call is one model request per picture). */
const AT_ONCE = 4;
export const ALT_BATCH = 8;
/** The largest picture sent (its small copy is used when it has one). */
const MAX_BYTES = 4 * 1024 * 1024;
/** Types a text model that sees pictures reads. */
const SEEN_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export type AltSite = { name: string; languages: AltLanguage[] };

/** The site's name and languages, its main one first: a store's markets', or English for Kaizen. */
export async function altSite(owner: MediaOwner): Promise<AltSite | null> {
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  const language = (locale: string) => ({ locale, name: names.of(locale) ?? locale });
  if (!owner.storeId) return { name: "Kaizen", languages: [language("en")] };
  const store = owner.storeSlug ? await getStore(owner.storeSlug) : null;
  if (!store || store.markets.length === 0) return null;
  const locales = store.localization.locales;
  // English too, last, where the store sells in none: what people search the library in, and AI assistants read.
  const english = locales.some((locale) => locale.split("-")[0] === "en") ? [] : [{ ...language("en"), extra: true as const }];
  return { name: store.name, languages: [...locales.map(language), ...english] };
}

export type AltResult =
  | { ok: true; alt: string; translations: Record<string, string> }
  /** `ai`: the AI itself cannot, so every picture would fail the same way. */
  | { ok: false; problem: string; ai?: boolean };

/** Why a picture could not be described, for people. */
function problemOf(error: unknown): string {
  if (error instanceof AiError) {
    if (error.status === 400) return "The site's AI model could not look at the picture. Choose a model that sees pictures under AI settings (Model that sees pictures), and check it there.";
    return `The site's AI could not describe the picture: ${error.message}`;
  }
  return "The picture could not be described.";
}

/** The picture's bytes to send: its small copy's where it has one. */
async function pictureBytes(row: Row): Promise<{ bytes: Uint8Array; type: string } | { problem: string }> {
  const address = String(row.thumbnail_url ?? row.url);
  const url = new URL(address, siteUrl());
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch {
    return { problem: "The picture could not be fetched." };
  }
  if (!response.ok) return { problem: `The picture could not be fetched (${response.status}).` };
  const type = (response.headers.get("content-type") ?? String(row.content_type)).split(";")[0].trim().toLowerCase();
  if (!SEEN_TYPES.includes(type)) return { problem: `The AI does not read ${type} pictures.` };
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return { problem: "The picture is empty or too large to describe." };
  return { bytes, type };
}

/**
 * Writes one library picture's alt texts with the site's AI and saves
 * them as the AI's. `replace` also writes over staff's (the person asked
 * for it on that picture); otherwise a picture staff described is left.
 */
export async function writeAltText(
  owner: MediaOwner,
  id: string,
  options: { connection?: AiConnection | null; site?: AltSite | null; replace?: boolean } = {},
): Promise<AltResult> {
  const [row] = await db().execute<Row>(sql`
    select id, kind, url, thumbnail_url, file_name, content_type, alt_source from commerce.media
    where id = ${id}::uuid and ${owner.storeId ? sql`store_id = ${owner.storeId}::uuid` : sql`store_id is null`}
  `);
  if (!row) return { ok: false, problem: "That file is no longer in the library." };
  if (row.kind !== "image") return { ok: false, problem: "Alt texts are written for pictures only." };
  if (row.alt_source === "staff" && !options.replace) return { ok: false, problem: "Staff wrote this picture's alt text." };
  // The model that looks at pictures (D163), else the text model.
  const connection = seeing(options.connection === undefined ? await aiFor(owner.storeId, { feature: "media" }) : options.connection);
  if (!connection) return { ok: false, problem: "Set up an AI model that sees pictures under AI settings to write alt texts.", ai: true };
  const site = options.site === undefined ? await altSite(owner) : options.site;
  if (!site) return { ok: false, problem: "The store has no markets, so no language to write in." };

  const tried = () => db().execute(sql`update commerce.media set alt_tried_at = now() where id = ${id}::uuid`);
  const picture = await pictureBytes(row);
  if ("problem" in picture) {
    await tried();
    return { ok: false, problem: picture.problem };
  }
  const uses = (await mediaUses(owner, [id])).get(id) ?? [];
  const prompt = altTextPrompt({
    siteName: site.name,
    languages: site.languages,
    fileName: String(row.file_name),
    uses: uses.map((use) => use.label),
  });
  const locales = site.languages.map((language) => language.locale);
  let reply: string;
  try {
    ({ text: reply } = await completeText(
      connection,
      [
        { role: "system", content: prompt.system },
        { role: "user", content: [{ type: "text", text: prompt.user }, imagePart(connection, picture.bytes, picture.type)] },
      ],
      { maxTokens: 200 + 120 * locales.length, temperature: 0.2, reasoningEffort: "low", timeoutMs: 60_000 },
    ));
  } catch (error) {
    await tried();
    if (!(error instanceof AiError)) throw error;
    return { ok: false, problem: problemOf(error), ai: true };
  }
  const { texts } = parseAltTexts(reply, locales);
  const { alt, translations } = splitAltTexts(texts, locales[0]);
  if (!alt) {
    await tried();
    return { ok: false, problem: "The AI's alt text could not be used (it was missing, or made a claim the site does not allow)." };
  }
  // A language left out (a claim) waits a day before it is tried again; a whole answer needs no retry.
  const complete = locales.every((locale) => texts[locale]);
  // Staff may have written one meanwhile: theirs stays unless asked to replace it.
  const saved = await db().execute<Row>(sql`
    update commerce.media set alt = ${alt},
      -- A language the store keeps but does not show now (D178) keeps its text.
      alt_translations = (alt_translations - array[${sql.join(locales.map((locale) => sql`${locale}`), sql`, `)}]::text[]) || ${JSON.stringify(translations)}::jsonb, alt_source = 'ai',
      alt_written_at = now(), alt_tried_at = ${complete ? null : sql`now()`}, updated_at = now()
    where id = ${id}::uuid and (${Boolean(options.replace)} or alt_source is distinct from 'staff')
    returning id
  `);
  if (saved.length === 0) return { ok: false, problem: "Staff wrote this picture's alt text meanwhile." };
  return { ok: true, alt, translations };
}

export type AltRun = { written: number; failed: number; remaining: number; problem: string | null };

/**
 * Writes alt texts for the owner's pictures that need one, a batch at a
 * time: those without any, and with `rewrite` those the AI wrote before
 * `since` (the run's start, so a run ends). A picture tried and failed
 * since then waits for the next run. Stops at the first problem that is
 * the AI's rather than the picture's.
 */
export async function writeAltTexts(
  owner: MediaOwner,
  options: { since: Date; rewrite?: boolean; limit?: number },
): Promise<AltRun> {
  const [raw, site] = await Promise.all([aiFor(owner.storeId, { feature: "media" }), altSite(owner)]);
  const connection = seeing(raw);
  const due = await dueForAltText(owner, options.since, Boolean(options.rewrite), site);
  if (!connection) {
    return { written: 0, failed: 0, remaining: due.length, problem: "Set up an AI model that sees pictures under AI settings to write alt texts." };
  }
  const batch = due.slice(0, options.limit ?? ALT_BATCH);
  let written = 0;
  let failed = 0;
  let problem: string | null = null;
  let stop = false;
  for (let start = 0; start < batch.length && !stop; start += AT_ONCE) {
    const results = await Promise.all(batch.slice(start, start + AT_ONCE).map((id) => writeAltText(owner, id, { connection, site })));
    for (const result of results) {
      if (result.ok) written += 1;
      else {
        failed += 1;
        problem ??= result.problem;
        // The AI itself cannot do it: the rest would fail the same way, and that is what to say.
        if (result.ai) {
          problem = result.problem;
          stop = true;
        }
      }
    }
  }
  return { written, failed, remaining: due.length - written - failed, problem };
}

/**
 * The owner's pictures an alt-text run should write, oldest first: those
 * without any, those the AI wrote without one of the site's languages
 * (a market added since, or English), and with `rewrite` all the AI's.
 */
async function dueForAltText(owner: MediaOwner, since: Date, rewrite: boolean, site: AltSite | null): Promise<string[]> {
  const others = (site?.languages ?? []).slice(1).map((language) => language.locale);
  const at = since.toISOString();
  const rows = await db().execute<Row>(sql`
    select id from commerce.media
    where ${owner.storeId ? sql`store_id = ${owner.storeId}::uuid` : sql`store_id is null`}
      and kind = 'image' and content_type <> 'image/svg+xml'
      and (alt_tried_at is null or alt_tried_at < ${at}::timestamptz)
      and (alt_source is null
        ${others.length > 0 ? sql`or (alt_source = 'ai' and not alt_translations ?& array[${sql.join(others.map((locale) => sql`${locale}`), sql`, `)}]::text[])` : sql``}
        ${rewrite ? sql`or (alt_source = 'ai' and alt_written_at < ${at}::timestamptz)` : sql``})
    order by created_at
  `);
  return rows.map((row) => String(row.id));
}

/**
 * The five-minute cron's part (D89): new pictures get their alt texts
 * without anyone asking (and the AI's texts a language added since), a few per site and a few sites per run (those
 * waiting longest first), on sites whose AI has a text model. A picture
 * that could not be described waits a day. Returns the owners whose texts
 * changed, for their caches.
 */
export async function refreshAltTexts(perSite = 4, sitesPerRun = 5): Promise<{ owners: MediaOwner[]; written: number }> {
  const sites = await db().execute<Row>(sql`
    select m.store_id, s.slug from commerce.media m
    left join commerce.stores s on s.id = m.store_id
    where (m.store_id is null or (s.status = 'active' and not s.starter)) and m.kind = 'image' and m.content_type <> 'image/svg+xml' and (m.alt_source is null or m.alt_source = 'ai')
      and (m.alt_tried_at is null or m.alt_tried_at < now() - interval '1 day')
    group by m.store_id, s.slug
    order by min(m.created_at)
  `);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const owners: MediaOwner[] = [];
  for (const row of sites) {
    if (owners.length >= sitesPerRun) break;
    const owner = { storeId: row.store_id ? String(row.store_id) : null, storeSlug: row.slug ? String(row.slug) : null };
    if (!seeing(await aiFor(owner.storeId))) continue;
    if ((await dueForAltText(owner, since, false, await altSite(owner))).length > 0) owners.push(owner);
  }
  const runs = await Promise.all(owners.map((owner) => writeAltTexts(owner, { since, limit: perSite })));
  return {
    owners: owners.filter((_, index) => runs[index].written > 0),
    written: runs.reduce((sum, run) => sum + run.written, 0),
  };
}

/** How many of the owner's pictures have no alt text. */
export async function missingAltTexts(owner: MediaOwner): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.media
    where ${owner.storeId ? sql`store_id = ${owner.storeId}::uuid` : sql`store_id is null`}
      and kind = 'image' and alt_source is null
  `);
  return Number(row?.n ?? 0);
}
