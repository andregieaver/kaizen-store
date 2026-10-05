import sharp from "sharp";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { finished } from "@/lib/replicate";
import type { Box, CaptureNode, PageCapture } from "@/lib/replicate-capture";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

// -- the original page, as a browser would have captured it ----------------------------------------------------------

const text = (tag: string, box: Box, t: string, s: Record<string, string> = {}, p = ""): CaptureNode => ({
  p,
  tag,
  box,
  s: { display: "block", fontSize: "18px", lineHeight: "26px", fontWeight: "400", color: "rgb(20, 20, 30)", fontFamily: "Arial, sans-serif", textAlign: "left", ...s },
  runs: [{ t }],
  children: [],
});

/** What the original is: the hero page, or (for the grid tests) a heading over four of the same card. */
const mode = vi.hoisted(() => ({ grid: false, right: false, columnsBetter: false }));

/** A heading over four cards: a picture, a title, words and a button each, side by side at computers' width and one under another on phones. */
function gridOriginal(width: number): PageCapture {
  const phone = width < 700;
  const w = phone ? 358 : 290;
  const card = (i: number): CaptureNode => {
    const x = phone ? 16 : 110 + i * (w + 20);
    const y = phone ? 170 + i * 440 : 170;
    const p = `0/1/${i}`;
    return {
      p,
      tag: "div",
      sel: "div.card",
      box: [x, y, w, 420],
      s: { display: "block", backgroundColor: "rgb(245, 245, 250)", borderTopLeftRadius: "12px", borderTopRightRadius: "12px", borderBottomRightRadius: "12px", borderBottomLeftRadius: "12px" },
      children: [
        { p: `${p}/0`, tag: "img", box: [x, y, w, 200], s: { display: "block", objectFit: "cover" }, media: { kind: "img", url: `https://source.test/card-${i}.jpg`, width: 800, height: 600, alt: `Card ${i}` }, children: [] },
        text("h3", [x + 16, y + 216, w - 32, 28], `Card ${i}`, { fontSize: "22px", lineHeight: "28px", fontWeight: "600" }, `${p}/1`),
        text("p", [x + 16, y + 252, w - 32, 72], `Words on card ${i}.`, {}, `${p}/2`),
        { ...text("a", [x + 16, y + 348, 110, 44], "Read it", { color: "rgb(255, 255, 255)", backgroundColor: "rgb(79, 70, 229)", paddingTop: "10px", paddingBottom: "10px", paddingLeft: "16px", paddingRight: "16px", textAlign: "center" }, `${p}/3`), button: true, href: `https://source.test/cards/${i}` },
      ],
    };
  };
  const cards = [0, 1, 2, 3].map(card);
  const section: CaptureNode = {
    p: "0",
    tag: "section",
    box: [0, 100, width, phone ? 1900 : 520],
    s: { display: "block" },
    children: [text("h2", [phone ? 16 : 110, 110, 600, 40], "Our cards", { fontSize: "32px", lineHeight: "40px", fontWeight: "700" }, "0/0"), { p: "0/1", tag: "div", sel: "div.cards", box: [phone ? 16 : 110, 170, phone ? 358 : 1220, phone ? 1740 : 420], s: { display: "flex" }, children: cards }],
  };
  return {
    viewport: { w: width, h: 900 },
    url: "https://source.test/",
    title: "Source page",
    lang: "en",
    description: "A page to copy",
    docWidth: width,
    docHeight: 1000,
    background: "rgb(255, 255, 255)",
    fonts: [{ family: "Arial", weight: "400", style: "normal", chars: 200 }],
    left: { fixed: [], hidden: 0, capped: false },
    root: { p: "", tag: "body", box: [0, 0, width, 1000], s: { display: "block" }, children: [section] },
  };
}

