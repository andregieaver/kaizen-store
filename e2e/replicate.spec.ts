import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import sharp from "sharp";

import { buildReplica } from "../src/lib/replicate-build";
import { calibrate } from "../src/lib/replicate-calibrate";
import { compareRasters } from "../src/lib/replicate-diff";
import { openCopy, openOriginal } from "../src/lib/replicate-open";
import { renderStyles } from "../src/lib/replicate-styles";
import { signFrame } from "../src/lib/replicate-token";
import { newPageContent, pageInput } from "../src/lib/page-content";

import { testDb } from "./db";

/**
 * Copying another website's page (D150), as far as a browser can show it: a page is opened at both widths, its boxes read,
 * a page built from them and saved as a draft, the draft opened through its token-guarded preview page, and the copy
 * measured against the original and set right by measuring. What needs a signed-in owner (the studio's panel, the AI) is
 * tested on the server; this proves the part that is about what a page looks like.
 */

const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "replica-source.html"), "utf8");
const demo = (name: string) => fs.readFileSync(path.join(__dirname, "..", "public", "demo", name));

/** Pixels of a screenshot as a small raster, to score it. */
async function raster(png: Buffer, width: number) {
  const meta = await sharp(png).metadata();
  const { data, info } = await sharp(png).resize({ width }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { raster: { width: info.width, height: info.height, data }, scale: (meta.width ?? width) / info.width };
}

test("a copy built from a page's measurements looks like the page, and measuring closes the gap", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);

  // The original: a small shop's landing page, its pictures from files the copy can also use.
  const server = http.createServer((request, response) => {
    if (request.url === "/hero.png") {
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end(demo("cabin.svg"));
    } else if (request.url === "/roastery.png") {
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end(demo("lamp.svg"));
    } else {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(fixture);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const original = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const everything = async () => true;

  try {
    const [desktop, mobile] = [await openOriginal(browser, original, "desktop", everything), await openOriginal(browser, original, "mobile", everything)];
    expect(desktop.capture.title).toBe("Northwind Coffee Roasters");
    // The cookie banner floats over the page: left out of both the photograph and the capture.
    expect(desktop.capture.left.fixed).toEqual(["div.cookie"]);
    expect(desktop.capture.docHeight).toBeGreaterThan(2000);
    expect(desktop.elements.size).toBeGreaterThanOrEqual(3);

    // Build the copy: pictures are the same files, kept under the site's own address; icons are photographs.
    const own = (url: string) => (url.endsWith("hero.png") ? { url: `${baseURL}/demo/cabin.svg`, width: 800, height: 600 } : url.endsWith("roastery.png") ? { url: `${baseURL}/demo/lamp.svg`, width: 800, height: 600 } : null);
    // The icons are the site's own files by their path: a grid of custom items (D155) takes only the library's or the site's own pictures.
    const shots = new Map([...desktop.elements.keys()].map((key, i) => [key, { url: `/demo/${["bike", "mug", "notebook-open"][i % 3]}.svg`, width: 44, height: 44 }]));
    const built = buildReplica(
      { desktop: desktop.capture, mobile: mobile.capture, picture: own, shot: (key) => shots.get(key) ?? null, video: () => null, font: () => null },
      randomUUID,
    );
    expect(built.rows.length).toBeGreaterThanOrEqual(8);
    expect(built.counts.headings).toBeGreaterThanOrEqual(7);
    // The nav, the hero's two buttons and the footer are made of what the builder has.
    expect(built.rows[0].columns.some((column) => column.inline)).toBe(true);

    // A store, a draft of the page, and a job whose token opens it.
    const sql = testDb();
    const jobId = randomUUID();
    const background = "#fbf7f2";
    let pageId = "";
    let storeId = "";
    try {
      const slug = `rep-${Date.now().toString(36)}`;
      const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Testbutikk') returning id`;
      const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Testbutikk', null) as id`;
      storeId = id as string;
      let model = built.model;
      const content = { ...newPageContent(), title: built.title, slug: "kopi", rows: built.rows, css: renderStyles(model, built.shared).css };
      fs.mkdirSync("test-results", { recursive: true });
      fs.writeFileSync("test-results/replicate.css", content.css);
      fs.writeFileSync("test-results/replicate-rows.json", JSON.stringify(built.rows, null, 1));
      const parsed = pageInput.safeParse(content);
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
      const [page] = await sql`insert into commerce.pages (store_id, slug, draft) values (${storeId}, 'kopi', ${sql.json(content as never)}) returning id`;
      pageId = page.id as string;
      await sql`
        insert into commerce.page_replications (id, store_id, url, status, page_id, work)
        values (${jobId}, ${storeId}, ${original}, 'running', ${pageId}, ${sql.json({ background } as never)})`;

      const key = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, "base64");
      const frame = `${baseURL}/admin/account/replica/${jobId}?t=${encodeURIComponent(signFrame(key, jobId))}`;

      // Nothing opens without the token, or with another job's: the page is streamed, so it is the content that is refused.
      const denied = await browser.newPage();
      for (const query of ["", `?t=${encodeURIComponent(signFrame(key, randomUUID()))}`, "?t=1.forged"]) {
        await denied.goto(`${baseURL}/admin/account/replica/${jobId}${query}`);
        await expect(denied.locator("[data-replica-frame]")).toHaveCount(0);
        expect(await denied.content()).not.toContain("Northwind");
      }
      await denied.close();

      // Measure the copy as it is, set the spacing right, and measure again.
      const scores: number[] = [];
      for (let pass = 0; pass < 3; pass++) {
        const copy = await openCopy(browser, frame, "desktop");
        const phone = await openCopy(browser, frame, "mobile");
        const [a, b] = [await raster(desktop.screenshot, 360), await raster(copy.screenshot, 360)];
        const score = compareRasters(a.raster, b.raster, a.scale);
        scores.push(score.match);
        // For whoever is looking at why a copy differs: the photographs, the weakest places and the differences.
        fs.mkdirSync("test-results", { recursive: true });
        fs.writeFileSync(`test-results/replicate-copy-${pass}.png`, copy.screenshot);
        if (pass === 0) fs.writeFileSync("test-results/replicate-original.png", desktop.screenshot);
        if (pass === 2) {
          const boxes = new Map<string, number[]>();
          const walkIt = (n: { id?: string; box: number[]; children: unknown[] }) => { if (n.id) boxes.set(n.id, n.box); for (const c of n.children as typeof n[]) walkIt(c); };
          walkIt(copy.capture.root as never);
          const off = built.parts.filter((p) => p.target && boxes.get(p.id)).map((p) => { const b = boxes.get(p.id)!; const t = p.target!; return { id: p.id, label: p.label, kind: p.kind, d: [b[0] - t[0], b[1] - t[1], b[2] - t[2], b[3] - t[3]].map((v) => Math.round(v)) }; }).filter((o) => o.d.some((v) => Math.abs(v) > 3));
          console.log("off:", JSON.stringify(off.slice(0, 40)));
        }
        if (pass === 2) console.log("weakest:", JSON.stringify(score.weakest), "heights", JSON.stringify(score.heights));
        if (pass === 0) {
          // The first copy is already recognisably the page: its structure and its look came from measuring.
          expect(score.match).toBeGreaterThan(75);
          expect(Math.abs(copy.capture.docHeight - desktop.capture.docHeight)).toBeLessThan(desktop.capture.docHeight * 0.05);
        }
        if (pass === 2) break;
        calibrate(model, built.parts, copy.capture, false);
        calibrate(model, built.parts, phone.capture, true);
        const css = renderStyles(model, built.shared).css;
        await sql`update commerce.pages set draft = jsonb_set(draft, '{css}', to_jsonb(${css}::text)) where id = ${pageId}`;
        model = { rules: model.rules };
      }
      console.log("match by pass:", scores.join(" → "));
      // Setting spacing right does not make a copy worse, and brings it close.
      expect(scores[2]).toBeGreaterThanOrEqual(scores[0] - 1);
      expect(scores[2]).toBeGreaterThan(85);

      // At a phone's width too, the copy is about as tall as the original.
      const finalPhone = await openCopy(browser, frame, "mobile");
      expect(Math.abs(finalPhone.capture.docHeight - mobile.capture.docHeight)).toBeLessThan(mobile.capture.docHeight * 0.15);
    } finally {
      await sql`delete from commerce.page_replications where id = ${jobId}`;
      if (storeId) await sql`delete from commerce.pages where store_id = ${storeId}`;
      await sql.end();
    }
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
