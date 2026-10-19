import "server-only";

import { sql } from "drizzle-orm";

import { db, readDb } from "@/db/client";
import { designPreviewPath, parseDesignSnapshot } from "@/lib/design-presets";
import { variationsOf } from "@/lib/design-variations";
import type { Shot } from "@/lib/theme-shoot";
import { swatchOf, themeLooks } from "@/lib/theme-store";
import {
  SHOT_RESTS,
  SHOT_TRIES,
  SHOT_TRIES_ALL,
  afterFailedTry,
  missingShots,
  shotProblem,
  readShotParts,
  readShotPictures,
  shotFolder,
  shotKey,
  shotPaths,
  supersededShots,
  wantedShots,
  type LookShots,
  type ShotKind,
  type ShotParts,
  type ShotPictures,
  type ShotTheme,
  type StoredShot,
  type UnitKind,
  type WantedShot,
} from "@/lib/theme-shots";

import { audit, type Account } from "./auth";
import { removeStoredFiles, uploadBytes } from "./media";
import { publishedContents } from "./store-starters";
import { composeHighlights } from "./theme-highlights";
import { pictureIsBlank, shotFiles, type MadeFile } from "./theme-shot-files";

/**
 * The photographs of published themes' looks (`docs/theme-showcase-phase-2.md` step 1): what is wanted and queued, each unit claimed and
 * taken by the job (`/api/cron/theme-shots`, whose runner brings the browser: nothing here loads Chromium), the sets no longer wanted
 * pruned with their files, and the reads of the theme store and the platform's admin.
 */

type Row = Record<string, unknown>;

/** How long a unit is held by the run that took it: past this, another run may take it again. */
const CLAIM = "3 minutes";
/** Sets no longer wanted are kept this long, as cached pages still name their files. */
const KEEP_SUPERSEDED = "7 days";
/** Why a photograph of one flat colour is not kept (D279): it counts as a try, and the look is photographed again. */
export const BLANK_PAGE = "The page was still blank when it was photographed. It is tried again.";

/** Every published, unarchived theme with a readable snapshot and a version, each look on the theme's own published content (D275). */
async function publishedThemes(): Promise<ShotTheme[]> {
  const [rows, contents] = await Promise.all([
    readDb().execute<Row>(sql`
      select p.id, p.title, p.snapshot,
             (select max(v.number) from commerce.design_preset_versions v where v.preset_id = p.id) as version
        from commerce.design_presets p
       where p.published and p.archived_at is null
    `),
    publishedContents(),
  ]);
  return rows.flatMap((row) => {
    const snapshot = parseDesignSnapshot(row.snapshot);
    const version = Number(row.version);
    if (!snapshot || !Number.isInteger(version) || version < 1) return [];
    const presets = variationsOf(snapshot).map((v) => ({ key: v.key, name: v.name }));
    const looks = themeLooks(String(row.title), presets, contents.get(String(row.id)) ?? null).map((look) => ({ variation: look.key, starterId: look.showcase?.starterId ?? null }));
    return [{ id: String(row.id), version, looks }];
  });
}

/**
 * The store each showcase draws: a published demo store's frozen copy (as the public preview). A look on no published demo store is
 * photographed nowhere (D274): the theme store never shows the Standard store, so it waits until its demo store is published.
 */
async function showcaseStores(): Promise<(starterId: string | null) => string | null> {
  const starters = await readDb().execute<Row>(sql`
    select st.id, s.id as store_id from commerce.store_starters st
      join commerce.stores s on s.id = coalesce(st.published_store_id, st.store_id) and s.starter and s.status = 'active'
     where st.published and st.archived_at is null
  `);
  const byStarter = new Map(starters.map((row) => [String(row.id), String(row.store_id)]));
  return (starterId) => (starterId === null ? null : (byStarter.get(starterId) ?? null));
}

/** What should be photographed now. */
export async function wantedNow(): Promise<WantedShot[]> {
  const [themes, storeOf] = await Promise.all([publishedThemes(), showcaseStores()]);
  return wantedShots(themes, storeOf);
}

const storedOf = (row: Row): StoredShot => ({
  id: String(row.id),
  presetId: String(row.preset_id),
  version: Number(row.version),
  variation: row.variation ? String(row.variation) : null,
  starterId: row.starter_id ? String(row.starter_id) : null,
  showcaseStoreId: String(row.showcase_store_id),
  kind: String(row.kind) as UnitKind,
  status: String(row.status) as StoredShot["status"],
});

