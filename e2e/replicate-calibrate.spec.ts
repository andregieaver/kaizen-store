import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { newPageContent, pageInput } from "../src/lib/page-content";
import { buildReplica } from "../src/lib/replicate-build";
import { calibrate } from "../src/lib/replicate-calibrate";
import { compareRasters } from "../src/lib/replicate-diff";
import type { PageCapture } from "../src/lib/replicate-capture";
import { openCopy } from "../src/lib/replicate-open";
import { renderStyles } from "../src/lib/replicate-styles";
import { signFrame } from "../src/lib/replicate-token";

import { testDb } from "./db";

/**
 * The match with the original, with grids and as columns (D155, C3): for each page `scripts/replicate-calibrate.ts` captured (a directory
 * per page under `REPLICATE_CALIB_DIR`, with both captures and both photographs, so no site is opened again), the page is built twice with
 * `buildReplica()`, once as the replicator builds it and once with every grid group rebuilt as columns, each saved as a draft, opened through the
 * app's preview page at both widths, measured against the original's photograph (`compareRasters()`, as the replicator scores a pass) and
 * calibrated for `REPLICATE_CALIB_PASSES` passes (default 2) like the replicator's refine step. Pictures are the ones the script kept
 * (`--pictures`, `--publish`); without them both builds are measured without pictures, which distorts layouts that rely on them. Written to `results-diff.json` and
 * `results-diff.md` in the directory. Skipped unless the directory is given; run by hand, never in CI.
 */

const dir = process.env.REPLICATE_CALIB_DIR;
const passes = Number(process.env.REPLICATE_CALIB_PASSES ?? 2);

