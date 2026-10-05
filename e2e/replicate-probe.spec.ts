import { chromium, expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import sharp from "sharp";

import { newPageContent, pageInput } from "../src/lib/page-content";
import { BACKDROP_BELOW, buildFitted, weakRows } from "../src/lib/replicate-backdrop";
import { backdropKey, buildReplica, type BuildInput } from "../src/lib/replicate-build";
import { calibrate } from "../src/lib/replicate-calibrate";
import { compareRasters } from "../src/lib/replicate-diff";
import { openCopy, openOriginal } from "../src/lib/replicate-open";
import { fontFamilies, pictureAddresses } from "../src/lib/replicate-assets-plan";
import { fontCandidates } from "../src/lib/replicate-fonts";
import { createHash } from "node:crypto";
import { buildReport, finalDiffOf, reportMarkdown } from "../src/lib/replicate-report";
import { renderStyles } from "../src/lib/replicate-styles";
import { signFrame } from "../src/lib/replicate-token";

import { testDb } from "./db";

/**
 * A probe for working on the replicator against a real site (D150): `REPLICATE_PROBE_URL=https://example.com/ pnpm test:e2e
 * e2e/replicate-probe.spec.ts` runs the replicator's own pipeline (open at both widths, keep the pictures, build, save the
 * draft, measure and calibrate) without the AI, and writes what it found to `test-results/probe/`: the photographs, the
 * copy after each pass, the scores, and the report as Markdown. Skipped when no address is given.

 */

const target = process.env.REPLICATE_PROBE_URL;
const passes = Number(process.env.REPLICATE_PROBE_PASSES ?? 3);
const out = path.join("test-results", "probe");

async function raster(png: Buffer, width: number) {
  const meta = await sharp(png).metadata();
  const { data, info } = await sharp(png).resize({ width }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { raster: { width: info.width, height: info.height, data }, scale: (meta.width ?? width) / info.width };
}

test("probe: copy a real page and report", async ({ baseURL }) => {
  test.skip(!target, "Set REPLICATE_PROBE_URL to run the probe.");
  test.setTimeout(900_000);
  fs.mkdirSync(out, { recursive: true });
  // A sandbox reaches the internet through a proxy; the copy and the pictures served here are local and bypass it.
  const proxy = process.env.HTTPS_PROXY;
  const browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}),
    // The sandbox's proxy re-signs HTTPS with its own CA, which the browser does not know.
    ...(proxy ? { proxy: { server: proxy, bypass: "localhost,127.0.0.1" }, args: ["--ignore-certificate-errors"] } : {}),
  });
  const everything = async () => true;
  // The media library's origin as the built app knows it (`.env`), and its files as the probe's browser is served them.
  const libraryOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? /^NEXT_PUBLIC_SUPABASE_URL=(\S+)/m.exec(fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "")?.[1] ?? "https://library.example.supabase.co";
  const library = new Map<string, Buffer>();
  const newContext = browser.newContext.bind(browser);
  browser.newContext = (async (...args: Parameters<typeof browser.newContext>) => {
    const context = await newContext(...args);
    await context.route(`${libraryOrigin}/storage/v1/object/public/replica-probe/**`, (route) => {
      const file = library.get(route.request().url().split("/").pop() ?? "");
      return file ? route.fulfill({ status: 200, contentType: "image/png", body: file, headers: { "Access-Control-Allow-Origin": "*" } }) : route.fulfill({ status: 404 });
    });
    // A row kept as a picture is drawn by the page's CSS, which takes only the site's own addresses or the library's; the probe's app does not know the library's origin.
    await context.route("**/__probe/**", (route) => {
      const file = library.get(route.request().url().split("/").pop() ?? "");
      return file ? route.fulfill({ status: 200, contentType: "image/png", body: file }) : route.fulfill({ status: 404 });
    });
    return context;
  }) as typeof browser.newContext;
  const log = (...args: unknown[]) => console.log("[probe]", ...args);

  const desktop = await openOriginal(browser, target!, "desktop", everything);
  log(`desktop: ${desktop.capture.docWidth}×${desktop.capture.docHeight}, ${desktop.elements.size} drawn elements`);
  let mobile = null as Awaited<ReturnType<typeof openOriginal>> | null;
  try {
    mobile = await openOriginal(browser, target!, "mobile", everything);
    log(`phone: ${mobile.capture.docWidth}×${mobile.capture.docHeight}`);
  } catch (error) {
    log("phone FAILED:", error instanceof Error ? error.message : error);
  }
  fs.writeFileSync(path.join(out, "capture-desktop.json"), JSON.stringify(desktop.capture));
  if (mobile) fs.writeFileSync(path.join(out, "capture-mobile.json"), JSON.stringify(mobile.capture));
  fs.writeFileSync(path.join(out, "original-desktop.png"), desktop.screenshot);
  if (mobile) fs.writeFileSync(path.join(out, "original-mobile.png"), mobile.screenshot);

  // The pictures, kept where the copy can reach them.
  const files = new Map<string, { bytes: Buffer; type: string }>();
  const server = http.createServer((request, response) => {
    const file = files.get(request.url ?? "");
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": file.type, "Access-Control-Allow-Origin": "*" }).end(file.bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const assetBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const pictures = new Map<string, { url: string; width: number; height: number } | null>();
  const wanted = pictureAddresses([desktop.capture, mobile?.capture ?? null]);
  let n = 0;
  await Promise.all(
    wanted.urls.map(async (url) => {
      try {
        const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Referer: desktop.capture.url }, signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error(String(response.status));
        const png = await sharp(Buffer.from(await response.arrayBuffer()), { density: 144 }).resize({ width: 2400, withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
        const key = `/a/${++n}.png`;
        files.set(key, { bytes: png.data, type: "image/png" });
        // The app draws a picture only from a site path or its own media library's address (`custom-picture.ts`), never an `http:` address, so the pictures
        // are given the library's address and served to the probe's own browser by `serveLibrary()` below: nothing reaches the real library, and the
        // copy is drawn as the owner sees it, with its pictures.
        const name = `${createHash("sha1").update(url).digest("hex").slice(0, 16)}.png`;
        library.set(name, png.data);
        pictures.set(url, { url: `${libraryOrigin}/storage/v1/object/public/replica-probe/${name}`, width: png.info.width, height: png.info.height });
      } catch (error) {
        pictures.set(url, null);
        log("picture failed:", url.slice(0, 100), error instanceof Error ? error.message : error);
      }
    }),
  );
  const shots = new Map<string, { url: string; width: number; height: number }>();
  for (const [p, png] of desktop.elements) {
    const meta = await sharp(png).metadata();
    const key = `/s/${++n}.png`;
    files.set(key, { bytes: png, type: "image/png" });
    shots.set(p, { url: `${assetBase}${key}`, width: meta.width ?? 1, height: meta.height ?? 1 });
  }
  log(`pictures ${[...pictures.values()].filter(Boolean).length}/${pictures.size}, photographed ${shots.size}`);

  // The typefaces the page uses, installed as the site does (Google Fonts, or the nearest look-alike), so the copy is measured in them.
  const installed = new Map<string, string>();
  {
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "lib", "fonts", "google-fonts.json"), "utf8")) as [string, string, string, string][];
    const db = testDb();
    try {
      for (const family of fontFamilies(desktop.capture).wanted) {
        for (const candidate of fontCandidates(family)) {
          const row = catalog.find((r) => r[0].toLowerCase() === candidate.name.toLowerCase());
          if (!row) continue;
          const name = row[0];
          const slug = name.toLowerCase().replace(/\s+/g, "-");
          const [have] = await db`select 1 from commerce.fonts where family = ${name}`;
          if (!have) {
            const cssResponse = await fetch(`https://fonts.googleapis.com/css2?family=${name.replaceAll(" ", "+")}:wght@400;500;600;700&display=swap`, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" } });
            if (!cssResponse.ok) continue;
            const css = await cssResponse.text();
            let local = "";
            for (const m of css.matchAll(/\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
              if (m[1] !== "latin" && m[1] !== "latin-ext") continue;
              const url = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+\.woff2)\)/.exec(m[2])?.[1];
              if (!url) continue;
              const data = Buffer.from(await (await fetch(url)).arrayBuffer());
              const file = `${createHash("sha256").update(data).digest("hex").slice(0, 32)}.woff2`;
              await db`insert into commerce.font_files (name, data) values (${file}, ${data}) on conflict (name) do nothing`;
              local += `@font-face { ${m[2].replace(url, `/api/fonts/files/${file}`).trim().replace(/\s*\n\s*/g, " ")} }\n`;
            }
            const rule = `${local}.kf-${slug}, .kf-${slug} :where(h1, h2, h3, h4, h5, h6) { font-family: "${name}", ${row[1] === "serif" ? "serif" : "sans-serif"}; font-synthesis-weight: none; }\n`;
            await db`insert into commerce.fonts (family, slug, category, css, bytes) values (${name}, ${slug}, ${row[1]}, ${rule}, 0) on conflict (family) do nothing`;
          }
          installed.set(family, name);
          log(`font ${family} -> ${name} (${candidate.kind})`);
          break;
        }
      }
    } finally {
      await db.end();
    }
  }

  type Pic = { url: string; width: number; height: number };
  let plainRows = new Set<string>();
  const backdrops = new Map<string, { text: { desktop: Pic; phone: Pic | null }; plain: { desktop: Pic; phone: Pic | null } }>();
  const inputOf = (): BuildInput => ({
    desktop: desktop.capture,
    mobile: mobile?.capture ?? null,
    picture: (url) => pictures.get(url) ?? null,
    shot: (p) => shots.get(p) ?? null,
    video: () => null,
    font: (family) => installed.get(family) ?? null,
    backdrop: (p) => backdrops.get(p) ?? null,
    backdropPlain: plainRows,
  });
  let built = buildReplica(inputOf(), randomUUID);
  log(`built ${built.counts.rows} rows, ${built.counts.blocks} blocks; notes:`, built.notes.map((x) => x.text));
  let model = built.model;
  let backdropRound = 0;
  const content = { ...newPageContent(), title: built.title || "Probe", slug: "probe", rows: built.rows, css: renderStyles(model, built.shared).css };
  const parsed = pageInput.safeParse(content);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
  fs.writeFileSync(path.join(out, "rows.json"), JSON.stringify(built.rows, null, 1));
  fs.writeFileSync(path.join(out, "css.css"), content.css);
  fs.writeFileSync(path.join(out, "parts.json"), JSON.stringify(built.parts, null, 1));

  const sql = testDb();
  const jobId = randomUUID();
  let storeId = "";
  let pageId = "";
  try {
    const slug = `probe-${Date.now().toString(36)}`;
    const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Probe') returning id`;
    const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Probe', null) as id`;
    storeId = id as string;
    const [page] = await sql`insert into commerce.pages (store_id, slug, draft) values (${storeId}, 'probe', ${sql.json(content as never)}) returning id`;
    pageId = page.id as string;
    await sql`insert into commerce.page_replications (id, store_id, url, status, page_id, work) values (${jobId}, ${storeId}, ${target!}, 'running', ${pageId}, ${sql.json({ background: "#ffffff" } as never)})`;
    const key = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, "base64");
    const frame = `${baseURL}/admin/account/replica/${jobId}?t=${encodeURIComponent(signFrame(key, jobId))}`;

    const scores: string[] = [];
    let last: { desktop: Awaited<ReturnType<typeof openCopy>>; phone: Awaited<ReturnType<typeof openCopy>> | null } | null = null;
    const passList: { iteration: number; desktop: ReturnType<typeof compareRasters>; mobile: ReturnType<typeof compareRasters> | null; changes: string[] }[] = [];
    let lastRasters: { d: Awaited<ReturnType<typeof raster>>; dc: Awaited<ReturnType<typeof raster>>; m: Awaited<ReturnType<typeof raster>> | null; mc: Awaited<ReturnType<typeof raster>> | null } | null = null;
    for (let pass = 0; pass <= passes; pass++) {
      const copy = await openCopy(browser, frame, "desktop");
      const phone = mobile ? await openCopy(browser, frame, "mobile").catch(() => null) : null;
      fs.writeFileSync(path.join(out, `copy-desktop-${pass}.png`), copy.screenshot);
      fs.writeFileSync(path.join(out, `copy-capture-desktop-${pass}.json`), JSON.stringify(copy.capture));
      if (phone) fs.writeFileSync(path.join(out, `copy-capture-mobile-${pass}.json`), JSON.stringify(phone.capture));
      if (phone) fs.writeFileSync(path.join(out, `copy-mobile-${pass}.png`), phone.screenshot);
      const [a, b] = [await raster(desktop.screenshot, 360), await raster(copy.screenshot, 360)];
      const desktopScore = compareRasters(a.raster, b.raster, a.scale);
      let mobileScore = null;
      let m = null;
      let mc = null;
      if (mobile && phone) {
        [m, mc] = [await raster(mobile.screenshot, 130), await raster(phone.screenshot, 130)];
        mobileScore = compareRasters(m.raster, mc.raster, m.scale);
      }
      scores.push(`${desktopScore.match}${mobileScore ? `/${mobileScore.match}` : ""}`);
      passList.push({ iteration: pass, desktop: desktopScore, mobile: mobileScore, changes: [] });
      last = { desktop: copy, phone };
      lastRasters = { d: a, dc: b, m, mc };
      log(`pass ${pass}: ${desktopScore.match}% desktop${mobileScore ? `, ${mobileScore.match}% phone` : ""}; heights ${JSON.stringify(desktopScore.heights)}`);
      if (pass === passes) break;
      // Rows that still match badly are kept as a picture of the original with its words over it (D164), as the job does.
      const below = backdropRound === 0 && pass >= 1 ? (passes >= 3 ? BACKDROP_BELOW.first : BACKDROP_BELOW.last) : backdropRound === 1 && passes >= 3 && pass >= Math.max(2, passes - 1) ? BACKDROP_BELOW.last : null;
      if (below !== null) {
        backdropRound += 1;
        const found = weakRows(built.parts, { original: a.raster, copy: b.raster, scale: a.scale }, m && mc ? { original: m.raster, copy: mc.raster, scale: m.scale } : null, copy.capture, phone ? phone.capture : null, below).filter(({ part }) => !backdrops.has(backdropKey(part.path, part.target![1])));
        const cutFrom = async (bare: Buffer, width: number, box: [number, number, number, number]) => {
          const meta = await sharp(bare).metadata();
          const top = Math.max(0, Math.round(box[1]));
          const png = await sharp(bare).extract({ left: 0, top, width: Math.min(meta.width ?? 1, Math.round(width)), height: Math.min(Math.round(box[3]), (meta.height ?? 1) - top) }).png().toBuffer({ resolveWithObject: true });
          const name = `${createHash("sha1").update(png.data).digest("hex").slice(0, 16)}.png`;
          library.set(name, png.data);
          return { url: `/__probe/${name}`, width: png.info.width, height: png.info.height };
        };
        for (const { part, desktop: dm, phone: pm } of found) {
          if (!desktop.textless || (mobile && !mobile.textless)) break;
          const key = backdropKey(part.path, part.target![1]);
          backdrops.set(key, {
            text: { desktop: await cutFrom(desktop.textless, desktop.capture.docWidth, part.target!), phone: mobile && part.targetM ? await cutFrom(mobile.textless!, mobile.capture.docWidth, part.targetM) : null },
            plain: { desktop: await cutFrom(desktop.screenshot, desktop.capture.docWidth, part.target!), phone: mobile && part.targetM ? await cutFrom(mobile.screenshot, mobile.capture.docWidth, part.targetM) : null },
          });
          log(`row at ${Math.round(part.target![1])}px kept as a picture (${dm}% / ${pm}%)`);
        }
        if (found.length > 0) {
          const fitted = buildFitted(inputOf(), randomUUID);
          built = fitted.built;
          model = built.model;
          const styledNow = fitted.styled;
          plainRows = new Set(fitted.plain);
          log(`rows only as a picture: ${fitted.plain.length}`);
          const css = styledNow.css;
          log(`style after backdrops: ${css.length} characters${styledNow.trimmed ? `, trimmed: ${styledNow.trimmed}` : ""}`);
          await sql`update commerce.pages set draft = ${sql.json({ ...content, rows: built.rows, css } as never)} where id = ${pageId}`;
          fs.writeFileSync(path.join(out, "parts.json"), JSON.stringify(built.parts, null, 1));
          fs.writeFileSync(path.join(out, "rows.json"), JSON.stringify(built.rows, null, 1));
          const [back] = await sql`select draft from commerce.pages where id = ${pageId}`;
          const check = pageInput.safeParse(back.draft);
          log("draft after backdrops:", check.success ? "valid" : JSON.stringify(check.error.issues.slice(0, 4)), typeof (back.draft as { rows?: unknown }).rows);
          // The page is measured again at this same pass, as the job does, before it is corrected by measuring.
          scores.pop();
          passList.pop();
          pass -= 1;
          continue;
        }
      }
      calibrate(model, built.parts, copy.capture, false);
      if (phone) calibrate(model, built.parts, phone.capture, true);
      const styledPass = renderStyles(model, built.shared);
      const css = styledPass.css;
      if (styledPass.trimmed) log(`style trimmed after pass ${pass}: ${styledPass.trimmed} (${css.length})`);
      await sql`update commerce.pages set draft = jsonb_set(draft, '{css}', to_jsonb(${css}::text)) where id = ${pageId}`;
      model = { rules: model.rules };
    }
    log("match by pass:", scores.join(" → "));

    const finalDiff = last && lastRasters
      ? finalDiffOf(
          built.parts,
          { original: lastRasters.d.raster, copy: lastRasters.dc.raster, scale: lastRasters.d.scale, capture: last.desktop.capture },
          last.phone && lastRasters.m && lastRasters.mc ? { original: lastRasters.m.raster, copy: lastRasters.mc.raster, scale: lastRasters.m.scale, capture: last.phone.capture } : null,
        )
      : null;
    const report = buildReport({
      now: new Date().toISOString(),
      url: target!,
      outcome: "done",
      problem: null,
      iterationsAsked: passes,
      stoppedEarly: false,
      vision: { used: false, why: "The probe runs without the AI." },
      desktop: desktop.capture,
      mobile: mobile?.capture ?? null,
      parts: built.parts,
      counts: built.counts,
      words: 0,
      notes: built.notes,
      dropped: built.dropped,
      passes: passList,
      finalDiff,
      assets: { pictures: Object.fromEntries(pictures), videos: {}, shots: Object.fromEntries(shots), fonts: Object.fromEntries([...installed]), failures: {} },
      analysis: null,
      cssLength: renderStyles(model, built.shared).css.length,
      cssTrimmed: null,
      log: [],
    });
    fs.writeFileSync(path.join(out, "report.md"), reportMarkdown(report));
    fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 1));
    log(`report written to ${out}/report.md (${report.findings.length} findings)`);
  } finally {
    await sql`delete from commerce.page_replications where id = ${jobId}`;
    if (storeId) await sql`delete from commerce.pages where store_id = ${storeId}`;
    await sql.end();
    server.closeAllConnections();
    server.close();
    await browser.close();
  }
});
