import "server-only";

import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { consentVersion } from "@/lib/cookie-consent";
import { liveCustomCode } from "@/lib/custom-code";
import { publicEnv } from "@/lib/env";
import type { MapLayout } from "@/lib/heat-read";
import { mapCookies, mapViewport, pageOfKey } from "@/lib/map-shot-url";
import type { MapCookie, MapShot, MapViewport } from "@/lib/map-shoot";
import type { HeatDevice } from "@/lib/page-heat";
import { marketUrl } from "@/lib/paths";
import { lookProblem } from "@/lib/replicate-look";
import { supabaseKeyKind } from "@/lib/supabase-key";

import { runningExperiments } from "./experiments";
import { log } from "./log";
import { siteCookies } from "./site-cookies";
import { currentStore, storeSlugOf, type Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The pictures under heatmaps (D656, `docs/heatmaps-and-recordings.md` 9): a robot's photograph of a store page per page shape, device and
 * A/B version, with where each anchor sits on it. The heatmap asks for one when it opens (`requestMapShot()`); the page looks' route takes
 * the waiting ones after its looks (`runMapShots()`), one browser per picture; the admin shows it through a signed address
 * (`mapShotPicture()`). Files live in the private `page-maps` bucket, `{storeId}/{id}.jpg`, read and written only here.
 */

export const MAP_BUCKET = "page-maps";
/** One picture within this long, Chromium's start included. */
export const MAP_SHOT_MS = 60_000;
/** At most this many pictures a run. */
export const MAP_SHOTS_PER_RUN = 6;
/** A picture older than this is taken again when its heatmap opens. */
export const MAP_SHOT_FRESH_DAYS = 14;
/** A failed picture is tried again when its heatmap opens, after this long. */
const RETRY_FAILED_MINUTES = 60;
const CLAIM_MINUTES = 5;
/** Pictures nobody asked for in this long go, with their files. */
export const MAP_SHOT_KEEP_DAYS = 90;
export const PRIVATE_STORE_PROBLEM = "The store is private, so its pages cannot be photographed.";

export type MapFiles = {
  upload(path: string, bytes: Uint8Array): Promise<boolean>;
  signedUrl(path: string, seconds: number): Promise<string | null>;
  remove(paths: string[]): Promise<boolean>;
};

export type MapShotDeps = {
  /** One picture of one page, in a browser of its own (`browserMapPhotographer`). */
  photograph: (url: string, viewport: MapViewport, cookies: readonly MapCookie[]) => Promise<MapShot>;
  files?: MapFiles | null;
};

export const mapPathOf = (storeId: string, id: string) => `${storeId}/${id}.jpg`;

/** The bucket behind the secret key, or null when this server has none (no picture is then taken). */
export function mapFiles(): MapFiles | null {
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key || supabaseKeyKind(key) === "publishable") return null;
  let url: string;
  try {
    url = publicEnv().NEXT_PUBLIC_SUPABASE_URL;
  } catch {
    return null;
  }
  const bucket = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(MAP_BUCKET);
  return {
    async upload(path, bytes) {
      const { error } = await bucket.upload(path, bytes, { contentType: "image/jpeg", cacheControl: "0", upsert: true });
      if (error) log("error", "map_shots.store_failed", {}, error);
      return !error;
    },
    async signedUrl(path, seconds) {
      const { data, error } = await bucket.createSignedUrl(path, seconds);
      return error || !data ? null : data.signedUrl;
    },
    async remove(paths) {
      if (paths.length === 0) return true;
      const { error } = await bucket.remove(paths);
      if (error) log("error", "map_shots.remove_failed", {}, error);
      return !error;
    },
  };
}

const SHOT = z.object({
  id: col.uuid,
  status: z.enum(["waiting", "taking", "done", "failed"]),
  shot_at: col.timestampOrNull,
  width: col.int.nullable(),
  height: col.int.nullable(),
  layout: z.unknown().nullable(),
  problem: col.textOrNull,
});

export type MapShotRow = { id: string; status: "waiting" | "taking" | "done" | "failed"; shotAt: string | null; width: number | null; height: number | null; layout: MapLayout | null; problem: string | null };

const asRow = (r: z.output<typeof SHOT>): MapShotRow => ({
  id: r.id,
  status: r.status,
  shotAt: r.shot_at,
  width: r.width,
  height: r.height,
  layout: (r.layout as MapLayout | null) ?? null,
  problem: r.problem,
});

/** The picture of a page shape, device and version as it stands, or null when none was asked for. */
export async function mapShotOf(storeId: string, page: string, device: HeatDevice, tag: string): Promise<MapShotRow | null> {
  const row = await typedRow(
    SHOT,
    sql`select id, status, shot_at, width, height, layout, problem from commerce.page_map_shots
        where store_id = ${storeId}::uuid and page = ${page} and device = ${device} and tag = ${tag}`,
  );
  return row ? asRow(row) : null;
}

/**
 * Asks for a picture: a waiting row when there is none, the one there is older than 14 days, it failed over an hour ago, or `again` (the
 * owner pressed Take a new picture). A row being taken is left alone. Returns the row as it now stands.
 */
