import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import sharp from "sharp";

import { db } from "@/db/client";
import { cssProblem } from "@/lib/custom-css";
import { newPageContent, reservedPageSlugs } from "@/lib/page-content";
import { ITERATIONS, type LogLevel, type ReplicaJob, type ReplicaNote, type ReplicaPass, type ReplicaSummary } from "@/lib/replicate";
import { buildReplica, type BuildInput } from "@/lib/replicate-build";
import { calibrate, calibrationWords } from "@/lib/replicate-calibrate";
import { hexOf, runsText, walk, type PageCapture } from "@/lib/replicate-capture";
import { compareRasters, isPerfect } from "@/lib/replicate-diff";
import { applyPatchPlan } from "@/lib/replicate-patches";
import { digestOf, partLine, textNodes } from "@/lib/replicate-prompts";
import { buildReport, finalDiffOf } from "@/lib/replicate-report";
import { buildSummary } from "@/lib/replicate-summary";
import { renderStyles } from "@/lib/replicate-styles";
import { parseReplicaUrl } from "@/lib/replicate-url";
import { slugify } from "@/lib/slug";

import { aiFor, type AiConnection } from "./ai";
import { assess, analyse } from "./replicate-ai";
import { audit, type Account } from "./auth";
import { launchBrowser } from "./browser";
import { fontFamilies, installFamily, pictureAddresses, savePicture, saveShot, saveVideo, videoAddresses, type AssetOwner } from "./replicate-assets";
import { openCopy, openOriginal } from "./replicate-browser";
import { allowPrivate } from "./replicate-fetch";
import { pairImage, previewJpeg, rasterOf, slices } from "./replicate-images";
import {
  aborting,
  askToAbort,
  createRow,
  finishRow,
  frameToken,
  getRow,
  idle,
  latestRow,
  lockRow,
  log as writeLog,
  patchWork,
  putFile,
  readCapture,
  removeFiles,
  saveCapture,
  setPage,
  setPhase,
  unlockRow,
  viewOf,
  type ReplicaRow,
  type ReplicaWork,
} from "./replicate-store";
import { savePage } from "./pages";

type Row = Record<string, unknown>;

/**
 * The page replicator (D150, `docs/page-replicator.md`): copies another website's page into a store's page builder, as a
 * draft, step by step so the owner can follow it and stop it. It opens the page in a real browser (both widths), reads
 * what the browser drew, has the site's AI describe its design, takes the words as they are, downloads the pictures,
 * videos and fonts as the store's own, builds the page from the boxes it measured (`src/lib/replicate-build.ts`), and then
 * improves it a set number of times: each pass photographs the draft at both widths, scores it against the original,
 * sets spacing right by measuring, and lets the AI change what it can see is off (`src/lib/replicate-patches.ts`).
 *
 * A job is run by ticks: each request does the next unit of work under a lock and returns what the owner's panel shows
 * (`ReplicaJob`). The tab that started it keeps asking; a job left standing waits for its owner to come back.
 */

export type ReplicaOwner = { storeId: string; storeSlug: string; account: Account; /** This server's own address, where the browser finds the preview page. */ origin: string };

class Stopped extends Error {}
class Failed extends Error {}

/** Longest a tick works before it hands over, so no request runs past its limit. */
const ASSET_BUDGET_MS = 190_000;
const PICTURES_AT_ONCE = 5;

// ---------------------------------------------------------------------------
// Starting, asking, stopping
// ---------------------------------------------------------------------------

export async function startReplication(owner: ReplicaOwner, rawUrl: string, iterationsAsked: number, confirmed: boolean): Promise<{ ok: true; job: ReplicaJob } | { ok: false; problem: string }> {
  if (!confirmed) return { ok: false, problem: "Confirm that you have the right to copy this page first." };
  const parsed = parseReplicaUrl(rawUrl, { allowPrivate: allowPrivate() });
  if (!parsed.ok) return { ok: false, problem: parsed.problem };
  const iterations = Math.min(ITERATIONS.max, Math.max(ITERATIONS.min, Math.round(Number.isFinite(iterationsAsked) ? iterationsAsked : ITERATIONS.default)));
  const row = await createRow(owner.storeId, owner.account.id, parsed.url.toString(), iterations);
  if (!row) return { ok: false, problem: "A page is already being copied for this store. Wait for it to finish, or stop it." };
  await audit(owner.account.id, owner.storeId, "store.page_replication_started", { job: row.id, host: parsed.url.hostname, iterations });
  await writeLog(row.id, "open", "info", `Starting. The page will be copied ${iterations === 1 ? "once" : `with up to ${iterations} improving passes`}.`);
  return { ok: true, job: viewOf((await getRow(row.id, owner.storeId)) ?? row) };
}

