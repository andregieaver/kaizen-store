import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { WebsiteMessages } from "@/lib/admin-messages/website.en";

import { audit } from "./auth";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The AI's page work as the Pages list shows it (PSI UX-01): the builds the AI manager or the autopilot started for a site
 * (`commerce.page_ai_jobs`, `runPageJobs()` in `site-tools.ts`) while they wait or run, and the pictures still being made for a page, each
 * with how far it is and a way to stop it. The AI manager's `cancel_page_build` stops a build the same way (`stopPageBuild()`).
 */

type PageJobWords = WebsiteMessages["pageJobs"];

/** What a build or a picture stopped from the Pages list or by `cancel_page_build` says it came to. */
export const STOPPED = "Stopped on request.";

/** A build waiting for its turn or being built that moment. */
export type RunningBuild = { kind: "build"; id: string; title: string; running: boolean; asked: string };
/** A page whose pictures are still being made, one at a time, after it was built or changed. */
export type RunningPictures = { kind: "pictures"; pageId: string; title: string; type: "page" | "article"; made: number; waiting: number; notMade: number };
export type RunningPageJob = RunningBuild | RunningPictures;

const BUILD_ROW = z.object({ id: col.uuid, title: col.textOrNull, running: col.bool, created_at: col.timestamp });
const PICTURES_ROW = z.object({ page_id: col.uuid, title: col.textOrNull, type: col.text, made: col.int, waiting: col.int, not_made: col.int });

/**
 * A site's page work still going (a store's, or Kaizena Flow's own with `null`): its builds waiting or running, oldest first, then its
 * pages with pictures still waiting, with how many are made, waiting and given up.
 */
export async function runningPageJobs(storeId: string | null): Promise<RunningPageJob[]> {
  const [builds, pictures] = await Promise.all([
    typedRows(BUILD_ROW, sql`
      select id, input ->> 'title' as title, claimed_until is not null and claimed_until > now() as running, created_at
      from commerce.page_ai_jobs
      where kind = 'build' and status = 'waiting' and store_id is not distinct from ${storeId}::uuid
      order by created_at, id
    `),
    typedRows(PICTURES_ROW, sql`
      select j.page_id, p.draft ->> 'title' as title, p.type,
        count(*) filter (where j.status = 'done')::int as made, count(*) filter (where j.status = 'waiting')::int as waiting,
        count(*) filter (where j.status in ('gone', 'failed'))::int as not_made
      from commerce.page_ai_jobs j join commerce.pages p on p.id = j.page_id
      where j.kind = 'picture' and j.store_id is not distinct from ${storeId}::uuid and p.store_id is not distinct from ${storeId}::uuid
      group by j.page_id, p.draft ->> 'title', p.type
      having count(*) filter (where j.status = 'waiting') > 0
      order by min(j.created_at)
    `),
  ]);
  return [
    ...builds.map((row): RunningBuild => ({ kind: "build", id: row.id, title: row.title ?? "", running: row.running, asked: row.created_at })),
    ...pictures.map(
      (row): RunningPictures => ({
        kind: "pictures",
        pageId: row.page_id,
        title: row.title ?? "",
        type: row.type === "article" ? "article" : "page",
        made: row.made,
        waiting: row.waiting,
        notMade: row.not_made,
      }),
    ),
  ];
}

/** What stopping a build came to. */
export type StopBuild =
  | { outcome: "stopped"; title: string; running: boolean }
  | { outcome: "built" }
  | { outcome: "ended" }
  | { outcome: "unknown" };

/**
 * A build of this site stopped: one waiting is ended (`failed`, "Stopped on request") and never claimed; one being built that moment is
 * ended the same way, and the run building it finds it so when it is done and deletes the draft it made (`keep()`), so nothing of it is
 * left. One already built is not undone, nor one that already ended.
 */
export async function stopPageBuild(storeId: string | null, build: string): Promise<StopBuild> {
  if (!z.uuid().safeParse(build).success) return { outcome: "unknown" };
  const stopped = await typedRow(
    z.object({ title: col.textOrNull, running: col.bool }),
    sql`
      update commerce.page_ai_jobs set status = 'failed', problem = ${STOPPED}, updated_at = now()
      where id = ${build}::uuid and kind = 'build' and status = 'waiting' and store_id is not distinct from ${storeId}::uuid
      returning input ->> 'title' as title, claimed_until is not null and claimed_until > now() as running
    `,
  );
  if (stopped) return { outcome: "stopped", title: stopped.title ?? "", running: stopped.running };
  const job = await typedRow(
    z.object({ status: col.text, page_id: col.textOrNull }),
    sql`select status, page_id from commerce.page_ai_jobs where id = ${build}::uuid and kind = 'build' and store_id is not distinct from ${storeId}::uuid`,
  );
  if (!job) return { outcome: "unknown" };
  return job.status === "done" && job.page_id ? { outcome: "built" } : { outcome: "ended" };
}

/**
 * The pictures still waiting for one of this site's pages, not made: each ended (`failed`, "Stopped on request"). A picture being made that
 * moment may still arrive, as the picture model was already asked; the page keeps every picture already made and the place-holders of the
 * others, to fill by hand. Returns how many were stopped.
 */
export async function stopPagePictures(storeId: string | null, pageId: string): Promise<number> {
  if (!z.uuid().safeParse(pageId).success) return 0;
  const rows = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      update commerce.page_ai_jobs set status = 'failed', problem = ${STOPPED}, updated_at = now()
      where kind = 'picture' and status = 'waiting' and page_id = ${pageId}::uuid and store_id is not distinct from ${storeId}::uuid
      returning id
    `,
  );
  return rows.length;
}

/**
 * A build or a page's pictures stopped from the Pages list, answered in the person's words (`PageJobsPanel`), and kept in the audit log
 * as `page.ai_build_stopped` or `page.ai_pictures_stopped` in the person's name, as the AI manager's `cancel_page_build` is. `kind` and
 * `id` come from the browser: anything else than a build or pictures, or not this site's, is answered as already stopped.
 */
export async function stopPageJob(storeId: string | null, actor: string, kind: string, id: string, w: PageJobWords): Promise<FormState> {
  if (kind === "pictures") {
    const stopped = await stopPagePictures(storeId, id);
    if (stopped > 0) await audit(actor, storeId, "page.ai_pictures_stopped", { stopped }, { target: { type: "page", id } });
    return { status: "ok", messages: [stopped > 0 ? countWords(stopped, w.picturesStopped) : w.picturesDone] };
  }
  if (kind !== "build") return { status: "error", messages: [w.ended] };
  const result = await stopPageBuild(storeId, id);
  if (result.outcome === "stopped") {
    await audit(actor, storeId, "page.ai_build_stopped", { running: result.running }, { target: { type: "page_build", id } });
    return { status: "ok", messages: [fillWords(result.running ? w.stoppedRunning : w.stopped, { title: result.title || w.untitled })] };
  }
  return { status: "error", messages: [result.outcome === "built" ? w.built : w.ended] };
}