/**
 * Brings the queue in line with what is wanted (`wanted`, else worked out now): units wanted and missing are added, units no longer wanted
 * set aside (`supersededShots()`), and a unit whose last try's claim ran out on its last try is `failed`. Returns what is wanted.
 */
export async function queueThemeShots(wanted?: WantedShot[]): Promise<WantedShot[]> {
  const want = wanted ?? (await wantedNow());
  const stored = (await db().execute<Row>(sql`
    select id, preset_id, version, variation, starter_id, showcase_store_id, kind, status from commerce.theme_shots where status <> 'superseded'
  `)).map(storedOf);
  const missing = missingShots(stored, want);
  for (const shot of missing) {
    // A unit set aside and wanted again (a theme published again without a new version) comes back: done if its pictures are still kept.
    await db().execute(sql`
      insert into commerce.theme_shots as t (preset_id, version, variation, starter_id, showcase_store_id, kind)
      values (${shot.presetId}::uuid, ${shot.version}, ${shot.variation}, ${shot.starterId}::uuid, ${shot.showcaseStoreId}::uuid, ${shot.kind})
      on conflict on constraint theme_shots_unit do update
        set status = case when t.pictures is not null and t.finished_at is not null then 'done' else 'waiting' end,
            superseded_at = null, tries = 0, problem = null, claimed_until = null
        where t.status = 'superseded'
    `);
  }
  const aside = supersededShots(stored, want);
  if (aside.length > 0) {
    await db().execute(sql`
      update commerce.theme_shots set status = 'superseded', superseded_at = now(), claimed_until = null
       where id = any(${`{${aside.join(",")}}`}::uuid[]) and status <> 'superseded'
    `);
  }
  // A run that stopped at the end of a round (its function ended under it): the unit rests before the next round, or fails after the last.
  await db().execute(sql`
    update commerce.theme_shots
       set status = case when tries >= ${SHOT_TRIES_ALL} then 'failed' else 'waiting' end,
           claimed_until = case when tries >= ${SHOT_TRIES_ALL} then null else now() + ${REST_OF_TRIES} end,
           problem = coalesce(problem, 'The look did not finish being photographed in time.')
     where status = 'running' and claimed_until < now() and tries % ${SHOT_TRIES} = 0
  `);
  return want;
}

/** The rest before a unit's next round, by how many tries it has had (`SHOT_RESTS`), as SQL over the row's `tries`. */
const REST_OF_TRIES = sql.raw(
  `(case tries ${SHOT_RESTS.map((rest, round) => `when ${(round + 1) * SHOT_TRIES} then interval '${rest}'`).join(" ")} else interval '${SHOT_RESTS[0]}' end)`,
);

/** A unit as the job takes it. */
export type ClaimedShot = StoredShot & { tries: number };

/** Which units a run may take: every theme's (the job), or only these themes' (a test sharing its database with others). */
export type ShotScope = { presetIds?: readonly string[] };

/**
 * Takes the oldest unit waiting (or one whose run stopped), for this run alone; null when there is none, or while another unit is being
 * photographed. One look at a time across every run: the job starts every minute and a run takes looks for up to `RUN_MS`, so runs overlap, and
 * two browsers at once in one function ran it out of memory ("The browser stopped …", found on the signature themes). The claim is made
 * under a lock of its own, so two runs never both see none running.
 */
