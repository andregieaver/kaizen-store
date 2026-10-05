import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import sharp from "sharp";

import { db } from "@/db/client";
import { cssProblem } from "@/lib/custom-css";
import { newPageContent, pageInput, reservedPageSlugs } from "@/lib/page-content";
import { ITERATIONS, type LogLevel, type ReplicaJob, type ReplicaNote, type ReplicaPass, type ReplicaSummary } from "@/lib/replicate";
import { backdropKey, buildReplica, type BuildInput } from "@/lib/replicate-build";
import { calibrate, calibrationWords } from "@/lib/replicate-calibrate";
import { hexOf, runsText, walk, type PageCapture } from "@/lib/replicate-capture";
import { compareRasters, isPerfect, stretchMatch, type Raster } from "@/lib/replicate-diff";
import { columnsBeatGrid, stretchesOf, weakGrids, type GridStretch } from "@/lib/replicate-grid";
import { BACKDROP_BELOW, buildFitted, weakRows } from "@/lib/replicate-backdrop";
import { applyPatchPlan } from "@/lib/replicate-patches";
import { digestOf, partLine, textNodes } from "@/lib/replicate-prompts";
import { fontRelation } from "@/lib/replicate-fonts";
import { buildReport, finalDiffOf } from "@/lib/replicate-report";
import { buildSummary } from "@/lib/replicate-summary";
import { LOOK, looking, lookProblem } from "@/lib/replicate-look";
import { watchLine } from "@/lib/replicate-watch";
import { renderStyles } from "@/lib/replicate-styles";
import { parseReplicaUrl } from "@/lib/replicate-url";
import { slugify } from "@/lib/slug";

import { aiFor, seeing, type AiConnection } from "./ai";
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
  type GridSnapshot,
  type GridTrial,
  type KeptAsset,
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

/** Starts a browser for one look at a page (`looking()` closes it): never one browser for several, see `replicate-look.ts`. */
async function startBrowser() {
  try {
    return await launchBrowser();
  } catch (error) {
    console.error("[replicate] browser", error);
    throw new Failed(`The browser that looks at pages could not be started on this server${browserReason(error)}`);
  }
}