function original(width: number): PageCapture {
  if (mode.grid) return gridOriginal(width);
  const mobile = width < 700;
  const left = mobile ? 20 : 320;
  const w = mobile ? 350 : 800;
  const hero: CaptureNode = {
    p: "0",
    tag: "section",
    box: [0, 0, width, 400],
    s: { display: "block", backgroundColor: "rgb(20, 24, 40)" },
    children: [
      text("h1", [left, 80, w, 60], "Make it better, every day", { fontSize: "48px", lineHeight: "60px", fontWeight: "700", color: "rgb(255, 255, 255)" }, "0/0"),
      text("p", [left, 160, w, 56], "Small steps add up to large changes.", { color: "rgb(200, 200, 210)" }, "0/1"),
      { ...text("a", [left, 250, 200, 56], "Get started", { color: "rgb(255, 255, 255)", backgroundColor: "rgb(79, 70, 229)", paddingTop: "16px", paddingBottom: "16px", paddingLeft: "32px", paddingRight: "32px" }, "0/2"), button: true, href: "https://example.com/start" },
    ],
  };
  const image: CaptureNode = { p: "1", tag: "img", box: [left, 440, w, 300], s: { display: "block" }, media: { kind: "img", url: "https://source.test/photo.jpg", width: 800, height: 600, alt: "A photo" }, children: [] };
  const missing: CaptureNode = { p: "2", tag: "img", box: [left, 760, w, 200], s: { display: "block" }, media: { kind: "img", url: "https://source.test/gone.jpg", width: 800, height: 400, alt: "" }, children: [] };
  return {
    viewport: { w: width, h: 900 },
    url: "https://source.test/",
    title: "Source page",
    lang: "en",
    description: "A page to copy",
    docWidth: width,
    docHeight: 1000,
    background: "rgb(255, 255, 255)",
    fonts: [{ family: "Arial", weight: "400", style: "normal", chars: 200 }],
    left: { fixed: [], hidden: 0, capped: false },
    root: { p: "", tag: "body", box: [0, 0, width, 1000], s: { display: "block" }, children: [hero, image, missing] },
  };
}

const png = (width: number, height: number, band: number | null, bandHeight = 200) =>
  sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite(band === null ? [] : [{ input: { create: { width, height: bandHeight, channels: 3, background: "#ee2244" } }, left: 0, top: band }])
    .png()
    .toBuffer();

/** Files the job put in Storage, by address, so the engine can read the original back. */
const stored = vi.hoisted(() => new Map<string, Buffer>());
/** How many times the copy has been opened, by job: the first copy differs from the original, later ones match. */
const opened = vi.hoisted(() => ({ copies: 0, phase: "" }));
const ai = vi.hoisted(() => ({ calls: [] as string[], connection: null as unknown }));

vi.mock("./browser", () => ({ launchBrowser: async () => ({ close: async () => {} }) }));
vi.mock("./replicate-browser", () => ({
  openOriginal: async (_browser: unknown, _url: string, viewport: "desktop" | "mobile") => ({
    capture: original(viewport === "desktop" ? 1440 : 390),
    screenshot: await png(viewport === "desktop" ? 1440 : 390, 1000, null),
    elements: new Map<string, Buffer>(),
  }),
  openCopy: async (_browser: unknown, frameUrl: string, viewport: "desktop" | "mobile") => {
    const id = /replica\/([0-9a-f-]{36})/.exec(frameUrl)![1];
    const [row] = await db().execute<Row>(sql`select work from commerce.page_replications where id = ${id}::uuid`);
    const parts = ((row.work as { parts: { id: string; target: Box | null; targetM: Box | null }[] }).parts ?? []).filter((p) => (viewport === "desktop" ? p.target : p.targetM));
    if (viewport === "desktop") opened.copies += 1;
    // The first time, the copy's blocks sit 30 px too low and it is wrong in a band; later it is right.
    const wrong = false;
    const children: CaptureNode[] = parts.map((p, i) => {
      const box = (viewport === "desktop" ? p.target : p.targetM)!;
      return { p: String(i), tag: "div", id: p.id, box: [box[0], box[1] + (wrong ? 30 : 0), box[2], box[3]], s: {}, children: [] };
    });
    const w = viewport === "desktop" ? 1440 : 390;
    const capture: PageCapture = { ...original(w), root: { p: "", tag: "body", box: [0, 0, w, 1000], s: {}, children } };
    // Adversarial review (D155 C): the grid copy matches 55 % over the grid's stretch; the same page as columns would match only 20 %.
    const hasGrid = parts.some((p) => (p as { grid?: string }).grid);
    // `columnsBetter`: the same page as columns is nearly right where the grid is wrong.
    const band = hasGrid ? await png(w, 1000, 150, 450) : mode.columnsBetter ? await png(w, 1000, 100, 40) : await png(w, 1000, 100, 800);
    return { capture, screenshot: viewport === "desktop" ? band : await png(w, 1000, null), elements: new Map<string, Buffer>() };
  },
}));
vi.mock("./replicate-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./replicate-assets")>()),
  savePicture: async (_owner: unknown, url: string) =>
    url.endsWith("gone.jpg")
      ? { ok: false, problem: "The site answered 404." }
      : { ok: true, picture: { url: mode.grid ? `https://files.test/storage/v1/object/public/media/${url.split("/").pop()}` : "https://files.test/demo/cabin.svg", width: 800, height: 600 } },
  saveShot: async () => ({ ok: false, problem: "none" }),
  saveVideo: async () => ({ ok: false, problem: "none" }),
  installFamily: async () => ({ ok: false, problem: "It is not in Google Fonts." }),
}));
vi.mock("./replicate-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./replicate-store")>()),
  putFile: async (storeId: string, jobId: string, name: string, bytes: Uint8Array) => {
    const url = `https://files.test/${storeId}/${jobId}/${name}`;
    stored.set(url, Buffer.from(bytes));
    return { url, path: `${storeId}/replica-${jobId}/${name}` };
  },
  removeFiles: async () => {},
}));
vi.mock("./ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ai")>()),
  aiFor: async () => ai.connection,
  completeText: async (_connection: unknown, messages: { content: unknown }[]) => {
    const system = String(messages[0].content);
    if (system.includes("senior web designer")) {
      ai.calls.push("analysis");
      return { text: '{"summary":"A dark hero with a call to action.","palette":[{"hex":"#141828","use":"hero"}],"typography":"Plain sans serif","sections":[{"name":"Hero","purpose":"Sell"}],"hard":["A carousel"]}', region: null };
    }
    ai.calls.push("assess");
    const parts = JSON.parse(JSON.stringify({ summary: "The heading is a little small.", changes: [{ part: "rp1", set: { position: "fixed" } }, { part: "rp404", set: { color: "#000" } }], notes: ["Shadows are subtle"] }));
    return { text: JSON.stringify(parts), region: null };
  },
}));