export async function replicationStatus(owner: ReplicaOwner, id: string): Promise<ReplicaJob | null> {
  const row = await getRow(id, owner.storeId);
  return row ? viewOf(row) : null;
}

/** The job to show when the owner opens the page: the one at work, else the last. */
export async function currentReplication(owner: Pick<ReplicaOwner, "storeId">): Promise<ReplicaJob | null> {
  const row = await latestRow(owner.storeId);
  return row ? viewOf(row) : null;
}

/** The owner pressed Abort. A job nobody is working on ends at once; one at work stops at its next safe point. */
export async function abortReplication(owner: ReplicaOwner, id: string): Promise<ReplicaJob | null> {
  const asked = await askToAbort(id, owner.storeId);
  if (!asked) {
    const row = await getRow(id, owner.storeId);
    return row ? viewOf(row) : null;
  }
  await writeLog(id, asked.phase, "warn", "Stopping at the owner's request…");
  if (idle(asked)) {
    const locked = await lockRow(id, 30);
    if (locked) {
      try {
        await conclude(owner, locked, "aborted", null);
      } finally {
        await unlockRow(id);
      }
    }
  }
  const row = await getRow(id, owner.storeId);
  return row ? viewOf(row) : null;
}

// ---------------------------------------------------------------------------
// One tick
// ---------------------------------------------------------------------------

type Say = (level: LogLevel, text: string) => Promise<void>;
type Tick = { row: ReplicaRow; owner: ReplicaOwner; assets: AssetOwner; say: Say; signal: AbortSignal; connection: () => Promise<AiConnection | null> };

export async function tickReplication(owner: ReplicaOwner, id: string): Promise<ReplicaJob | null> {
  const known = await getRow(id, owner.storeId);
  if (!known) return null;
  const row = await lockRow(id);
  // Someone else is at work on it, or it has ended: show it as it is.
  if (!row) return viewOf(known);

  const controller = new AbortController();
  const watch = setInterval(() => {
    void aborting(id).then((yes) => yes && controller.abort()).catch(() => {});
  }, 2500);
  const tick: Tick = {
    row,
    owner,
    assets: { storeId: owner.storeId, accountId: owner.account.id },
    say: (level, text) => writeLog(id, row.phase, level, text),
    signal: controller.signal,
    connection: (() => {
      let cached: AiConnection | null | undefined;
      return async () => (cached === undefined ? (cached = await aiFor(owner.storeId, { feature: "page_replica", accountId: owner.account.id })) : cached);
    })(),
  };
  try {
    if (row.abortRequested) throw new Stopped();
    switch (row.phase) {
      case "open":
        await stepOpen(tick);
        break;
      case "examine":
        await stepExamine(tick);
        break;
      case "copy":
        await stepCopy(tick);
        break;
      case "assets":
        await stepAssets(tick);
        break;
      case "build":
        await stepBuild(tick);
        break;
      case "refine":
        await stepRefine(tick);
        break;
      default:
        break;
    }
  } catch (error) {
    if (error instanceof Stopped) await conclude(owner, (await getRow(id, owner.storeId)) ?? row, "aborted", null);
    else {
      const problem = error instanceof Failed ? error.message : "Something went wrong while copying the page.";
      if (!(error instanceof Failed)) console.error("[replicate]", error);
      await writeLog(id, row.phase, "error", problem);
      await conclude(owner, (await getRow(id, owner.storeId)) ?? row, "failed", problem);
    }
  } finally {
    clearInterval(watch);
    await unlockRow(id);
  }
  const after = await getRow(id, owner.storeId);
  return after ? viewOf(after) : null;
}

const stopIfAsked = (tick: Tick) => {
  if (tick.signal.aborted) throw new Stopped();
};

// ---------------------------------------------------------------------------
// Step: open the page
// ---------------------------------------------------------------------------

