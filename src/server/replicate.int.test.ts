import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { finished } from "@/lib/replicate";
import type { Box, CaptureNode, PageCapture } from "@/lib/replicate-capture";
import { reportMarkdown } from "@/lib/replicate-report";

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

function original(width: number): PageCapture {
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

const png = (width: number, height: number, band: number | null) =>
  sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite(band === null ? [] : [{ input: { create: { width, height: 200, channels: 3, background: "#ee2244" } }, left: 0, top: band }])
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
    const wrong = opened.copies === 1;
    const children: CaptureNode[] = parts.map((p, i) => {
      const box = (viewport === "desktop" ? p.target : p.targetM)!;
      return { p: String(i), tag: "div", id: p.id, box: [box[0], box[1] + (wrong ? 30 : 0), box[2], box[3]], s: {}, children: [] };
    });
    const w = viewport === "desktop" ? 1440 : 390;
    const capture: PageCapture = { ...original(w), root: { p: "", tag: "body", box: [0, 0, w, 1000], s: {}, children } };
    return { capture, screenshot: await png(w, 1000, wrong ? 300 : null), elements: new Map<string, Buffer>() };
  },
}));
vi.mock("./replicate-assets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./replicate-assets")>()),
  savePicture: async (_owner: unknown, url: string) => (url.endsWith("gone.jpg") ? { ok: false, problem: "The site answered 404." } : { ok: true, picture: { url: "https://files.test/demo/cabin.svg", width: 800, height: 600 } }),
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
const store = await import("./replicate-store");

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