// -- the store and its owner ------------------------------------------------------------------------------------------

const engine = await import("./replicate");
await import("./replicate-store");

const run = Date.now().toString(36);
let storeId: string;
let storeSlug: string;
let account: Account;
let owner: Parameters<typeof engine.startReplication>[0];

beforeAll(async () => {
  process.env.REPLICATE_ALLOW_PRIVATE = "1";
  process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
  const [req] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`rp-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(req.id)}::uuid, ${`rp-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  storeSlug = `rp-${run}`;
  const [acc] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`rp-admin-${run}@example.com`}, 'Owner') returning id`);
  account = { id: String(acc.id), email: `rp-admin-${run}@example.com`, name: "Owner", platformAdmin: false };
  owner = { storeId, storeSlug, account, origin: "http://127.0.0.1:3000" };
  // The engine reads the original's photograph back from Storage by address.
  vi.stubGlobal("fetch", async (url: string) => (stored.has(String(url)) ? new Response(new Uint8Array(stored.get(String(url))!)) : new Response("not found", { status: 404 })));
});

beforeEach(async () => {
  mode.grid = false;
  mode.right = false;
  mode.columnsBetter = false;
  opened.copies = 0;
  ai.calls.length = 0;
  ai.connection = { textModel: "test-model", provider: "openai" };
  await db().execute(sql`update commerce.page_replications set status = 'failed', finished_at = now() where store_id = ${storeId}::uuid and status in ('queued', 'running')`);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db().execute(sql`delete from commerce.page_replications where store_id = ${storeId}::uuid`);
  await closeDb();
});

async function runToEnd(id: string, limit = 40) {
  let job = null;
  for (let i = 0; i < limit; i += 1) {
    job = await engine.tickReplication(owner, id);
    if (!job || finished(job.status)) return job;
  }
  throw new Error("The job did not finish.");
}


describe("a grid never makes a copy worse than the columns would have", () => {
  const draftOf = async (pageId: string) => {
    const [page] = await db().execute<Row>(sql`select draft from commerce.pages where id = ${pageId}::uuid and store_id = ${storeId}::uuid`);
    return page.draft as { rows: { columns: { blocks: { type: string }[] }[] }[] };
  };

  it("keeps the grid when the columns it was swapped for match the original worse than the grid did", async () => {
    mode.grid = true;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://files.test");
    ai.connection = null;
    const started = await engine.startReplication(owner, "https://source.test/", 3, true);
    if (!started.ok) throw new Error(started.problem);
    const job = (await runToEnd(started.job.id))!;
    expect(job.status).toBe("done");
    const matches = job.passes.map((p) => p.desktop.match);
    // The grid was weak at pass 1 (about 55 %), the columns it was swapped for matched about 20 %: the guard exists so a copy never gets worse. (Not at pass 0: its spacing is not yet set right.)
    expect(matches.length).toBeGreaterThan(1);
    expect(matches[matches.length - 1], `the passes matched ${matches.join(", ")} %`).toBeGreaterThanOrEqual(matches[0]);
    // A trial of columns spends no improving pass: the passes are the job's own, 0 to 3, each measured once as its entry.
    expect(job.passes.map((p) => p.iteration)).toEqual([0, 1, 2, 3]);
    const draft = await draftOf(job.pageId!);
    const grids = draft.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks)).filter((b) => b.type === "contentGrid");
    expect(grids, "the page ended as the worse of the two builds").toHaveLength(1);
    // The report says the grid was weak, columns were tried, and what each matched.
    const built = job.summary!.report!.grids!.built[0];
    expect(built.tried, "a grid that stayed after a trial says both figures").toMatchObject({ pass: 1 });
    expect(built.tried!.columns).toBeLessThanOrEqual(built.tried!.grid + 2);
    expect(job.summary!.problems.join(" ")).toMatch(/columns were tried and matched/);
    vi.unstubAllEnvs();
    vi.stubEnv("REPLICATE_ALLOW_PRIVATE", "1");
  });

  it("builds the columns and keeps them when they match the original clearly better over the grid's stretch, and never tries the grid again", async () => {
    mode.grid = true;
    mode.columnsBetter = true;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://files.test");
    ai.connection = null;
    const started = await engine.startReplication(owner, "https://source.test/", 2, true);
    if (!started.ok) throw new Error(started.problem);
    const job = (await runToEnd(started.job.id))!;
    expect(job.status).toBe("done");
    expect(job.passes.map((p) => p.iteration)).toEqual([0, 1, 2]);
    const draft = await draftOf(job.pageId!);
    expect(draft.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks)).filter((b) => b.type === "contentGrid")).toHaveLength(0);
    const kept = job.summary!.report!.grids!.kept.find((k) => k.reverted);
    expect(kept?.reverted?.columns, "the evidence has both figures").toBeGreaterThan(kept!.reverted!.match);
    expect(job.summary!.problems.join(" ")).toMatch(/rebuilt as columns after pass 1.*the columns \d/);
    // The copy ended as the better of the two (the grid matched about 55 % as a whole, the columns about 96 %): the columns' score is the pass's, measured once.
    expect(job.passes[job.passes.length - 1].desktop.match).toBeGreaterThan(90);
    expect(job.log.some((entry) => /Tried a grid as columns/.test(entry.text))).toBe(true);
    vi.unstubAllEnvs();
    vi.stubEnv("REPLICATE_ALLOW_PRIVATE", "1");
  });

  it("spends none of the improving passes on the trial: with one pass asked for, the grid put back is still corrected by it", async () => {
    mode.grid = true;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://files.test");
    // With a model, the improving pass looks at the copy with it, once for each pass that is spent on improving: a trial spends none.
    const started = await engine.startReplication(owner, "https://source.test/", 1, true);
    if (!started.ok) throw new Error(started.problem);
    const job = (await runToEnd(started.job.id))!;
    expect(job.status).toBe("done");
    expect(job.passes.map((p) => p.iteration)).toEqual([0, 1]);
    expect(ai.calls.filter((c) => c === "assess"), "the one pass asked for ran, after the grid was put back").toHaveLength(1);
    const draft = await draftOf(job.pageId!);
    expect(draft.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks)).filter((b) => b.type === "contentGrid")).toHaveLength(1);
    vi.unstubAllEnvs();
    vi.stubEnv("REPLICATE_ALLOW_PRIVATE", "1");
  });

  it("puts the grid back when the job ends while columns are being tried against it: the page is never left as the unmeasured one", async () => {
    mode.grid = true;
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://files.test");
    ai.connection = null;
    const started = await engine.startReplication(owner, "https://source.test/", 3, true);
    if (!started.ok) throw new Error(started.problem);
    let trialling = false;
    for (let i = 0; i < 20 && !trialling; i += 1) {
      await engine.tickReplication(owner, started.job.id);
      const [row] = await db().execute<Row>(sql`select work->'trial' is not null and work->>'trial' <> 'null' as trial from commerce.page_replications where id = ${started.job.id}::uuid`);
      trialling = Boolean(row.trial);
    }
    expect(trialling, "a trial of columns was started").toBe(true);
    // While the trial runs the draft is the columns'.
    const [mid] = await db().execute<Row>(sql`select page_id from commerce.page_replications where id = ${started.job.id}::uuid`);
    expect((await draftOf(String(mid.page_id))).rows.flatMap((r) => r.columns.flatMap((c) => c.blocks)).filter((b) => b.type === "contentGrid")).toHaveLength(0);
    const job = (await engine.abortReplication(owner, started.job.id))!;
    expect(job.status).toBe("aborted");
    const draft = await draftOf(job.pageId!);
    expect(draft.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks)).filter((b) => b.type === "contentGrid")).toHaveLength(1);
    expect(job.log.some((entry) => /put back/.test(entry.text))).toBe(true);
    vi.unstubAllEnvs();
    vi.stubEnv("REPLICATE_ALLOW_PRIVATE", "1");
  });
});