export async function requestMapShot(storeId: string, page: string, device: HeatDevice, tag: string, again = false): Promise<MapShotRow> {
  const row = await typedRow(
    SHOT,
    sql`insert into commerce.page_map_shots as m (store_id, page, device, tag) values (${storeId}::uuid, ${page}, ${device}, ${tag})
        on conflict (store_id, page, device, tag) do update set status = 'waiting', requested_at = now(), problem = null, claimed_until = null
          where m.status <> 'taking' and m.status <> 'waiting' and (
            ${again}
            or (m.status = 'done' and m.shot_at < now() - make_interval(days => ${MAP_SHOT_FRESH_DAYS}))
            or (m.status = 'failed' and m.requested_at < now() - make_interval(mins => ${RETRY_FAILED_MINUTES})))
        returning id, status, shot_at, width, height, layout, problem`,
  );
  if (row) return asRow(row);
  return (await mapShotOf(storeId, page, device, tag))!;
}

const CLAIMED = z.object({ id: col.uuid, store_id: col.uuid, page: col.text, device: z.enum(["mobile", "tablet", "desktop"]), tag: col.text });

async function claim(): Promise<z.output<typeof CLAIMED> | null> {
  return typedRow(
    CLAIMED,
    sql`update commerce.page_map_shots set status = 'taking', claimed_until = now() + make_interval(mins => ${CLAIM_MINUTES})
        where id = (select id from commerce.page_map_shots
                    where status = 'waiting' or (status = 'taking' and claimed_until < now())
                    order by requested_at limit 1 for update skip locked)
        returning id, store_id, page, device, tag`,
  );
}

/** Where a picture is taken and with which cookies; a problem in words when it cannot be. */
export async function mapShotTarget(
  store: Store,
  page: string,
  device: HeatDevice,
  tag: string,
): Promise<{ url: string; viewport: MapViewport; cookies: MapCookie[] } | { problem: string }> {
  if (store.privateMode) return { problem: PRIVATE_STORE_PROBLEM };
  const place = pageOfKey(page);
  const market = place ? store.markets.find((m) => m.slug === place.market) : undefined;
  if (!place || !market) return { problem: "The store no longer sells where this page was measured." };
  if (tag) {
    const experiment = tag.slice(0, 36);
    if (!(await runningExperiments(store.id)).some((e) => e.id === experiment)) return { problem: "The test has ended, so this version is no longer shown." };
  }
  const { categories, extras } = await siteCookies(store.id, store.tracking, liveCustomCode(store.customCode));
  return {
    url: marketUrl(store.slug, market.slug, place.path),
    viewport: mapViewport(store.theme.settings, device),
    cookies: mapCookies(store.id, consentVersion(categories, extras), tag),
  };
}

const failWith = async (shot: { id: string; store_id: string }, problem: string) => {
  await db().execute(sql`
    update commerce.page_map_shots set status = 'failed', problem = ${problem.slice(0, 200)}, claimed_until = null
    where id = ${shot.id}::uuid and store_id = ${shot.store_id}::uuid
  `);
};

/** Takes one waiting picture: claimed, photographed, stored. True when one was taken (done or failed). */
async function takeOne(deps: MapShotDeps, files: MapFiles): Promise<boolean> {
  const shot = await claim();
  if (!shot) return false;
  try {
    const slug = await storeSlugOf(shot.store_id);
    const store = slug ? await currentStore(slug) : null;
    if (!store || store.status !== "active") {
      await failWith(shot, "The store is not open, so its pages were not photographed.");
      return true;
    }
    const target = await mapShotTarget(store, shot.page, shot.device, shot.tag);
    if ("problem" in target) {
      await failWith(shot, target.problem);
      return true;
    }
    const { picture, layout } = await deps.photograph(target.url, target.viewport, target.cookies);
    if (!(await files.upload(mapPathOf(shot.store_id, shot.id), new Uint8Array(picture)))) throw new Error("The picture could not be stored. Try again.");
    await db().execute(sql`
      update commerce.page_map_shots set status = 'done', shot_at = now(), width = ${target.viewport.width},
        height = ${Math.max(target.viewport.height, Math.min(layout.h, 10_000))}, layout = ${JSON.stringify(layout)}::jsonb,
        problem = null, claimed_until = null
      where id = ${shot.id}::uuid and store_id = ${shot.store_id}::uuid
    `);
  } catch (error) {
    const problem = lookProblem(error);
    log("warn", "map_shots.failed", { storeId: shot.store_id }, error);
    await failWith(shot, problem);
  }
  return true;
}

/** The waiting pictures, one after another, while one more fits before `until`; at most `MAP_SHOTS_PER_RUN`. */
export async function runMapShots(until: number, deps: MapShotDeps): Promise<{ taken: number }> {
  const files = deps.files === undefined ? mapFiles() : deps.files;
  if (!files) return { taken: 0 };
  let taken = 0;
  while (taken < MAP_SHOTS_PER_RUN && Date.now() + MAP_SHOT_MS <= until && (await takeOne(deps, files))) taken++;
  return { taken };
}

/** A signed address of a done picture for ten minutes, or null. */
export async function mapShotPicture(storeId: string, shot: MapShotRow, files: MapFiles | null = mapFiles()): Promise<string | null> {
  if (shot.status !== "done" || !files) return null;
  return files.signedUrl(mapPathOf(storeId, shot.id), 600);
}

/** Pictures nobody asked for in 90 days go, rows and files; never throws. */
export async function pruneMapShots(files: MapFiles | null = mapFiles()): Promise<number> {
  try {
    const gone = await typedRows(
      z.object({ id: col.uuid, store_id: col.uuid }),
      sql`delete from commerce.page_map_shots where requested_at < now() - make_interval(days => ${MAP_SHOT_KEEP_DAYS}) returning id, store_id`,
    );
    if (files && gone.length > 0) await files.remove(gone.map((g) => mapPathOf(g.store_id, g.id)));
    return gone.length;
  } catch (error) {
    log("warn", "map_shots.prune_failed", {}, error);
    return 0;
  }
}