/** The first line of why a browser did not start, for the owner and whoever fixes it; never a path or a secret. */
function browserReason(error: unknown): string {
  const text = error instanceof Error ? error.message.split("\n")[0] : "";
  const clean = text.replace(/\/[^\s'"]+/g, "…").replace(/\s+/g, " ").trim().slice(0, 160);
  return clean ? ` (${clean}).` : ".";
}

async function stepOpen(tick: Tick): Promise<void> {
  const { row, say, owner } = tick;
  const host = new URL(row.url).hostname;
  await say("info", `Opening ${host} in a browser, at computers' and at a phone's width.`);
  let browser;
  try {
    browser = await launchBrowser();
  } catch (error) {
    console.error("[replicate] browser", error);
    throw new Failed(`The browser that looks at pages could not be started on this server${browserReason(error)}`);
  }
  try {
    let desktop;
    try {
      desktop = await openOriginal(browser, row.url, "desktop", tick.signal);
    } catch (error) {
      throw new Failed(error instanceof Error && error.message !== "Stopped." ? error.message : "The page could not be opened.");
    }
    stopIfAsked(tick);
    const empty = walk(desktop.capture.root).next().done || desktop.capture.docHeight < 80 || desktop.capture.root.children.length === 0;
    if (empty) throw new Failed("The page shows nothing a copy could be made from (it may need a sign-in, or draw itself with scripts that did not run).");
    await say("ok", `Loaded “${desktop.capture.title || host}”: ${desktop.capture.docWidth} × ${desktop.capture.docHeight} px at computers' width, ${desktop.capture.fonts.length} typefaces in use.`);
    if (desktop.capture.left.fixed.length > 0) await say("info", `Left out because they float over the page: ${desktop.capture.left.fixed.slice(0, 4).join(", ")}.`);
    let mobile = null;
    try {
      mobile = await openOriginal(browser, row.url, "mobile", tick.signal);
      await say("ok", `Looked at it at a phone's width too: ${mobile.capture.docHeight} px tall.`);
    } catch {
      await say("warn", "The page could not be looked at a second time at a phone's width; the copy will use the builder's own phone layout.");
    }
    stopIfAsked(tick);

    // Photographs: the originals to compare with, and small ones for the owner's panel.
    const files: string[] = [];
    const originals: ReplicaWork["originals"] = { desktop: null, mobile: null };
    const previews = { original: { desktop: null as string | null, mobile: null as string | null }, copy: { desktop: null, mobile: null, iteration: null } };
    for (const [name, opened, width] of [["desktop", desktop, 720], ["mobile", mobile, 300]] as const) {
      if (!opened) continue;
      const full = await sharp(opened.screenshot).flatten({ background: "#ffffff" }).jpeg({ quality: 86 }).toBuffer();
      const kept = await putFile(row.storeId, row.id, `original-${name}.jpg`, full, "image/jpeg");
      const small = await putFile(row.storeId, row.id, `original-${name}-preview.jpg`, await previewJpeg(opened.screenshot, width, 5000), "image/jpeg");
      if (kept) {
        originals[name] = kept.url;
        files.push(kept.path);
      }
      if (small) {
        previews.original[name] = small.url;
        files.push(small.path);
      }
    }

    // What is drawn, not a file: kept as pictures of their own.
    const shots: Record<string, { url: string; width: number; height: number } | null> = {};
    let taken = 0;
    for (const [path, png] of desktop.elements) {
      const saved = await saveShot(tick.assets, png, `part-${path.replace(/\//g, "-")}`);
      shots[path] = saved.ok ? saved.picture : null;
      if (saved.ok) taken += 1;
    }
    if (desktop.elements.size > 0) await say("ok", `Photographed ${taken} of ${desktop.elements.size} icons, graphics and widgets that are drawn on the page rather than stored as files.`);

    await saveCapture(row.id, { desktop: desktop.capture, mobile: mobile?.capture ?? null });
    await patchWork(row.id, {
      originals,
      previews,
      files,
      title: desktop.capture.title,
      description: desktop.capture.description,
      background: hexOf(desktop.capture.background) ?? "#ffffff",
      assets: { pictures: {}, pictureQueue: [], videos: {}, videoQueue: [], shots, fonts: {}, fontQueue: [], failures: {}, total: 0 },
    });
    void owner;
    await setPhase(row.id, "examine");
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Step: examine design and layout
// ---------------------------------------------------------------------------

async function fetchBytes(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

async function stepExamine(tick: Tick): Promise<void> {
  const { row, say } = tick;
  const capture = await readCapture(row.id);
  if (!capture) throw new Failed("What was read from the page was lost. Start again.");
  const connection = await tick.connection();
  if (!connection?.textModel) {
    await say("warn", "The site has no AI text model set up, so the design is read by measuring only. Set one under AI settings to let the AI look at the page and the copy.");
    await patchWork(row.id, { analysis: null, vision: { used: false, why: "The site has no AI text model, so the pictures were not looked at; the copy was corrected by measuring only." } });
    await setPhase(row.id, "copy");
    return;
  }
  await say("info", "The AI is looking at the page: its layout, colours and type.");
  const originals = row.work.originals ?? { desktop: null, mobile: null };
  const desktopBytes = originals.desktop ? await fetchBytes(originals.desktop) : null;
  const mobileBytes = originals.mobile ? await fetchBytes(originals.mobile) : null;
  const desktopSlices = desktopBytes ? await slices(desktopBytes, 1000, 1500, 3) : [];
  const mobileSlices = mobileBytes ? await slices(mobileBytes, 390, 1400, 1) : [];
  stopIfAsked(tick);
  const outcome = await analyse(connection, digestOf(capture.desktop), desktopSlices, mobileSlices);
  stopIfAsked(tick);
  if (outcome.ok) {
    const a = outcome.value;
    await say("ok", `The AI's reading: ${a.summary}`);
    if (a.palette.length > 0) await say("info", `Colours: ${a.palette.slice(0, 6).map((c) => `${c.hex}${c.use ? ` (${c.use})` : ""}`).join(", ")}.`);
    if (a.typography) await say("info", `Type: ${a.typography}`);
    if (a.sections.length > 0) await say("info", `${a.sections.length} sections: ${a.sections.slice(0, 8).map((s) => s.name).join(" → ")}${a.sections.length > 8 ? " …" : ""}.`);
    for (const hard of a.hard.slice(0, 4)) await say("warn", `Hard to copy: ${hard}`);
    await patchWork(row.id, { analysis: a, vision: { used: desktopSlices.length > 0, why: null } });
  } else {
    await say("warn", outcome.problem);
    await patchWork(row.id, { analysis: null, vision: { used: false, why: outcome.problem } });
  }
  await setPhase(row.id, "copy");
}

// ---------------------------------------------------------------------------
// Step: the words
// ---------------------------------------------------------------------------

async function stepCopy(tick: Tick): Promise<void> {
  const { row, say } = tick;
  const capture = await readCapture(row.id);
  if (!capture) throw new Failed("What was read from the page was lost. Start again.");
  const nodes = textNodes(capture.desktop);
  const words = nodes.reduce((sum, n) => sum + runsText(n.runs).split(/\s+/).filter(Boolean).length, 0);
  const headings = nodes.filter((n) => /^h[1-6]$/.test(n.tag));
  const buttons = nodes.filter((n) => n.button);
  const links = new Set(nodes.flatMap((n) => [n.href, ...(n.runs ?? []).map((r) => r.href)]).filter(Boolean));
  await say("ok", `Copied the text: ${nodes.length} pieces, ${words} words, ${headings.length} headings, ${buttons.length} buttons and ${links.size} links.${capture.desktop.lang ? ` Language: ${capture.desktop.lang}.` : ""}`);
  for (const heading of headings.slice(0, 6)) await say("info", `${heading.tag.toUpperCase()}  ${runsText(heading.runs).slice(0, 90)}`);
  await patchWork(row.id, { words });
  await setPhase(row.id, "assets");
}

// ---------------------------------------------------------------------------
// Step: pictures, videos, fonts
// ---------------------------------------------------------------------------

async function stepAssets(tick: Tick): Promise<void> {
  const { row, say, assets: owner } = tick;
  const capture = await readCapture(row.id);
  if (!capture) throw new Failed("What was read from the page was lost. Start again.");
  const base = row.work.assets!;
  const state = { ...base, pictures: { ...base.pictures }, videos: { ...base.videos }, fonts: { ...base.fonts }, failures: { ...base.failures } };
  const referer = capture.desktop.url;

  // The first time: what is to be fetched.
  if (state.total === 0) {
    const pictures = pictureAddresses([capture.desktop, capture.mobile]);
    const videos = videoAddresses([capture.desktop, capture.mobile]);
    const fonts = fontFamilies(capture.desktop);
    state.pictureQueue = pictures.urls;
    state.videoQueue = videos;
    state.fontQueue = fonts.wanted;
    state.total = pictures.urls.length + videos.length + fonts.wanted.length;
    await say("info", `Found ${pictures.urls.length} pictures${pictures.over > 0 ? ` (${pictures.over} more than the limit are left out)` : ""}, ${videos.length} video file${videos.length === 1 ? "" : "s"} and ${fonts.wanted.length} typeface${fonts.wanted.length === 1 ? "" : "s"} to download.`);
    if (pictures.over > 0) await say("warn", `The page has more pictures than ${pictures.urls.length}; the rest are left out.`);
  }
  const save = async () => patchWork(row.id, { assets: state });
  const started = Date.now();

  while (state.pictureQueue.length > 0 && Date.now() - started < ASSET_BUDGET_MS) {
    stopIfAsked(tick);
    const batch = state.pictureQueue.splice(0, PICTURES_AT_ONCE);
    const results = await Promise.all(batch.map(async (url) => ({ url, result: await savePicture(owner, url, referer, "") })));
    for (const { url, result } of results) {
      const name = decodeURIComponent(url.split("?")[0].split("/").pop() ?? url).slice(0, 50) || url.slice(0, 50);
      if (result.ok) {
        state.pictures[url] = result.picture;
        await say("ok", `Downloaded ${name} (${result.picture.width} × ${result.picture.height}).`);
      } else {
        state.pictures[url] = null;
        state.failures[url] = result.problem;
        await say("warn", `Could not download ${name}: ${result.problem}`);
      }
    }
    await save();
  }

  while (state.pictureQueue.length === 0 && state.videoQueue.length > 0 && Date.now() - started < ASSET_BUDGET_MS) {
    stopIfAsked(tick);
    const url = state.videoQueue.shift()!;
    const name = decodeURIComponent(url.split("?")[0].split("/").pop() ?? "video").slice(0, 50);
    await say("info", `Downloading the video ${name}…`);
    const result = await saveVideo(owner, url, referer);
    if (result.ok) {
      state.videos[url] = { url: result.url };
      await say("ok", `Copied the video ${name}.`);
    } else {
      state.videos[url] = null;
      state.failures[url] = result.problem;
      await say("warn", `Could not copy the video ${name}: ${result.problem}`);
    }
    await save();
  }

  while (state.pictureQueue.length === 0 && state.videoQueue.length === 0 && state.fontQueue.length > 0 && Date.now() - started < ASSET_BUDGET_MS) {
    stopIfAsked(tick);
    const family = state.fontQueue.shift()!;
    const result = await installFamily(family);
    if (result.ok) {
      state.fonts[family] = result.family;
      await say("ok", `The typeface ${result.family} is in Google Fonts and is installed for the site.`);
    } else {
      state.fonts[family] = null;
      state.failures[`font:${family}`] = result.problem;
      await say("warn", `The typeface ${family} cannot be installed (${result.problem}); its own font stack is used instead.`);
    }
    await save();
  }

  if (state.pictureQueue.length === 0 && state.videoQueue.length === 0 && state.fontQueue.length === 0) {
    const okPictures = Object.values(state.pictures).filter(Boolean).length;
    await say("ok", `Assets done: ${okPictures} of ${Object.keys(state.pictures).length} pictures, ${Object.values(state.videos).filter(Boolean).length} of ${Object.keys(state.videos).length} videos, ${Object.values(state.fonts).filter(Boolean).length} of ${Object.keys(state.fonts).length} fonts.`);
    await setPhase(row.id, "build");
  }
}

// ---------------------------------------------------------------------------
// Step: build the page
// ---------------------------------------------------------------------------

/** A slug for the copy that is not taken. */
async function freeSlug(storeId: string, title: string, host: string): Promise<string> {
  const base = slugify(`copy-${title || host}`, 60) || "copy-of-page";
  const taken = new Set((await db().execute<Row>(sql`select slug from commerce.pages where store_id = ${storeId}::uuid and type = 'page'`)).map((r) => String(r.slug)));
  const reserved = new Set(reservedPageSlugs(storeId, "page"));
  for (let n = 0; n < 50; n++) {
    const slug = n === 0 ? base : `${base}-${n + 1}`;
    if (!taken.has(slug) && !reserved.has(slug)) return slug;
  }
  return `${base}-${randomUUID().slice(0, 6)}`;
}

async function stepBuild(tick: Tick): Promise<void> {
  const { row, say, owner } = tick;
  const capture = await readCapture(row.id);
  if (!capture) throw new Failed("What was read from the page was lost. Start again.");
  const assets = row.work.assets!;
  const input: BuildInput = {
    desktop: capture.desktop,
    mobile: capture.mobile,
    picture: (url) => assets.pictures[url] ?? null,
    shot: (path) => assets.shots[path] ?? null,
    video: (url) => assets.videos[url] ?? null,
    font: (family) => assets.fonts[family] ?? null,
  };
  await say("info", "Building the page in the page builder from what was measured.");
  const built = buildReplica(input, randomUUID);
  if (built.rows.length === 0) throw new Failed("Nothing on the page could be turned into rows of the builder.");
  const styled = renderStyles(built.model, built.shared);
  const notes: ReplicaNote[] = [...built.notes];
  if (styled.trimmed) notes.push({ level: "warn", text: styled.trimmed });
  const problem = cssProblem(styled.css);
  if (problem) throw new Failed(`The page's CSS was refused: ${problem}`);

  const host = new URL(row.url).hostname;
  const title = (built.title || host).slice(0, 190);
  const content = {
    ...newPageContent(),
    title,
    slug: await freeSlug(owner.storeId, title, host),
    seo: { title: title.slice(0, 120), description: built.description.slice(0, 300) },
    // A copy of someone else's page is not for search engines or AI assistants until its owner decides.
    searchEngines: false,
    aiAssistants: false,
    rows: built.rows,
    css: styled.css,
  };
  let saved = await savePage(owner.account, owner.storeId, null, content, { publish: false, type: "page" });
  for (let attempt = 0; attempt < 3 && !saved.ok && saved.problems.some((p) => /address|slug/i.test(p)); attempt++) {
    saved = await savePage(owner.account, owner.storeId, null, { ...content, slug: `${content.slug}-${randomUUID().slice(0, 4)}` }, { publish: false, type: "page" });
  }
  if (!saved.ok) throw new Failed(`The builder did not accept the page: ${saved.problems.slice(0, 3).join(" ")}`);
  await setPage(row.id, saved.id);
  await say("ok", `Built the page as a draft: ${built.counts.rows} rows and ${built.counts.blocks} blocks (${built.counts.headings} headings, ${built.counts.texts} text blocks, ${built.counts.pictures} pictures, ${built.counts.buttons} buttons, ${built.counts.videos} videos).`);
  for (const note of notes.slice(0, 8)) await say(note.level === "ok" ? "ok" : "warn", note.text);
  await patchWork(row.id, { model: built.model, parts: built.parts, shared: built.shared, notes, counts: built.counts, dropped: built.dropped, cssLength: styled.css.length, cssTrimmed: styled.trimmed ?? null, passes: [] });
  await setPhase(row.id, "refine", 0);
}

// ---------------------------------------------------------------------------
// Step: check and improve
// ---------------------------------------------------------------------------

async function saveDraftCss(row: ReplicaRow, accountId: string, css: string): Promise<void> {
  const problem = cssProblem(css);
  if (problem) throw new Failed(`The page's CSS was refused: ${problem}`);
  await db().execute(sql`
    update commerce.pages set draft = jsonb_set(draft, '{css}', to_jsonb(${css}::text)), updated_at = now(), updated_by = ${accountId}::uuid
    where id = ${row.pageId}::uuid and store_id = ${row.storeId}::uuid
  `);
}

async function stepRefine(tick: Tick): Promise<void> {
  const { row, say, owner } = tick;
  const k = row.iteration;
  const max = row.iterationsMax;
  if (!row.pageId) throw new Failed("The draft page is gone.");
  const work = row.work;
  const model = work.model!;
  const parts = work.parts!;
  const originals = work.originals ?? { desktop: null, mobile: null };
  const frameUrl = `${owner.origin}/admin/account/replica/${row.id}?t=${encodeURIComponent(frameToken(row.id))}`;

  await say("info", k === 0 ? "Checking the first copy against the original, at both widths." : `Pass ${k} of ${max}: checking the draft against the original.`);
  let browser;
  try {
    browser = await launchBrowser();
  } catch (error) {
    console.error("[replicate] browser", error);
    throw new Failed(`The browser that looks at pages could not be started on this server${browserReason(error)}`);
  }
  try {
    const desktop = await openCopy(browser, frameUrl, "desktop").catch((error: Error) => {
      throw new Failed(error.message);
    });
    stopIfAsked(tick);
    const mobile = originals.mobile ? await openCopy(browser, frameUrl, "mobile").catch(() => null) : null;
    stopIfAsked(tick);

    // The scores.
    const originalDesktop = originals.desktop ? await fetchBytes(originals.desktop) : null;
    const originalMobile = originals.mobile ? await fetchBytes(originals.mobile) : null;
    if (!originalDesktop) throw new Failed("The photograph of the original was lost. Start again.");
    const width = 360;
    const [od, cd] = await Promise.all([rasterOf(originalDesktop, width), rasterOf(desktop.screenshot, width)]);
    const scoreDesktop = compareRasters(od.raster, cd.raster, od.scale);
    let scoreMobile = null;
    let phoneSide: Parameters<typeof finalDiffOf>[2] = null;
    if (mobile && originalMobile) {
      const [om, cm] = await Promise.all([rasterOf(originalMobile, 130), rasterOf(mobile.screenshot, 130)]);
      scoreMobile = compareRasters(om.raster, cm.raster, om.scale);
      phoneSide = { original: om.raster, copy: cm.raster, scale: om.scale, capture: mobile.capture };
    }
    const pass: ReplicaPass = { iteration: k, desktop: scoreDesktop, mobile: scoreMobile, changes: [] };
    const passes = [...(work.passes ?? []), pass];

    // What the owner watches: the draft as it is now.
    const previews = JSON.parse(JSON.stringify(work.previews ?? { original: { desktop: null, mobile: null }, copy: { desktop: null, mobile: null, iteration: null } })) as NonNullable<ReplicaWork["previews"]>;
    const files = [...(work.files ?? [])];
    const keepPreview = async (name: "desktop" | "mobile", png: Buffer, width: number) => {
      const stored = await putFile(row.storeId, row.id, `copy-${name}-${k}.jpg`, await previewJpeg(png, width, 5000), "image/jpeg");
      if (stored) {
        const old = previews.copy[name];
        previews.copy[name] = stored.url;
        files.push(stored.path);
        // The picture before this one is no longer needed.
        if (old) {
          const oldPath = files.find((f) => old.endsWith(f));
          if (oldPath) {
            files.splice(files.indexOf(oldPath), 1);
            void removeFiles([oldPath]);
          }
        }
      }
    };
    await keepPreview("desktop", desktop.screenshot, 720);
    if (mobile) await keepPreview("mobile", mobile.screenshot, 300);
    previews.copy.iteration = k;
    await say("ok", `${k === 0 ? "The first copy" : `After pass ${k}, the copy`} matches the original ${scoreDesktop.match}% on computers${scoreMobile ? ` and ${scoreMobile.match}% on phones` : ""}. It is ${desktop.capture.docHeight} px tall; the original is ${scoreDesktop.heights.original} px.`);
    await patchWork(row.id, { passes, previews, files });

    const perfect = isPerfect(scoreDesktop) && isPerfect(scoreMobile);
    if (k >= max || perfect) {
      await patchWork(row.id, { ...(perfect && k < max ? { stoppedEarly: true } : {}), finalDiff: finalDiffOf(parts, { original: od.raster, copy: cd.raster, scale: od.scale, capture: desktop.capture }, phoneSide) });
      await conclude(owner, (await getRow(row.id, owner.storeId)) ?? row, "done", null);
      return;
    }

    // Improve: first by measuring, then by what the AI sees.
    const changes: string[] = [];
    const calibratedDesktop = calibrate(model, parts, desktop.capture, false);
    const sayDesktop = calibrationWords(calibratedDesktop, "computers");
    if (sayDesktop) changes.push(sayDesktop);
    if (mobile) {
      const calibratedMobile = calibrate(model, parts, mobile.capture, true);
      const sayMobile = calibrationWords(calibratedMobile, "phones");
      if (sayMobile) changes.push(sayMobile);
    }
    for (const change of changes) await say("info", change);
    stopIfAsked(tick);

    const connection = await tick.connection();
    const vision = work.vision?.used !== false && connection?.textModel ? connection : null;
    let blind = false;
    let observed: ReplicaPass["ai"] | undefined;
    if (vision && originalDesktop) {
      const regions = scoreDesktop.weakest.slice(0, 2).map((w) => ({ ...w, y: Math.max(0, w.y - 20), height: Math.min(900, w.height + 40) }));
      const phoneRegion = scoreMobile?.weakest[0] ? { y: Math.max(0, scoreMobile.weakest[0].y - 20), height: Math.min(1000, scoreMobile.weakest[0].height + 40) } : null;
      if (regions.length > 0 || phoneRegion) {
        await say("info", "The AI is comparing the original and the copy where they differ most.");
        const images: Buffer[] = [];
        for (const region of regions) images.push(await pairImage(originalDesktop, desktop.screenshot, region, 1440, 1500, true));
        if (phoneRegion && originalMobile && mobile) images.push(await pairImage(originalMobile, mobile.screenshot, phoneRegion, 390, 1200, true));
        const near = new Set<string>();
        const lines: string[] = [];
        for (const region of regions) {
          for (const part of parts) {
            if (!part.target || near.has(part.id) || lines.length >= 40) continue;
            if (part.target[1] + part.target[3] >= region.y && part.target[1] <= region.y + region.height && part.kind !== "row") {
              near.add(part.id);
              lines.push(partLine(part, model));
            }
          }
        }
        stopIfAsked(tick);
        const answer = await assess(vision, { analysis: work.analysis ?? null, iteration: k + 1, scores: { desktop: scoreDesktop, mobile: scoreMobile }, parts: lines, calibrated: changes }, images);
        stopIfAsked(tick);
        if (answer.ok) {
          const applied = applyPatchPlan(model, parts, answer.value);
          if (answer.value.summary) await say("info", `The AI sees: ${answer.value.summary}`);
          for (const line of applied.applied.slice(0, 10)) await say("ok", `Changed ${line}`);
          if (applied.applied.length > 10) await say("info", `…and ${applied.applied.length - 10} more changes.`);
          if (applied.refused.length > 0) await say("warn", `${applied.refused.length} suggested change${applied.refused.length === 1 ? " was" : "s were"} not allowed and left out.`);
          for (const note of answer.value.notes.slice(0, 3)) await say("info", `The AI could not fix: ${note}`);
          changes.push(...applied.applied.slice(0, 20));
          observed = { summary: answer.value.summary ?? "", couldNotFix: answer.value.notes.slice(0, 8), refused: applied.refused.slice(0, 15), applied: applied.applied.length };
        } else {
          await say("warn", answer.problem);
          if (answer.blind) {
            blind = true;
            await patchWork(row.id, { vision: { used: false, why: answer.problem } });
          }
        }
      }
    } else if (!vision && k === 0) {
      await say("info", "The AI does not look at the copy (no text model that sees pictures); spacing is corrected by measuring.");
    }
    void blind;

    // Save the page's CSS as it is now, and move on to the next pass.
    const styled = renderStyles(model, work.shared ?? "");
    await saveDraftCss(row, owner.account.id, styled.css);
    passes[passes.length - 1] = { ...pass, changes, ...(observed ? { ai: observed } : {}) };
    await patchWork(row.id, { model, passes, cssLength: styled.css.length });
    await setPhase(row.id, "refine", k + 1);
  } finally {
    await browser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// The end
// ---------------------------------------------------------------------------

async function conclude(owner: ReplicaOwner, row: ReplicaRow, outcome: "done" | "failed" | "aborted", problem: string | null): Promise<void> {
  const work = row.work;
  const assets = work.assets;
  const pictures = Object.values(assets?.pictures ?? {});
  const page = row.pageId ? await pageTitle(row.pageId, owner.storeId) : null;
  const fonts = Object.entries(assets?.fonts ?? {});
  const summary: ReplicaSummary = buildSummary({
    outcome,
    problem,
    notes: work.notes ?? [],
    words: work.words ?? 0,
    counts: work.counts ?? { rows: 0, blocks: 0, headings: 0, texts: 0, pictures: 0, buttons: 0, videos: 0 },
    assets: {
      picturesOk: pictures.filter(Boolean).length,
      picturesFailed: pictures.filter((p) => !p).length,
      videosOk: Object.values(assets?.videos ?? {}).filter(Boolean).length,
      videosFailed: Object.values(assets?.videos ?? {}).filter((v) => !v).length,
      fontsInstalled: fonts.filter(([, installed]) => installed).map(([, installed]) => installed as string),
      fontsFailed: fonts.filter(([, installed]) => !installed).map(([family]) => family),
      shots: Object.values(assets?.shots ?? {}).filter(Boolean).length,
    },
    passes: work.passes ?? [],
    iterationsAsked: row.iterationsMax,
    stoppedEarly: Boolean(work.stoppedEarly),
    vision: { used: work.vision?.used ?? false, why: work.vision?.why ?? null },
    page,
    analysis: work.analysis ? { summary: work.analysis.summary, hard: work.analysis.hard } : null,
  });
  const captured = await readCapture(row.id).catch(() => null);
  if (captured) {
    const report = buildReport({
      now: new Date().toISOString(),
      url: row.url,
      outcome,
      problem,
      iterationsAsked: row.iterationsMax,
      stoppedEarly: Boolean(work.stoppedEarly),
      vision: { used: work.vision?.used ?? false, why: work.vision?.why ?? null },
      desktop: captured.desktop,
      mobile: captured.mobile,
      parts: work.parts ?? [],
      counts: summary.counts,
      words: work.words ?? 0,
      notes: work.notes ?? [],
      dropped: work.dropped ?? [],
      passes: work.passes ?? [],
      finalDiff: work.finalDiff ?? null,
      assets: assets ? { pictures: assets.pictures, videos: assets.videos, shots: assets.shots, fonts: assets.fonts, failures: assets.failures } : null,
      analysis: work.analysis ?? null,
      cssLength: work.cssLength ?? null,
      cssTrimmed: work.cssTrimmed ?? null,
      log: row.log,
    });
    summary.report = report;
    // What the report found beyond the notes above is said in the summary too, in one line each.
    const said = new Set(["forms", "nested", "shapes", "pictures", "videos", "fonts", "limits", "no-vision", "ai-hard", "graphics"]);
    for (const finding of report.findings.filter((x) => x.severity !== "low" && !said.has(x.id)).slice(0, 6)) summary.problems.push(`${finding.title}: ${finding.evidence[0] ?? ""}`.trim());
  }
  await finishRow(row.id, outcome, summary);
  await writeLog(row.id, "done", outcome === "done" ? "ok" : outcome === "aborted" ? "warn" : "error", outcome === "done" ? "Finished. The summary is below." : outcome === "aborted" ? "Stopped." : `Stopped: ${problem ?? "the copy could not be made."}`);
  await audit(owner.account.id, owner.storeId, "store.page_replicated", { job: row.id, outcome, page: row.pageId, match: summary.finalMatch.desktop, iterations: (work.passes ?? []).length - 1 });
}

async function pageTitle(pageId: string, storeId: string): Promise<{ id: string; title: string } | null> {
  const [row] = await db().execute<Row>(sql`select id, draft->>'title' as title from commerce.pages where id = ${pageId}::uuid and store_id = ${storeId}::uuid`);
  return row ? { id: String(row.id), title: String(row.title ?? "Copy") } : null;
}

/** What the studio can offer: copying needs a browser; the AI's part needs a text model. */
export async function replicaAbilities(storeId: string): Promise<{ ai: boolean; browser: boolean }> {
  const connection = await aiFor(storeId);
  return { ai: Boolean(connection?.textModel), browser: true };
}

export type { PageCapture };