describe("copying a page, from the address to the summary", () => {
  it("refuses an address it may not open, and a copy nobody confirmed", async () => {
    vi.stubEnv("REPLICATE_ALLOW_PRIVATE", "");
    expect(await engine.startReplication(owner, "http://169.254.169.254/latest", 3, true)).toMatchObject({ ok: false });
    expect(await engine.startReplication(owner, "ftp://example.com/x", 3, true)).toMatchObject({ ok: false });
    vi.stubEnv("REPLICATE_ALLOW_PRIVATE", "1");
    expect(await engine.startReplication(owner, "https://source.test/", 3, false)).toMatchObject({ ok: false, problem: expect.stringMatching(/right to copy/) });
  });

  it("goes through every step, improves the draft by measuring and by the AI, and says how it went", async () => {
    const started = await engine.startReplication(owner, "https://source.test/", 2, true);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    // Only one job at a time for a store.
    expect(await engine.startReplication(owner, "https://source.test/other", 3, true)).toMatchObject({ ok: false, problem: expect.stringMatching(/already being copied/) });

    const phases: string[] = [];
    let job = started.job;
    for (let i = 0; i < 40 && !finished(job.status); i += 1) {
      job = (await engine.tickReplication(owner, job.id))!;
      if (phases[phases.length - 1] !== job.phase) phases.push(job.phase);
    }
    expect(job.status).toBe("done");
    expect(phases).toEqual(["examine", "copy", "assets", "build", "refine", "done"]);
    expect(job.progress).toBe(100);

    // The log tells the owner what happened, step by step.
    const log = job.log.map((entry) => entry.text).join("\n");
    expect(log).toMatch(/Opening source.test/);
    expect(log).toMatch(/Loaded “Source page”/);
    expect(log).toMatch(/The AI's reading: A dark hero/);
    expect(log).toMatch(/Copied the text: 3 pieces/);
    expect(log).toMatch(/Could not download gone.jpg: The site answered 404/);
    expect(log).toMatch(/Built the page as a draft/);
    expect(log).toMatch(/matches the original/);
    expect(log).toMatch(/Spacing set right/);
    expect(log).toMatch(/The AI sees: The heading is a little small/);
    expect(log).toMatch(/not allowed and left out/);

    // The previews: the original, and the copy as it was last measured.
    expect(job.previews.original.desktop).toMatch(/original-desktop-preview.jpg$/);
    expect(job.previews.copy.desktop).toMatch(/copy-desktop-1.jpg$/);
    expect(job.previews.copy.iteration).toBe(1);

    // The first copy was wrong in a band and 30 px out; after one pass of measuring it matches, so the second pass is not needed.
    expect(job.passes).toHaveLength(2);
    expect(job.passes[0].desktop.match).toBeLessThan(90);
    expect(job.passes[1].desktop.match).toBe(100);
    expect(job.passes[0].changes.some((c) => /Spacing set right/.test(c))).toBe(true);

    // The summary, from the facts.
    const summary = job.summary!;
    expect(summary.outcome).toBe("done");
    expect(summary.finalMatch.desktop).toBe(100);
    expect(summary.wentWell.join("\n")).toMatch(/as close as pixels allow/);
    expect(summary.wentWell.join("\n")).toMatch(/words of text were copied exactly/);
    expect(summary.wentWell.join("\n")).toMatch(/1 picture was downloaded/);
    // The report for whoever improves the replicator: findings with evidence and where to start, and the whole of it as Markdown.
    const report = summary.report!;
    expect(report.source.url).toContain("source.test");
    expect(report.rows.length).toBeGreaterThan(0);
    expect(report.findings.every((f) => f.evidence.length > 0 && f.where.length > 0 && f.change !== "")).toBe(true);
    expect(reportMarkdown(report)).toContain("## Findings, worst first");
    expect(summary.problems.join("\n")).toMatch(/1 picture could not be downloaded/);
    expect(summary.problems.join("\n")).toMatch(/hard to copy: A carousel/);
    expect(summary.page).not.toBeNull();
    expect(job.pageId).toBe(summary.page!.id);

    // The draft is a page of the store, hidden from search engines and not published, with the copy's CSS.
    const [page] = await db().execute<Row>(sql`select draft, published from commerce.pages where id = ${job.pageId}::uuid and store_id = ${storeId}::uuid`);
    const draft = page.draft as { title: string; searchEngines: boolean; aiAssistants: boolean; css: string; rows: { columns: { blocks: { type: string }[] }[] }[] };
    expect(page.published).toBeNull();
    expect(draft.title).toBe("Source page");
    expect(draft.searchEngines).toBe(false);
    expect(draft.aiAssistants).toBe(false);
    expect(draft.rows[0].columns[0].blocks.map((b) => b.type)).toEqual(["heading", "richText", "button"]);
    expect(draft.css).toMatch(/\.rp\.rp :is\(h1/);
    // The AI's disallowed change (position: fixed) and its part that does not exist were refused.
    expect(draft.css).not.toMatch(/position:fixed/);

    // The AI looked once at the design and once per pass at the differences.
    expect(ai.calls[0]).toBe("analysis");
    expect(ai.calls.filter((c) => c === "assess").length).toBeGreaterThanOrEqual(1);

    // The job is kept in the audit log, and the capture of the original is gone with it.
    const [audit] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${storeId}::uuid and action in ('store.page_replication_started', 'store.page_replicated')`);
    expect(Number(audit.n)).toBeGreaterThanOrEqual(2);
    const [after] = await db().execute<Row>(sql`select capture from commerce.page_replications where id = ${job.id}::uuid`);
    expect(after.capture).toBeNull();
  });

  it("carries on without the AI, and says so", async () => {
    ai.connection = null;
    const started = await engine.startReplication(owner, "https://source.test/", 1, true);
    if (!started.ok) throw new Error(started.problem);
    const job = (await runToEnd(started.job.id))!;
    expect(job.status).toBe("done");
    expect(ai.calls).toEqual([]);
    expect(job.log.map((l) => l.text).join("\n")).toMatch(/no AI text model/);
    expect(job.summary!.problems.join("\n")).toMatch(/no AI text model|corrected by measuring only/);
    expect(job.passes).toHaveLength(2);
  });

  it("can be stopped by the owner, and says what it had done", async () => {
    const started = await engine.startReplication(owner, "https://source.test/", 3, true);
    if (!started.ok) throw new Error(started.problem);
    let job = (await engine.tickReplication(owner, started.job.id))!;
    expect(finished(job.status)).toBe(false);
    job = (await engine.abortReplication(owner, job.id))!;
    // Nobody was working on it, so it ended at once.
    expect(job.status).toBe("aborted");
    expect(job.summary!.outcome).toBe("aborted");
    expect(job.summary!.problems[0]).toMatch(/stopped before it was finished/);
    // Another can be started now, and nothing of the stopped one is ticked on.
    const next = await engine.startReplication(owner, "https://source.test/", 1, true);
    expect(next.ok).toBe(true);
    expect((await engine.tickReplication(owner, job.id))!.status).toBe("aborted");
  });

  it("stops a job that is at work when the owner asks, at its next safe point", async () => {
    const started = await engine.startReplication(owner, "https://source.test/", 3, true);
    if (!started.ok) throw new Error(started.problem);
    const id = started.job.id;
    await engine.tickReplication(owner, id); // open
    // The owner's request arrives while a tick holds the job.
    const row = await store.lockRow(id);
    expect(row).not.toBeNull();
    const asked = await engine.abortReplication(owner, id);
    expect(asked!.abortRequested).toBe(true);
    expect(asked!.status).toBe("running");
    await store.unlockRow(id);
    // The next tick sees the request and ends the job.
    const job = (await engine.tickReplication(owner, id))!;
    expect(job.status).toBe("aborted");
  });

  it("fails with a reason when the page cannot be opened, and keeps the store free", async () => {
    vi.resetModules();
    const started = await engine.startReplication(owner, "https://source.test/", 1, true);
    if (!started.ok) throw new Error(started.problem);
    await db().execute(sql`update commerce.page_replications set phase = 'build' where id = ${started.job.id}::uuid`);
    // Nothing was captured, so the build step cannot go on.
    const job = (await engine.tickReplication(owner, started.job.id))!;
    expect(job.status).toBe("failed");
    expect(job.summary!.problems[0]).toMatch(/lost|Start again/);
    expect((await engine.startReplication(owner, "https://source.test/", 1, true)).ok).toBe(true);
  });

  it("does not let one store read or stop another's job", async () => {
    const started = await engine.startReplication(owner, "https://source.test/", 1, true);
    if (!started.ok) throw new Error(started.problem);
    const other = { ...owner, storeId: randomUUID() };
    expect(await engine.replicationStatus(other, started.job.id)).toBeNull();
    expect(await engine.tickReplication(other, started.job.id)).toBeNull();
    expect(await engine.abortReplication(other, started.job.id)).toBeNull();
  });
});

describe("the jobs in the database", () => {
  it("keeps the last four hundred log lines, and forgets jobs after thirty days", async () => {
    const started = await engine.startReplication(owner, "https://source.test/", 1, true);
    if (!started.ok) throw new Error(started.problem);
    for (let i = 0; i < 405; i += 1) await store.log(started.job.id, "open", "info", `line ${i}`);
    const row = (await store.getRow(started.job.id, storeId))!;
    expect(row.log).toHaveLength(400);
    expect(row.log[row.log.length - 1].text).toBe("line 404");
    await db().execute(sql`update commerce.page_replications set status = 'done', created_at = now() - interval '31 days' where id = ${started.job.id}::uuid`);
    expect((await store.pruneReplications()).jobs).toBeGreaterThanOrEqual(1);
    expect(await store.getRow(started.job.id, storeId)).toBeNull();
  });

  it("lets only one tick work on a job at a time", async () => {
    const started = await engine.startReplication(owner, "https://source.test/", 1, true);
    if (!started.ok) throw new Error(started.problem);
    const first = await store.lockRow(started.job.id);
    expect(first).not.toBeNull();
    expect(await store.lockRow(started.job.id)).toBeNull();
    await store.unlockRow(started.job.id);
    expect(await store.lockRow(started.job.id)).not.toBeNull();
  });

  it("replaces a job whose page was closed hours ago, so a store is never blocked for ever", async () => {
    const started = await engine.startReplication(owner, "https://source.test/", 1, true);
    if (!started.ok) throw new Error(started.problem);
    expect((await engine.startReplication(owner, "https://source.test/", 1, true)).ok).toBe(false);
    await db().execute(sql`update commerce.page_replications set heartbeat_at = now() - interval '3 hours' where id = ${started.job.id}::uuid`);
    expect((await engine.startReplication(owner, "https://source.test/", 1, true)).ok).toBe(true);
    expect((await store.getRow(started.job.id, storeId))!.status).toBe("failed");
  });
});