export async function claimThemeShot(scope: ShotScope = {}): Promise<ClaimedShot | null> {
  const ids = scope.presetIds ? `{${scope.presetIds.join(",")}}` : null;
  const only = ids ? sql`and t.preset_id = any(${ids}::uuid[])` : sql``;
  const busy = ids ? sql`and r.preset_id = any(${ids}::uuid[])` : sql``;
  const [row] = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('commerce.theme_shots.claim'))`);
    return tx.execute<Row>(sql`
    update commerce.theme_shots s set status = 'running', tries = s.tries + 1, claimed_until = now() + ${CLAIM}::interval
     where not exists (select 1 from commerce.theme_shots r where r.status = 'running' and r.claimed_until >= now() ${busy})
       and s.id = (
       select t.id from commerce.theme_shots t
        -- A waiting unit after its rest, if it has one (D284); a run that stopped mid-round is taken again at once.
        where ((t.status = 'waiting' and (t.claimed_until is null or t.claimed_until < now()))
            or (t.status = 'running' and t.claimed_until < now() and t.tries % ${SHOT_TRIES} <> 0))
          and t.tries < ${SHOT_TRIES_ALL} ${only}
          -- Highlights are composed from the look's two photographs: only once both are made.
          and (t.kind <> 'highlights' or (
            select count(*) from commerce.theme_shots x
             where x.preset_id = t.preset_id and x.version = t.version and x.variation is not distinct from t.variation
               and x.showcase_store_id = t.showcase_store_id and x.kind in ('computer', 'phone') and x.status = 'done') = 2)
        order by t.created_at, t.id
        for update skip locked
        limit 1
     )
    returning s.id, s.preset_id, s.version, s.variation, s.starter_id, s.showcase_store_id, s.kind, s.status, s.tries
  `);
  });
  return row ? { ...storedOf(row), tries: Number(row.tries) } : null;
}

/** Where the browser looks for a unit's look: the public preview of the published look on its showcase, alone. */
export const shotPreviewUrl = (origin: string, shot: Pick<WantedShot, "presetId" | "starterId" | "variation">): string =>
  `${origin}${designPreviewPath(shot.presetId, shot.starterId, false, false, true, shot.variation)}`;

/** What taking a unit needs from outside: the photographer (a browser), the bucket, and reading a stored file back. Injected, so tests need none. */
export type ShotDeps = {
  photograph: (url: string, kind: ShotKind) => Promise<Shot>;
  upload?: (path: string, bytes: Uint8Array, contentType: string) => Promise<{ ok: true; url: string } | { ok: false; problem: string }>;
  remove?: (paths: string[]) => Promise<boolean>;
  /** A stored picture's bytes, by its public address (the highlights read the look's photographs back). */
  fetchFile?: (url: string) => Promise<Buffer>;
};

const fetchFile = (deps: ShotDeps) =>
  deps.fetchFile ??
  (async (url: string) => {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error("A photograph of the look could not be read back.");
    return Buffer.from(await response.arrayBuffer());
  });

/** What a unit made, ready to store: from a width's photograph (`shotFiles()`), or the highlights composed from the look's two. */
async function madeFiles(shot: ClaimedShot, origin: string, deps: ShotDeps): Promise<{ files: MadeFile[]; parts: ShotParts | null }> {
  if (shot.kind !== "highlights") {
    const taken = await deps.photograph(shotPreviewUrl(origin, shot), shot.kind);
    // Kept as a failed try, so the look is photographed again rather than shown blank.
    if (await pictureIsBlank(taken.screen)) throw new Error(BLANK_PAGE);
    return { files: await shotFiles(shot.kind, taken), parts: taken.parts };
  }
  const rows = await db().execute<Row>(sql`
    select kind, pictures, parts from commerce.theme_shots
     where preset_id = ${shot.presetId}::uuid and version = ${shot.version} and variation is not distinct from ${shot.variation}
       and showcase_store_id = ${shot.showcaseStoreId}::uuid and kind in ('computer', 'phone') and status = 'done'
  `);
  const of = (kind: ShotKind) => rows.find((row) => row.kind === kind);
  const computer = readShotPictures(of("computer")?.pictures);
  const phone = readShotPictures(of("phone")?.pictures);
  if (!computer.full || !computer.screen || !phone.full || !phone.screen) throw new Error("The look's photographs are not all made yet.");
  const [theme] = await db().execute<Row>(sql`select snapshot from commerce.design_presets where id = ${shot.presetId}::uuid`);
  const snapshot = theme ? parseDesignSnapshot(theme.snapshot) : null;
  if (!snapshot) throw new Error("The theme's published look could not be read.");
  const read = fetchFile(deps);
  const highlights = await composeHighlights({
    computerFull: await read(computer.full.url),
    computerScreen: await read(computer.screen.url),
    detail: computer.detail ? await read(computer.detail.url) : null,
    phoneFull: await read(phone.full.url),
    phoneScreen: await read(phone.screen.url),
    parts: readShotParts(of("computer")?.parts),
    phoneParts: readShotParts(of("phone")?.parts),
    palette: swatchOf(snapshot),
  });
  return {
    files: highlights.map((h) => ({ kind: h.kind, bytes: h.bytes, contentType: "image/webp" as const, extension: "webp" as const, width: h.width, height: h.height })),
    parts: null,
  };
}

const upload = (deps: ShotDeps) => deps.upload ?? ((path: string, bytes: Uint8Array, type: string) => uploadBytes("product-media", path, bytes, type));
const remove = (deps: ShotDeps) => deps.remove ?? ((paths: string[]) => removeStoredFiles("product-media", paths));

/**
 * Photographs a claimed unit, if it is still wanted (otherwise it is set aside), makes its pictures, stores them, and only then marks it
 * done. A failure is kept as a plain sentence and the unit waits for its next try (or is `failed` after its last). Returns what became of it.
 */
export async function takeThemeShot(shot: ClaimedShot, wanted: readonly WantedShot[], origin: string, deps: ShotDeps): Promise<"done" | "superseded" | "waiting" | "failed"> {
  if (!wanted.some((w) => shotKey(w) === shotKey(shot))) {
    await db().execute(sql`update commerce.theme_shots set status = 'superseded', superseded_at = now(), claimed_until = null where id = ${shot.id}::uuid`);
    return "superseded";
  }
  const stored: string[] = [];
  try {
    const { files, parts } = await madeFiles(shot, origin, deps);
    const pictures: ShotPictures = {};
    for (const file of files) {
      const path = `${shotFolder(shot.presetId, shot.id)}/${shot.kind}-${file.kind}.${file.extension}`;
      const put = await upload(deps)(path, file.bytes, file.contentType);
      if (!put.ok) throw new Error(put.problem);
      stored.push(path);
      pictures[file.kind] = { path, url: put.url, width: file.width, height: file.height, bytes: file.bytes.length };
    }
    const [done] = await db().execute<Row>(sql`
      update commerce.theme_shots set status = 'done', pictures = ${JSON.stringify(pictures)}::jsonb, parts = ${parts ? JSON.stringify(parts) : null}::jsonb,
             finished_at = now(), claimed_until = null, problem = null
       where id = ${shot.id}::uuid and status = 'running'
      returning id
    `);
    // Set aside while it was being photographed: its files are not kept.
    if (!done) {
      await remove(deps)(stored);
      return "superseded";
    }
    // The look's older sets are no longer what it shows: set aside now, pruned with their files a week later.
    await db().execute(sql`
      update commerce.theme_shots set status = 'superseded', superseded_at = now(), claimed_until = null
       where preset_id = ${shot.presetId}::uuid and variation is not distinct from ${shot.variation} and kind = ${shot.kind}
         and status = 'done' and id <> ${shot.id}::uuid and (version < ${shot.version} or showcase_store_id <> ${shot.showcaseStoreId}::uuid)
    `);
    return "done";
  } catch (error) {
    if (stored.length > 0) await remove(deps)(stored).catch(() => false);
    const problem = shotProblem(error);
    console.error(`[theme-shots] ${shot.kind} of ${shot.presetId} (${shot.variation ?? "own look"}), try ${shot.tries}:`, error);
    // Tried again at once within a round; at a round's end it rests (D284) and is tried again by itself; after the last round it fails.
    const next = afterFailedTry(shot.tries);
    await db().execute(sql`
      update commerce.theme_shots
         set status = ${next.next === "failed" ? "failed" : "waiting"}, problem = ${problem},
             claimed_until = ${next.next === "rest" ? sql`now() + ${next.rest}::interval` : sql`null`}
       where id = ${shot.id}::uuid and status = 'running'
    `);
    return next.next === "failed" ? "failed" : "waiting";
  }
}

/** Removes the files and rows of units set aside more than a week ago. Returns how many went. */
export async function pruneThemeShots(deps: Pick<ShotDeps, "remove"> = {}): Promise<number> {
  const rows = await db().execute<Row>(sql`
    select id, pictures from commerce.theme_shots where status = 'superseded' and superseded_at < now() - ${KEEP_SUPERSEDED}::interval
    order by superseded_at limit 200
  `);
  if (rows.length === 0) return 0;
  const paths = rows.flatMap((row) => shotPaths(readShotPictures(row.pictures)));
  // A file that cannot be removed now stays with its row, to be tried again on the next run.
  if (paths.length > 0 && !(await remove(deps as ShotDeps)(paths))) return 0;
  await db().execute(sql`delete from commerce.theme_shots where id = any(${`{${rows.map((r) => String(r.id)).join(",")}}`}::uuid[])`);
  return rows.length;
}

/** How long a unit's look may take, browser and all: a run starts another only while it has this much time left. */
export const SHOT_MS = 45_000;

/**
 * One run of the job: the queue brought in line, then units taken one after another until `deadline` (a time in milliseconds) leaves too
 * little time for another, then the old sets pruned. Returns how many units were done, for the route to refresh the theme store.
 */
export async function runThemeShots(origin: string, deadline: number, deps: ShotDeps, scope: ShotScope = {}, now: () => number = Date.now): Promise<{ done: number; taken: number }> {
  const wanted = await queueThemeShots();
  let done = 0;
  let taken = 0;
  while (now() + SHOT_MS < deadline) {
    const shot = await claimThemeShot(scope);
    if (!shot) break;
    taken++;
    if ((await takeThemeShot(shot, wanted, origin, deps)) === "done") done++;
  }
  await pruneThemeShots(deps).catch((error) => console.error("[theme-shots] prune failed:", error));
  return { done, taken };
}

/* ------------------------------------------------------------------------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------------------------------------------------------------------------- */

/** A look's key in the reads: the theme and the preset (empty for its own look). */
export const lookOf = (presetId: string, variation: string | null): string => `${presetId}|${variation ?? ""}`;

/**
 * The latest done set of each look of these themes, at each width: what the theme store shows. Only sets taken on a demo store, never on
 * the Standard store (D274: sets made there before are set aside by the queue, and left out here at once).
 */
export async function themeShotsFor(presetIds: readonly string[]): Promise<Map<string, LookShots>> {
  const out = new Map<string, LookShots>();
  if (presetIds.length === 0) return out;
  const rows = await readDb().execute<Row>(sql`
    select distinct on (t.preset_id, coalesce(t.variation, ''), t.kind) t.preset_id, t.variation, t.kind, t.version, t.pictures
      from commerce.theme_shots t join commerce.stores s on s.id = t.showcase_store_id and s.starter
     where t.status = 'done' and t.preset_id = any(${`{${presetIds.join(",")}}`}::uuid[])
     order by t.preset_id, coalesce(t.variation, ''), t.kind, t.finished_at desc
  `);
  for (const row of rows) {
    const key = lookOf(String(row.preset_id), row.variation ? String(row.variation) : null);
    const look = out.get(key) ?? { computer: null, phone: null, version: null };
    const kind = String(row.kind);
    if (kind === "computer" || kind === "phone" || kind === "highlights") look[kind] = readShotPictures(row.pictures);
    look.version = Math.max(look.version ?? 0, Number(row.version));
    out.set(key, look);
  }
  return out;
}

/** A unit as the platform's admin sees it on a theme's page. */
export type ShotStatus = {
  variation: string | null;
  kind: UnitKind;
  version: number;
  status: StoredShot["status"];
  problem: string | null;
  finishedAt: string | null;
  /** A waiting unit that failed a round of tries: when it is tried again by itself (D284). */
  retryAt: string | null;
  pictures: ShotPictures;
};

/** A theme's units not set aside, newest first per look and width: what is made, being made, or could not be made. */
export async function themeShotStatus(presetId: string): Promise<ShotStatus[]> {
  const rows = await readDb().execute<Row>(sql`
    select distinct on (coalesce(variation, ''), kind) variation, kind, version, status, problem, finished_at, pictures,
           case when status = 'waiting' and claimed_until > now() then claimed_until end as retry_at
      from commerce.theme_shots where preset_id = ${presetId}::uuid and status <> 'superseded'
     order by coalesce(variation, ''), kind, version desc, created_at desc
  `);
  return rows.map((row) => ({
    variation: row.variation ? String(row.variation) : null,
    kind: String(row.kind) as UnitKind,
    version: Number(row.version),
    status: String(row.status) as StoredShot["status"],
    problem: row.problem ? String(row.problem) : null,
    finishedAt: row.finished_at ? new Date(String(row.finished_at)).toISOString() : null,
    retryAt: row.retry_at ? new Date(String(row.retry_at)).toISOString() : null,
    pictures: readShotPictures(row.pictures),
  }));
}

/** *Try again* on a theme's pictures that could not be made, or rest before trying again (D284): their tries start over now. Platform admins only. */
export async function retryThemeShots(admin: Account, presetId: string): Promise<number> {
  if (!admin.platformAdmin) return 0;
  const rows = await db().execute<Row>(sql`
    update commerce.theme_shots set status = 'waiting', tries = 0, problem = null, claimed_until = null
     where preset_id = ${presetId}::uuid and (status = 'failed' or (status = 'waiting' and claimed_until > now())) returning id
  `);
  if (rows.length > 0) await audit(admin.id, null, "platform.theme_shots_retried", { preset: presetId, units: rows.length }, { target: { type: "design_preset", id: presetId } });
  return rows.length;
}

/** Asks for pictures now (after a publish or a change of where a look is shown), so the admin sees them waiting; never fails its caller. */
export async function askForThemeShots(): Promise<void> {
  await queueThemeShots().catch((error) => console.error("[theme-shots] queue failed:", error));
}