async function stepOpen(tick: Tick): Promise<void> {
  const { row, say, owner } = tick;
  const host = new URL(row.url).hostname;
  await say("info", `Opening ${host} in a browser, at computers' and at a phone's width.`);
  let desktop;
  try {
    desktop = await looking(startBrowser, LOOK.desktopMs, (browser) => openOriginal(browser, row.url, "desktop", tick.signal));
  } catch (error) {
    if (error instanceof Failed) throw error;
    if (!(error instanceof Error) || error.message !== "Stopped.") console.error("[replicate] desktop width", error);
    throw new Failed(lookProblem(error));
  }
  stopIfAsked(tick);
  const empty = walk(desktop.capture.root).next().done || desktop.capture.docHeight < 80 || desktop.capture.root.children.length === 0;
  if (empty) throw new Failed("The page shows nothing a copy could be made from (it may need a sign-in, or draw itself with scripts that did not run).");
  await say("ok", `Loaded “${desktop.capture.title || host}”: ${desktop.capture.docWidth} × ${desktop.capture.docHeight} px at computers' width, ${desktop.capture.fonts.length} typefaces in use.`);
  if (desktop.capture.left.fixed.length > 0) await say("info", `Left out because they float over the page: ${desktop.capture.left.fixed.slice(0, 4).join(", ")}.`);
  const watched = watchLine(desktop.capture);
  if (watched) await say("info", watched);
  let mobile = null;
  let phoneProblem = "";
  // Twice: a second visit often meets a site's bot protection or a slow start that the first did not.
  for (let attempt = 1; attempt <= 2 && !mobile; attempt++) {
    try {
      mobile = await looking(startBrowser, LOOK.phoneMs, (browser) => openOriginal(browser, row.url, "mobile", tick.signal));
      await say("ok", `Looked at it at a phone's width too: ${mobile.capture.docHeight} px tall.`);
    } catch (error) {
      if (error instanceof Error && error.message === "Stopped.") throw error;
      if (error instanceof Failed) throw error;
      phoneProblem = lookProblem(error);
      console.error("[replicate] phone width", attempt, error);
      if (attempt === 1) await say("info", `Opening the page at a phone's width did not work (${phoneProblem}); trying once more.`);
    }
  }
  if (!mobile) await say("warn", `The page could not be looked at at a phone's width (${phoneProblem}); the copy will use the builder's own phone layout.`);
  stopIfAsked(tick);

  // Photographs: the originals to compare with, and small ones for the owner's panel.
  const files: string[] = [];
  const originals: ReplicaWork["originals"] = { desktop: null, mobile: null };
  const textless: NonNullable<ReplicaWork["textless"]> = { desktop: null, mobile: null };
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
    if (opened.textless) {
      const bare = await sharp(opened.textless).flatten({ background: "#ffffff" }).jpeg({ quality: 92 }).toBuffer();
      const keptBare = await putFile(row.storeId, row.id, `original-${name}-textless.jpg`, bare, "image/jpeg");
      if (keptBare) {
        textless[name] = keptBare.url;
        files.push(keptBare.path);
      }
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
    textless,
    previews,
    files,
    title: desktop.capture.title,
    description: desktop.capture.description,
    background: hexOf(desktop.capture.background) ?? "#ffffff",
    assets: { pictures: {}, pictureQueue: [], videos: {}, videoQueue: [], shots, fonts: {}, fontQueue: [], failures: {}, total: 0 },
  });
  void owner;
  await setPhase(row.id, "examine");
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
  // The model that looks at pictures (D163): the AI settings' own field for it, else the text model.
  const connection = seeing(await tick.connection());
  if (!connection) {
    await say("warn", "The site has no AI model set up that looks at pictures, so the design is read by measuring only. Choose one under AI settings (Model that sees pictures) to let the AI look at the page and the copy.");
    await patchWork(row.id, { analysis: null, vision: { used: false, why: "The site has no AI model that sees pictures, so the pictures were not looked at; the copy was corrected by measuring only." } });
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
      const relation = fontRelation(family, result.family);
      await say(relation === "lookalike" ? "warn" : "ok", relation === "lookalike" ? `The typeface ${family} is not in Google Fonts; its nearest look-alike, ${result.family}, is installed for the site instead.` : `The typeface ${result.family} is in Google Fonts and is installed for the site.`);
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

/** What the converter is given: the capture, the assets kept for it, and the grids a pass has already sent back to columns. */
function buildInputOf(work: ReplicaWork, capture: { desktop: PageCapture; mobile: PageCapture | null }): BuildInput {
  const assets = work.assets!;
  return {
    desktop: capture.desktop,
    mobile: capture.mobile,
    picture: (url) => assets.pictures[url] ?? null,
    shot: (path) => assets.shots[path] ?? null,
    video: (url) => assets.videos[url] ?? null,
    font: (family) => assets.fonts[family] ?? null,
    reverted: work.reverted ?? [],
    backdrop: (key) => assets.backdrops?.[key] ?? null,
  };
}

async function stepBuild(tick: Tick): Promise<void> {
  const { row, say, owner } = tick;
  const capture = await readCapture(row.id);
  if (!capture) throw new Failed("What was read from the page was lost. Start again.");
  const input = buildInputOf(row.work, capture);
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
  await say("ok", `Built the page as a draft: ${built.counts.rows} rows and ${built.counts.blocks} blocks (${built.counts.headings} headings, ${built.counts.texts} text blocks, ${built.counts.pictures} pictures, ${built.counts.buttons} buttons, ${built.counts.videos} videos${built.counts.grids ? `, ${built.counts.grids} grid${built.counts.grids === 1 ? "" : "s"} of ${built.counts.items} custom items` : ""}).`);
  for (const kept of built.grids.kept.slice(0, 4)) await say("info", `${kept.cards} boxes at ${kept.sel} kept as columns: ${kept.reason}.`);
  for (const note of notes.slice(0, 8)) await say(note.level === "ok" ? "ok" : "warn", note.text);
  await patchWork(row.id, { model: built.model, parts: built.parts, shared: built.shared, notes, counts: built.counts, dropped: built.dropped, grids: built.grids, reverted: [], cssLength: styled.css.length, cssTrimmed: styled.trimmed ?? null, passes: [] });
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
  // What a trial of columns changes in the middle of the pass (D155) is merged into this copy of the job's work, so what follows reads it as it is.
  const work: ReplicaWork = { ...row.work };
  const model = work.model!;
  const parts = work.parts!;
  const originals = work.originals ?? { desktop: null, mobile: null };
  const frameUrl = `${owner.origin}/admin/account/replica/${row.id}?t=${encodeURIComponent(frameToken(row.id))}`;

  await say("info", k === 0 ? "Checking the first copy against the original, at both widths." : `Pass ${k} of ${max}: checking the draft against the original.`);
  const desktop = await looking(startBrowser, LOOK.copyMs, (browser) => openCopy(browser, frameUrl, "desktop")).catch((error: Error) => {
    if (error instanceof Failed) throw error;
    console.error("[replicate] copy at computers' width", error);
    throw new Failed(lookProblem(error));
  });
  stopIfAsked(tick);
  const mobile = originals.mobile ? await looking(startBrowser, LOOK.copyMs, (browser) => openCopy(browser, frameUrl, "mobile")).catch(() => null) : null;
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
  // A page rebuilt at this same pass (a trial of columns against a grid, or its end) is measured again at the same pass: its score replaces the one before, and no pass is spent.
  const passes = [...(work.remeasure ? (work.passes ?? []).slice(0, -1) : (work.passes ?? [])), pass];
  const sides: Sides = { desktop: { original: od.raster, copy: cd.raster, scale: od.scale }, phone: phoneSide ? { original: phoneSide.original, copy: phoneSide.copy, scale: phoneSide.scale } : null };

  // The columns of a trial are judged now, over the same stretch the grid stood in: they stay only if they match clearly better, else the grid comes back.
  if (work.trial) {
    const ended = await settleTrial(tick, work, work.trial, sides, k);
    if (ended.rebuilt) return;
    Object.assign(work, ended.patch);
  }

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
  await patchWork(row.id, { passes, previews, files, remeasure: false });
  work.remeasure = false;

  const perfect = isPerfect(scoreDesktop) && isPerfect(scoreMobile);
  // A grid that is weak (under 60 % over its stretch, at computers' or at phones' width) is tried as columns: the page is rebuilt with those groups as columns and measured again at
  // this same pass, and the columns stay only if they match clearly better there; otherwise the grid is put back. Nothing is decided on the grid's score alone (D155).
  // Not at the first copy: its spacing is not yet set right by measuring, so a grid and its columns are both judged by how far the page above them has drifted (lampan.no:
  // every grid read as weak at pass 0 and was rebuilt as columns, which then used up the page's blocks and style). From the first pass on, the page is where the original was.
  const weak = perfect || (k === 0 && max > 0) ? [] : weakNow(work, parts, scoreDesktop, scoreMobile);
  if (weak.length > 0 && (work.trials ?? 0) < TRIALS_MAX && (await startTrial(tick, work, weak, k, sides, passes, pass))) return;

  // Rows that still match badly are kept as a picture of the original with its words over it (D164), in two rounds: the rows that clearly fail as soon as the page has been
  // corrected once, and, on the last pass the measuring can still correct after, those that stayed under the higher mark.
  const round = work.backdropRounds ?? 0;
  const firstAt = max >= 2 ? 1 : 0;
  const lastAt = Math.max(firstAt + 1, max - 1);
  const due = round === 0 && k >= firstAt && k < Math.max(1, max) ? (max >= 3 ? BACKDROP_BELOW.first : BACKDROP_BELOW.last) : round === 1 && max >= 3 && k >= lastAt && k < max ? BACKDROP_BELOW.last : null;
  if (!perfect && due !== null && (await startBackdrops(tick, work, parts, desktop.capture, mobile?.capture ?? null, sides, k, passes, pass, due))) return;

  if (k >= max || perfect) {
    // A grid that was weak and matched no better as columns says both figures; one that was weak and could not be tried (the job's trials were spent, or the page would not be rebuilt) says so.
    const grids = work.grids ? { ...work.grids, built: work.grids.built.map((g) => annotated(g, work, weak, k)) } : work.grids;
    await patchWork(row.id, { ...(grids ? { grids } : {}), ...(perfect && k < max ? { stoppedEarly: true } : {}), finalDiff: finalDiffOf(parts, { original: od.raster, copy: cd.raster, scale: od.scale, capture: desktop.capture }, phoneSide) });
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
  const vision = work.vision?.used !== false ? seeing(connection) : null;
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
    await say("info", "The AI does not look at the copy (no AI model that sees pictures is set up); spacing is corrected by measuring.");
  }
  void blind;

  // Save the page's CSS as it is now, and move on to the next pass.
  const styled = renderStyles(model, work.shared ?? "");
  await saveDraftCss(row, owner.account.id, styled.css);
  passes[passes.length - 1] = { ...pass, changes, ...(observed ? { ai: observed } : {}) };
  await patchWork(row.id, { model, passes, cssLength: styled.css.length });
  await setPhase(row.id, "refine", k + 1);
}

// ---------------------------------------------------------------------------
// Rows that cannot be built from the page's parts (D164)
// ---------------------------------------------------------------------------

/**
 * Some pages cannot be built from boxes and words: a hero of two pictures with a headline between, a slider, a video behind a card, a collage. A row that, after the page
 * was corrected by measuring, still matches the original under `BACKDROP_BELOW` is kept as the strip of the original photographed with its words not painted (cut from the
 * photograph taken when the page was opened), with the original's words laid over it, each where it stood and in its own type. It matches by construction, and it says so in the
 * report: the pictures and links in it are part of the picture, only its words can be edited. The copy is measured again at this same pass (no pass is spent).
 * Returns whether the page was rebuilt; once tried, whatever came of it, it is not tried again.
 */
async function startBackdrops(tick: Tick, work: ReplicaWork, parts: NonNullable<ReplicaWork["parts"]>, copyDesktop: PageCapture, copyMobile: PageCapture | null, sides: Sides, k: number, passes: ReplicaPass[], pass: ReplicaPass, below: number): Promise<boolean> {
  const { row, say } = tick;
  const round = (work.backdropRounds ?? 0) + 1;
  const done = async (patch: Partial<ReplicaWork> = {}) => {
    Object.assign(work, { backdropRounds: round, ...patch });
    await patchWork(row.id, { backdropRounds: round, ...patch });
    return false;
  };
  const textless = work.textless;
  if (!textless?.desktop || !work.assets) return done();
  const already = work.assets?.backdrops ?? {};
  const found = weakRows(parts, sides.desktop, sides.phone, copyDesktop, copyMobile, below).filter(({ part }) => already[backdropKey(part.path, part.target![1])] === undefined);
  if (found.length === 0) return done();
  const capture = await readCapture(row.id);
  const desktopBare = await fetchBytes(textless.desktop);
  const phoneBare = textless.mobile ? await fetchBytes(textless.mobile) : null;
  const originals = work.originals;
  const desktopFull = originals?.desktop ? await fetchBytes(originals.desktop) : null;
  const phoneFull = originals?.mobile ? await fetchBytes(originals.mobile) : null;
  if (!capture || !desktopBare || !desktopFull) return done();
  const owner: AssetOwner = { storeId: row.storeId, accountId: tick.owner.account.id };
  const cut = async (photograph: Buffer, width: number, box: [number, number, number, number], name: string): Promise<KeptAsset | null> => {
    const meta = await sharp(photograph).metadata();
    const imageWidth = meta.width ?? 0;
    const imageHeight = meta.height ?? 0;
    const top = Math.max(0, Math.round(box[1]));
    const height = Math.min(Math.round(box[3]), imageHeight - top);
    if (!imageWidth || height < 1) return null;
    const png = await sharp(photograph).extract({ left: 0, top, width: Math.min(imageWidth, Math.max(1, Math.round(width))), height }).png().toBuffer();
    const saved = await saveShot(owner, png, name);
    return saved.ok ? saved.picture : null;
  };
  const backdrops: NonNullable<NonNullable<ReplicaWork["assets"]>["backdrops"]> = { ...(work.assets.backdrops ?? {}) };
  const used: NonNullable<ReplicaWork["backdropped"]> = [];
  for (const { part, desktop, phone } of found) {
    const dBox = part.target!;
    const label = `row-${part.path.replace(/\//g, "-") || "page"}-${Math.round(dBox[1])}`;
    const text = await cut(desktopBare, capture.desktop.docWidth, dBox, `${label}-d`);
    const plain = await cut(desktopFull, capture.desktop.docWidth, dBox, `${label}-full-d`);
    if (!text || !plain) continue;
    let phoneText: KeptAsset | null = null;
    let phonePlain: KeptAsset | null = null;
    if (capture.mobile && part.targetM) {
      if (!phoneBare || !phoneFull) continue;
      phoneText = await cut(phoneBare, capture.mobile.docWidth, part.targetM, `${label}-m`);
      phonePlain = await cut(phoneFull, capture.mobile.docWidth, part.targetM, `${label}-full-m`);
      if (!phoneText || !phonePlain) continue;
    }
    backdrops[backdropKey(part.path, dBox[1])] = { text: { desktop: text, phone: phoneText }, plain: { desktop: plain, phone: phonePlain } };
    used.push({ path: part.path, y: Math.round(dBox[1]), height: Math.round(dBox[3]), desktop, phone, pass: k });
  }
  if (used.length === 0) return done();
  const assets = { ...work.assets, backdrops };
  const rebuilt = await rebuildWith(tick, { ...work, assets }, work.reverted ?? []);
  if (!rebuilt) {
    await say("warn", "Some rows matched the original badly, but the page could not be rebuilt with them as pictures, so they stay as they were.");
    return done();
  }
  const words = used.slice(0, 4).map((u) => `${Math.round(u.y)}px (${[u.desktop !== null ? `${u.desktop}% on computers` : null, u.phone !== null ? `${u.phone}% on phones` : null].filter(Boolean).join(", ")})`);
  const plainCount = (rebuilt.patch.backdropPlain ?? []).length;
  const change = `${used.length === 1 ? "A row" : `${used.length} rows`} matched the original under ${below}% (${words.join("; ")}${used.length > 4 ? "; …" : ""}) and ${used.length === 1 ? "is" : "are"} now kept as a picture of the original${plainCount > 0 ? ` (${plainCount} of the page's rows only as a picture, their words hidden, as words laid over a picture would not fit the page's CSS)` : " with its words laid over it"}. The page is measured again.`;
  await say("warn", change);
  passes[passes.length - 1] = { ...pass, changes: [change] };
  const all = [...(work.backdropped ?? []), ...used];
  Object.assign(work, { backdropped: all, backdropRounds: round, assets, ...rebuilt.patch });
  await patchWork(row.id, { ...rebuilt.patch, assets, backdropped: all, backdropRounds: round, passes, remeasure: true });
  await setPhase(row.id, "refine", k);
  return true;
}

// ---------------------------------------------------------------------------
// A grid that may be worse than columns (D155)
// ---------------------------------------------------------------------------

/** Trials of columns against weak grids one job may start: each costs the copy being opened and measured again. */
const TRIALS_MAX = 2;

/** The photograph of the original and of the copy at each width, as small pictures, to measure one stretch of the page. */
type Sides = { desktop: { original: Raster; copy: Raster; scale: number }; phone: { original: Raster; copy: Raster; scale: number } | null };

/** How a stretch of the original matched in the copy, at each width measured. */
function stretchScores(stretch: GridStretch, sides: Sides): { desktop: number | null; phone: number | null } {
  const at = (side: Sides["desktop"] | null, place: { y: number; height: number } | null) => (side && place ? stretchMatch(side.original, side.copy, side.scale, place.y, place.height) : null);
  return { desktop: at(sides.desktop, stretch.desktop), phone: at(sides.phone, stretch.phone) };
}

/** The grids this measurement names weak, at computers' or at phones' width, that have not been tried against columns: the least match of the two. */
function weakNow(work: ReplicaWork, parts: NonNullable<ReplicaWork["parts"]>, desktop: ReplicaPass["desktop"], mobile: ReplicaPass["mobile"]): { path: string; match: number }[] {
  const found = new Map<string, number>();
  for (const w of weakGrids(parts, desktop.weakest)) found.set(w.path, w.match);
  if (mobile) for (const w of weakGrids(parts, mobile.weakest, 60, "phone")) found.set(w.path, Math.min(w.match, found.get(w.path) ?? 100));
  const done = new Set([...(work.settled ?? []), ...(work.reverted ?? []).map((r) => r.path)]);
  return [...found.entries()].filter(([path]) => !done.has(path)).map(([path, match]) => ({ path, match }));
}

/** What the report says of a grid at the end: that columns were tried and did no better, or that it was weak and was not tried. */
function annotated(g: NonNullable<ReplicaWork["grids"]>["built"][number], work: ReplicaWork, weak: { path: string; match: number }[], pass: number) {
  const tried = (work.tried ?? []).find((t) => t.path === g.path);
  if (tried) return { ...g, tried: { grid: tried.grid, columns: tried.columns, pass: tried.pass } };
  const w = weak.find((x) => x.path === g.path);
  return w ? { ...g, weak: { match: w.match, pass } } : g;
}

/** The draft's rows and style as they are, with what the converter said of them, so a grid can be put back exactly. */
async function snapshotOf(row: ReplicaRow, work: ReplicaWork): Promise<GridSnapshot | null> {
  const [draft] = await db().execute<Row>(sql`select draft->'rows' as rows, draft->>'css' as css from commerce.pages where id = ${row.pageId}::uuid and store_id = ${row.storeId}::uuid`);
  if (!draft || !work.model || !work.parts || !work.grids || !work.counts) return null;
  return { rows: draft.rows, css: String(draft.css ?? ""), model: work.model, parts: work.parts, shared: work.shared ?? "", notes: work.notes ?? [], counts: work.counts, dropped: work.dropped ?? [], grids: work.grids, cssLength: work.cssLength ?? 0, cssTrimmed: work.cssTrimmed ?? null, reverted: work.reverted ?? [] };
}

/** Writes rows and style into the draft. */
async function writeDraft(row: ReplicaRow, accountId: string, rows: unknown, css: string): Promise<void> {
  await db().execute(sql`
    update commerce.pages set draft = jsonb_set(jsonb_set(draft, '{rows}', ${JSON.stringify(rows)}::jsonb), '{css}', to_jsonb(${css}::text)), updated_at = now(), updated_by = ${accountId}::uuid
    where id = ${row.pageId}::uuid and store_id = ${row.storeId}::uuid
  `);
}

/**
 * The page built again from the captured original with some groups as columns, as the draft: the converter's output and the draft's style, or null when the builder
 * would not accept it (the draft is then left as it was). What earlier passes corrected by measuring is measured again; what the AI changed by hand is not carried over.
 */
async function rebuildWith(tick: Tick, work: ReplicaWork, reverted: NonNullable<ReplicaWork["reverted"]>): Promise<{ patch: Partial<ReplicaWork> } | null> {
  const { row, owner } = tick;
  const capture = await readCapture(row.id);
  if (!capture) return null;
  const fitted = buildFitted(buildInputOf({ ...work, reverted }, capture), randomUUID);
  const { built, styled } = fitted;
  const [draft] = await db().execute<Row>(sql`select draft->>'title' as title, draft->>'slug' as slug from commerce.pages where id = ${row.pageId}::uuid and store_id = ${row.storeId}::uuid`);
  const parsed = pageInput.safeParse({ ...newPageContent(), title: String(draft?.title ?? "Copy"), slug: String(draft?.slug ?? "copy"), rows: built.rows, css: styled.css });
  if (!draft || built.rows.length === 0 || cssProblem(styled.css) || !parsed.success) return null;
  await writeDraft(row, owner.account.id, built.rows, styled.css);
  const notes: ReplicaNote[] = [...built.notes];
  if (styled.trimmed) notes.push({ level: "warn", text: styled.trimmed });
  return { patch: { model: built.model, parts: built.parts, shared: built.shared, notes, counts: built.counts, dropped: built.dropped, grids: built.grids, reverted, backdropPlain: fitted.plain, cssLength: styled.css.length, cssTrimmed: styled.trimmed ?? null } };
}

/**
 * Weak grids are tried as columns (D155). A grid may never make a copy worse than columns were, but nothing says how columns would have matched until they are built and
 * measured, so: the draft is kept as it is, the page is rebuilt with those groups as columns, and the next measurement (at this same pass, spending none) compares the two over
 * the stretch the grid stood in (`settleTrial()`). Returns whether the page was rebuilt for the trial; a rebuild the builder would not accept leaves the grid, and is not tried again.
 */
async function startTrial(tick: Tick, work: ReplicaWork, weak: { path: string; match: number }[], k: number, sides: Sides, passes: ReplicaPass[], pass: ReplicaPass): Promise<boolean> {
  const { row, say } = tick;
  const snapshot = await snapshotOf(row, work);
  const sels = new Map((work.grids?.built ?? []).map((g) => [g.path, g] as const));
  const paths = weak.map((w) => w.path);
  const stretches = stretchesOf(work.parts ?? [], paths);
  const reverted = [...(work.reverted ?? []), ...weak.map((w) => ({ path: w.path, match: w.match, pass: k }))];
  const rebuilt = snapshot && stretches.length > 0 ? await rebuildWith(tick, work, reverted) : null;
  if (!snapshot || !rebuilt) {
    await say("warn", "A grid matched the original poorly, but the page could not be rebuilt as columns to try them, so the grid stays.");
    await patchWork(row.id, { settled: [...(work.settled ?? []), ...paths] });
    Object.assign(work, { settled: [...(work.settled ?? []), ...paths] });
    return false;
  }
  const groups: GridTrial["groups"] = stretches.map((stretch) => ({ path: stretch.path, sel: sels.get(stretch.path)?.sel ?? stretch.path, y: Math.round(stretch.desktop?.y ?? sels.get(stretch.path)?.y ?? 0), grid: stretchScores(stretch, sides), stretch }));
  const words = groups.map((g) => `${g.sel} matched ${g.grid.desktop ?? g.grid.phone ?? "?"}%`);
  const change = `Tried ${groups.length === 1 ? "a grid" : `${groups.length} grids`} as columns (${words.join("; ")}): the page is measured again, and the columns stay only if they match clearly better where the grid stood.`;
  await say("warn", change);
  passes[passes.length - 1] = { ...pass, changes: [change] };
  await patchWork(row.id, { ...rebuilt.patch, passes, trial: { pass: k, groups, snapshot }, trials: (work.trials ?? 0) + 1, remeasure: true });
  await setPhase(row.id, "refine", k);
  return true;
}

/**
 * Judges a trial: over each group's stretch the columns' match is set against the grid's. Columns that are clearly better (`columnsBeatGrid()`) stay, with both figures kept
 * for the report; a grid they did not beat comes back: exactly as it was (its rows and style as saved before the trial) when no group's columns won, else the page is built again
 * with only the winners as columns. Either way the grid is never tried again. `rebuilt`: the draft was changed and the next tick measures it, at the same pass.
 */
async function settleTrial(tick: Tick, work: ReplicaWork, trial: GridTrial, sides: Sides, k: number): Promise<{ rebuilt: true } | { rebuilt: false; patch: Partial<ReplicaWork> }> {
  const { row, say, owner } = tick;
  const verdicts = trial.groups.map((g) => ({ g, ...columnsBeatGrid(g.grid, stretchScores(g.stretch, sides)) }));
  const winners = verdicts.filter((v) => v.columnsWin);
  const losers = verdicts.filter((v) => !v.columnsWin);
  const figures = (v: (typeof verdicts)[number]) => `${v.g.sel}: grid ${v.grid ?? "?"}%, columns ${v.columns ?? "?"}%`;
  const evidence = (r: NonNullable<ReplicaWork["reverted"]>[number]) => {
    const v = winners.find((x) => x.g.path === r.path);
    return v ? { ...r, match: v.grid ?? r.match, ...(v.columns === null ? {} : { columns: v.columns }) } : r;
  };
  const tried = [...(work.tried ?? []), ...losers.map((v) => ({ path: v.g.path, grid: v.grid ?? 0, columns: v.columns ?? 0, pass: trial.pass }))];
  const settled = [...new Set([...(work.settled ?? []), ...trial.groups.map((g) => g.path)])];
  const keepColumns = (work.reverted ?? []).filter((r) => !losers.some((v) => v.g.path === r.path)).map(evidence);

  /** The report's lines for the groups kept as columns say how each matched, now that the columns are measured. */
  const withFigures = (grids: ReplicaWork["grids"]): ReplicaWork["grids"] =>
    grids && {
      ...grids,
      kept: grids.kept.map((entry) => {
        const r = keepColumns.find((x) => x.path === entry.path);
        return r && entry.reverted ? { ...entry, reason: `rebuilt as columns after pass ${r.pass}: the grid matched the original ${r.match}% there${r.columns === undefined ? "" : `, the columns ${r.columns}%`}`, reverted: { match: r.match, pass: r.pass, ...(r.columns === undefined ? {} : { columns: r.columns }) } } : entry;
      }),
    };

  if (losers.length === 0) {
    await say("ok", `The columns matched better than the ${trial.groups.length === 1 ? "grid" : "grids"} over ${trial.groups.length === 1 ? "its" : "their"} stretch (${verdicts.map(figures).join("; ")}), so they stay.`);
    const grids = withFigures(work.grids);
    const patch: Partial<ReplicaWork> = { reverted: keepColumns, ...(grids ? { grids } : {}), trial: null, settled, remeasure: false };
    await patchWork(row.id, patch);
    return { rebuilt: false, patch };
  }
  if (winners.length === 0) {
    // No columns were better: the grid goes back exactly as it was, with its earlier corrections, and is measured again at this pass.
    const back = trial.snapshot;
    await writeDraft(row, owner.account.id, back.rows, back.css);
    await say("warn", `The columns did not match the original better than the ${trial.groups.length === 1 ? "grid" : "grids"} did (${verdicts.map(figures).join("; ")}), so the ${trial.groups.length === 1 ? "grid is" : "grids are"} put back.`);
    await patchWork(row.id, { model: back.model, parts: back.parts, shared: back.shared, notes: back.notes, counts: back.counts, dropped: back.dropped, grids: back.grids, reverted: back.reverted, cssLength: back.cssLength, cssTrimmed: back.cssTrimmed, trial: null, settled, tried, remeasure: true });
    await setPhase(row.id, "refine", k);
    return { rebuilt: true };
  }
  // Some columns won and some did not: the page is built again with the winners as columns and the others as grids.
  const rebuilt = await rebuildWith(tick, work, keepColumns);
  if (!rebuilt) {
    // It would not be accepted: the columns of this trial stay as they are, and the losers with them.
    await say("warn", "Some grids matched better as columns and some did not, but the page could not be rebuilt to keep only the better ones, so the columns of this trial stay.");
    const grids = withFigures(work.grids);
    const patch: Partial<ReplicaWork> = { reverted: (work.reverted ?? []).map(evidence), ...(grids ? { grids } : {}), trial: null, settled, remeasure: false };
    await patchWork(row.id, patch);
    return { rebuilt: false, patch };
  }
  await say("warn", `Some groups matched better as columns and some as grids (${verdicts.map(figures).join("; ")}): the page is built again with only the better ones as columns.`);
  await patchWork(row.id, { ...rebuilt.patch, trial: null, settled, tried, remeasure: true });
  await setPhase(row.id, "refine", k);
  return { rebuilt: true };
}

// ---------------------------------------------------------------------------
// The end
// ---------------------------------------------------------------------------

/**
 * A job that ends while a trial of columns is running (it was stopped, or failed) leaves the page as it was before the trial: the columns were never measured, and the grid
 * was, so the page is not left worse than the one that is known. Returns the job as it is then.
 */
async function endTrial(owner: ReplicaOwner, row: ReplicaRow): Promise<ReplicaRow> {
  const trial = row.work.trial;
  if (!trial || !row.pageId) return row;
  const back = trial.snapshot;
  await writeDraft(row, owner.account.id, back.rows, back.css);
  await patchWork(row.id, { model: back.model, parts: back.parts, shared: back.shared, notes: back.notes, counts: back.counts, dropped: back.dropped, grids: back.grids, reverted: back.reverted, cssLength: back.cssLength, cssTrimmed: back.cssTrimmed, trial: null, remeasure: false });
  await writeLog(row.id, "refine", "warn", "The job ended while columns were being tried against a grid, so the grid, which was measured, is put back.");
  return (await getRow(row.id, owner.storeId)) ?? row;
}

async function conclude(owner: ReplicaOwner, started: ReplicaRow, outcome: "done" | "failed" | "aborted", problem: string | null): Promise<void> {
  const row = await endTrial(owner, started);
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
      fontsInstalled: fonts.filter(([family, installed]) => installed && fontRelation(family, installed) !== "lookalike").map(([, installed]) => installed as string),
      fontsStandIn: fonts.filter(([family, installed]) => installed && fontRelation(family, installed) === "lookalike").map(([family, installed]) => ({ from: family, to: installed as string })),
      fontsFailed: fonts.filter(([, installed]) => !installed).map(([family]) => family),
      shots: Object.values(assets?.shots ?? {}).filter(Boolean).length,
    },
    passes: work.passes ?? [],
    iterationsAsked: row.iterationsMax,
    stoppedEarly: Boolean(work.stoppedEarly),
    vision: { used: work.vision?.used ?? false, why: work.vision?.why ?? null },
    page,
    analysis: work.analysis ? { summary: work.analysis.summary, hard: work.analysis.hard } : null,
    ...(work.grids ? { grids: work.grids } : {}),
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
      ...(work.grids ? { grids: work.grids } : {}),
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

/** What the studio can offer: copying needs a browser; the AI's part needs a model that sees pictures. */
export async function replicaAbilities(storeId: string): Promise<{ ai: boolean; browser: boolean }> {
  const connection = await aiFor(storeId);
  return { ai: Boolean(seeing(connection)), browser: true };
}

export type { PageCapture };