async function raster(png: Buffer, width: number) {
  const meta = await sharp(png).metadata();
  const { data, info } = await sharp(png).resize({ width }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { raster: { width: info.width, height: info.height, data }, scale: (meta.width ?? width) / info.width };
}

type Variant = { match: number; mobile: number | null; first: number; blocks: number; rows: number; css: number };

test("calibration: the match of a copy with grids against the same copy as columns", async ({ browser, baseURL }) => {
  test.skip(!dir, "Set REPLICATE_CALIB_DIR to a directory made by scripts/replicate-calibrate.ts.");
  test.setTimeout(3_600_000);
  const only = process.env.REPLICATE_CALIB_ONLY?.split(",").filter(Boolean);
  const sites = fs
    .readdirSync(dir!)
    .filter((name) => fs.existsSync(path.join(dir!, name, "capture-desktop.json")) && (!only || only.includes(name)))
    .sort();
  const key = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, "base64");
  const sql = testDb();
  const slug = `calib-${Date.now().toString(36)}`;
  const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Calibrate') returning id`;
  const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Calibrate', null) as id`;
  const storeId = id as string;
  const results: Record<string, { grids: number; items: number; asGrid: Variant; asColumns: Variant } | { skipped: string }> = {};

  try {
    for (const site of sites) {
      const base = path.join(dir!, site);
      const desktop = JSON.parse(fs.readFileSync(path.join(base, "capture-desktop.json"), "utf8")) as PageCapture;
      const mobile = fs.existsSync(path.join(base, "capture-mobile.json")) ? (JSON.parse(fs.readFileSync(path.join(base, "capture-mobile.json"), "utf8")) as PageCapture) : null;
      const shotD = fs.readFileSync(path.join(base, "original-desktop.png"));
      const shotM = mobile && fs.existsSync(path.join(base, "original-mobile.png")) ? fs.readFileSync(path.join(base, "original-mobile.png")) : null;
      // The page's pictures as kept by the script (`--pictures`), served from `public/calibrate-tmp/` (`--publish`), as paths on the site.
      const kept = fs.existsSync(path.join(base, "pictures.json")) ? (JSON.parse(fs.readFileSync(path.join(base, "pictures.json"), "utf8")) as Record<string, { file: string; width: number; height: number }>) : {};
      const input = {
        desktop,
        mobile,
        picture: (url: string) => (kept[url] ? { url: `/calibrate-tmp/${site}/${kept[url].file}`, width: kept[url].width, height: kept[url].height } : null),
        shot: () => null,
        video: () => null,
        font: () => null,
      };
      const probe = buildReplica(input, randomUUID);
      if (probe.grids.built.length === 0) {
        results[site] = { skipped: "no grid built" };
        continue;
      }
      const reverted = probe.grids.built.map((g) => ({ path: g.path, match: 0, pass: 0 }));

      const measure = async (label: string, built: ReturnType<typeof buildReplica>): Promise<Variant> => {
        // A grid's items take only a path on the site (the build leaves any other address out), picture blocks and backgrounds only a whole address:
        // the build is given paths, and the whole address is put on wherever it is not an item's.
        const whole = (value: unknown, inItems = false): void => {
          if (!value || typeof value !== "object") return;
          if (Array.isArray(value)) return value.forEach((v) => whole(v, inItems));
          const o = value as Record<string, unknown>;
          for (const [k, v] of Object.entries(o)) {
            if (k === "url" && typeof v === "string" && v.startsWith("/calibrate-tmp/") && !inItems) o[k] = `${baseURL}${v}`;
            else whole(v, inItems || k === "items");
          }
        };
        whole(built.rows);
        let model = built.model;
        const content = { ...newPageContent(), title: "Calibrate", slug: "calibrate", rows: built.rows, css: renderStyles(model, built.shared).css };
        const parsed = pageInput.safeParse(content);
        expect(parsed.success, parsed.success ? "" : `${site}/${label}: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`).toBe(true);
        const jobId = randomUUID();
        const [page] = await sql`insert into commerce.pages (store_id, slug, draft) values (${storeId}, ${`${site}-${label}`}, ${sql.json(content as never)}) returning id`;
        await sql`insert into commerce.page_replications (id, store_id, url, status, page_id, work) values (${jobId}, ${storeId}, ${desktop.url}, 'running', ${page.id}, ${sql.json({ background: "#ffffff" } as never)})`;
        const frame = `${baseURL}/admin/account/replica/${jobId}?t=${encodeURIComponent(signFrame(key, jobId))}`;
        let first = 0;
        let last = { d: 0, m: null as number | null };
        for (let pass = 0; pass <= passes; pass++) {
          const copy = await openCopy(browser, frame, "desktop");
          const phone = mobile ? await openCopy(browser, frame, "mobile").catch(() => null) : null;
          const [a, b] = [await raster(shotD, 360), await raster(copy.screenshot, 360)];
          const d = compareRasters(a.raster, b.raster, a.scale).match;
          let m: number | null = null;
          if (shotM && phone) {
            const [x, y] = [await raster(shotM, 130), await raster(phone.screenshot, 130)];
            m = compareRasters(x.raster, y.raster, x.scale).match;
          }
          if (pass === passes) {
            fs.writeFileSync(path.join(base, `copy-desktop-${label}.png`), copy.screenshot);
            if (phone) fs.writeFileSync(path.join(base, `copy-mobile-${label}.png`), phone.screenshot);
          }
          if (pass === 0) first = d;
          last = { d, m };
          if (pass === passes) break;
          calibrate(model, built.parts, copy.capture, false);
          if (phone) calibrate(model, built.parts, phone.capture, true);
          const css = renderStyles(model, built.shared).css;
          await sql`update commerce.pages set draft = jsonb_set(draft, '{css}', to_jsonb(${css}::text)) where id = ${page.id}`;
          model = { rules: model.rules };
        }
        await sql`delete from commerce.page_replications where id = ${jobId}`;
        return { match: last.d, mobile: last.m, first, blocks: built.counts.blocks, rows: built.counts.rows, css: renderStyles(model, built.shared).css.length };
      };

      try {
        const asGrid = await measure("grid", buildReplica(input, randomUUID));
        const asColumns = await measure("columns", buildReplica({ ...input, reverted }, randomUUID));
        results[site] = { grids: probe.grids.built.length, items: probe.grids.built.reduce((n, g) => n + g.items, 0), asGrid, asColumns };
        console.log(`[calibrate] ${site}: grid ${asGrid.first}% → ${asGrid.match}% (phone ${asGrid.mobile ?? "-"}), columns ${asColumns.first}% → ${asColumns.match}% (phone ${asColumns.mobile ?? "-"}); blocks ${asGrid.blocks} / ${asColumns.blocks}`);
      } catch (error) {
        results[site] = { skipped: error instanceof Error ? error.message.slice(0, 200) : String(error) };
        console.log(`[calibrate] ${site}: FAILED ${results[site] && (results[site] as { skipped: string }).skipped}`);
      }
    }
  } finally {
    await sql`delete from commerce.pages where store_id = ${storeId}`;
    await sql.end();
  }

  fs.writeFileSync(path.join(dir!, "results-diff.json"), JSON.stringify(results, null, 1));
  const lines = ["| Page | Grids | Items | Grid: first → last (phone) | Columns: first → last (phone) | Blocks grid / columns | CSS grid / columns |", "|---|---|---|---|---|---|---|"];
  for (const [site, r] of Object.entries(results)) {
    if ("skipped" in r) lines.push(`| ${site} | ${r.skipped} | | | | | |`);
    else lines.push(`| ${site} | ${r.grids} | ${r.items} | ${r.asGrid.first}% → ${r.asGrid.match}% (${r.asGrid.mobile ?? "-"}%) | ${r.asColumns.first}% → ${r.asColumns.match}% (${r.asColumns.mobile ?? "-"}%) | ${r.asGrid.blocks} / ${r.asColumns.blocks} | ${r.asGrid.css} / ${r.asColumns.css} |`);
  }
  fs.writeFileSync(path.join(dir!, "results-diff.md"), lines.join("\n") + "\n");
});
