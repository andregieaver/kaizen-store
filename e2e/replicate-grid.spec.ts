import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import sharp from "sharp";

import { newPageContent, pageInput, type ContentGridBlock, type PageBlock } from "../src/lib/page-content";
import { buildReplica } from "../src/lib/replicate-build";
import { compareRasters } from "../src/lib/replicate-diff";
import { walk } from "../src/lib/replicate-capture";
import { weakGrids } from "../src/lib/replicate-grid";
import { openCopy, openOriginal } from "../src/lib/replicate-open";
import { WATCH } from "../src/lib/replicate-watch";
import { renderStyles } from "../src/lib/replicate-styles";
import { signFrame } from "../src/lib/replicate-token";

import { testDb } from "./db";
import { columnsView } from "../src/lib/responsive";

/** A grid's columns by screen, as the builder shows them (D179: computers' at Extra large, the smaller sizes' overrides). */
const screens = (grid: { columns: number; at?: ContentGridBlock["at"] }) => columnsView(grid, { mobile: 0, tablet: 0, desktop: 0 });

/**
 * Repeated cards copied end to end as grids of custom items (D155, C): a local page with a grid of four cards, a native scroller of six
 * with arrows and dots, a script slider written after Swiper's markup (copies made to loop, a transform, arrows, bullets, autoplay every
 * three seconds), and a group whose cards each hold two buttons (links in one line). The page is opened in a browser at both widths, built, saved as a
 * draft and opened through its preview page. The grids are real grid blocks with the right number of items, the scroller and the slider are carousels
 * with arrows and dots (the slider one that goes round and plays by itself, its copies not items), the group with two buttons stays columns, and
 * every word of the original is in the copy. The time the watch for autoplay takes is bounded.
 */

const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "replica-grid.html"), "utf8");
const demo = (name: string) => fs.readFileSync(path.join(__dirname, "..", "public", "demo", name));
const PICTURES: Record<string, string> = { "/img/a.svg": "mug.svg", "/img/b.svg": "lamp.svg", "/img/c.svg": "notebook.svg", "/img/d.svg": "tote.svg" };

async function raster(png: Buffer, width: number) {
  const meta = await sharp(png).metadata();
  const { data, info } = await sharp(png).resize({ width }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { raster: { width: info.width, height: info.height, data }, scale: (meta.width ?? width) / info.width };
}

test("repeated cards become grids of custom items that look like the original, with every word", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  process.env.REPLICATE_ALLOW_PRIVATE = "1";

  const server = http.createServer((request, response) => {
    const picture = PICTURES[request.url ?? ""];
    if (picture) {
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end(demo(picture));
    } else {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(fixture);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const original = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const everything = async () => true;

  try {
    // Opened twice at computers' width: without the watch for autoplay, then with it; what the watch costs is bounded.
    const before = Date.now();
    const quick = await openOriginal(browser, original, "desktop", everything, undefined, { watch: false });
    const quickMs = Date.now() - before;
    const watchedFrom = Date.now();
    const desktop = await openOriginal(browser, original, "desktop", everything);
    const watchedMs = Date.now() - watchedFrom;
    const mobile = await openOriginal(browser, original, "mobile", everything);
    expect(desktop.capture.title).toBe("Fjordbutikken");
    console.log("open without the watch", quickMs, "ms; with it", watchedMs, "ms");
    expect(watchedMs - quickMs).toBeLessThan(WATCH.totalMs + 5000);
    expect([...walk(quick.capture.root)].some((n) => n.watch)).toBe(false);

    // What the browser read of the script slider: its track, the copies made to loop (marked, and kept in the capture), what was watched.
    const tracks = [...walk(desktop.capture.root)].filter((n) => n.slider);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].slider).toMatchObject({ kind: "transform", hints: expect.arrayContaining(["swiper-wrapper"]) });
    expect(tracks[0].slider!.arrows.map((a) => a.dir).sort()).toEqual(["next", "prev"]);
    expect(tracks[0].slider!.dots).toMatchObject({ count: 5, role: "named" });
    expect(tracks[0].children).toHaveLength(11);
    expect(tracks[0].children.filter((c) => c.slide?.clone === "swiper-slide-duplicate")).toHaveLength(6);
    expect(tracks[0].children.filter((c) => c.slide?.hide)).not.toHaveLength(0);
    expect(tracks[0].watch).toMatchObject({ observed: true });
    const watchedSeconds = tracks[0].watch?.observed ? tracks[0].watch.seconds : 0;
    expect(watchedSeconds).toBeGreaterThanOrEqual(3);
    expect(watchedSeconds).toBeLessThanOrEqual(4);
    // The plain scroller was watched too, and did not move; the phone's look is not watched.
    const scrollers = [...walk(desktop.capture.root)].filter((n) => n.scroll && !n.slider);
    expect(scrollers).toHaveLength(1);
    expect(scrollers[0].watch).toMatchObject({ observed: false });
    expect([...walk(mobile.capture.root)].some((n) => n.watch)).toBe(false);

    // The pictures are the site's own files (a custom item may only use the library's or the site's own pictures).
    const own = (url: string) => {
      const name = PICTURES[new URL(url).pathname];
      return name ? { url: `/demo/${name}`, width: 800, height: 600 } : null;
    };
    const built = buildReplica({ desktop: desktop.capture, mobile: mobile.capture, picture: own, shot: () => null, video: () => null, font: () => null }, randomUUID);

    // Three grids built, one group kept as columns for its second buttons, nothing else mistaken for cards.
    const blocks: PageBlock[] = built.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));
    const grids = blocks.filter((b): b is ContentGridBlock => b.type === "contentGrid");
    expect(grids).toHaveLength(3);
    expect(built.grids.built.map((g) => g.items)).toEqual([4, 6, 5]);
    expect(built.grids.kept).toHaveLength(1);
    // Each card holds two buttons, and an item holds one, so the group stays as columns, which keep both.
    expect(built.grids.kept[0].reason).toBe("3 of 3 cards hold a second button");

    const [statics, carousel, slider] = grids;
    expect(statics.display).toBeUndefined();
    expect(screens(statics).desktop).toBe(4);
    expect(screens(statics).mobile).toBe(1);
    expect(statics.items!.map((i) => i.title)).toEqual(["Håndlaget krus", "Lampe i eik", "Notatbok", "Bærepose"]);
    expect(statics.items![1]).toMatchObject({ text: "Varmt lys til stuen din.", priceText: "1 290 kr", buttonLabel: "Les mer", picture: { alt: "Lampe" } });
    expect(statics.items![1].link).toMatchObject({ kind: "url" });

    // The scroller is a carousel with the arrows and dots it had, three tiles in view; its snapping is the default (start).
    expect(carousel.display).toBe("carousel");
    expect(carousel.items!.map((i) => i.title)).toEqual(["Sykkel", "Kopp", "Bok", "Hytte", "Tre", "Garn"]);
    expect(screens(carousel).desktop).toBe(3);
    expect(carousel.carousel).toEqual({ dots: true });
    expect(built.grids.built[1].carousel).toMatchObject({ arrows: true, dots: true, snap: "start", autoplay: "not observed" });
    expect(built.grids.built[1].carousel!.watched).toMatchObject({ moves: 0 });

    // The script slider: its five real slides, the six copies it made to loop not among them; a carousel that goes round, has its arrows and dots,
    // three in view on computers and one on phones, and plays by itself as often as it was seen to.
    expect(slider.items!.map((i) => i.title)).toEqual(["Ullsokker", "Skissebok", "Dagstursekk", "Termos", "Lykt"]);
    expect(slider.items![3]).toMatchObject({ text: "Holder kaffen varm i åtte timer.", buttonLabel: "Se termos", picture: { alt: "Termos" } });
    expect(slider.items![3].link).toMatchObject({ kind: "url" });
    expect(slider.display).toBe("carousel");
    expect(screens(slider).desktop).toBe(3);
    expect(screens(slider).mobile).toBe(1);
    expect(slider.carousel).toEqual({ dots: true, rewind: true, autoplay: { seconds: watchedSeconds } });
    expect(built.grids.built[2].carousel).toMatchObject({ arrows: true, dots: true, rewind: true, perScreen: { desktop: 3, phone: 1 }, clones: 6, script: { kind: "transform", clonesBy: { markers: 6, keys: 0, hashes: 0 } } });
    expect(built.grids.built[2].carousel!.autoplay).toBe(`observed, ${watchedSeconds} s`);

    // The third group is columns, as before, with every word (and both links) of its cards.
    expect(built.rows.some((row) => row.columns.length === 3)).toBe(true);
    expect(JSON.stringify(built.rows)).toContain("Kjøp nå");
    // Far fewer blocks than every picture, heading, text and button of 13 cards would take (some 55); the group kept as columns is most of them.
    expect(built.counts.blocks).toBeLessThan(25);

    // A store, a draft of the page, and a job whose token opens it.
    const sql = testDb();
    const jobId = randomUUID();
    let storeId = "";
    try {
      const slug = `repg-${Date.now().toString(36)}`;
      const [request] = await sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Testbutikk') returning id`;
      const [{ id }] = await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Testbutikk', null) as id`;
      storeId = id as string;
      const content = { ...newPageContent(), title: built.title, slug: "kopi", rows: built.rows, css: renderStyles(built.model, built.shared).css };
      fs.mkdirSync("test-results", { recursive: true });
      fs.writeFileSync("test-results/replicate-grid.css", content.css);
      fs.writeFileSync("test-results/replicate-grid-rows.json", JSON.stringify(built.rows, null, 1));
      const parsed = pageInput.safeParse(content);
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
      const [page] = await sql`insert into commerce.pages (store_id, slug, draft) values (${storeId}, 'kopi', ${sql.json(content as never)}) returning id`;
      await sql`insert into commerce.page_replications (id, store_id, url, status, page_id, work) values (${jobId}, ${storeId}, ${original}, 'running', ${page.id}, ${sql.json({ background: "#f6f7f9" } as never)})`;
      const key = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, "base64");
      const frame = `${baseURL}/admin/account/replica/${jobId}?t=${encodeURIComponent(signFrame(key, jobId))}`;

      // The copy as a browser draws it: fifteen items, two carousels with their arrows and dots, and the words of every card.
      const look = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await look.goto(frame);
      await look.waitForSelector("[data-item-id]");
      await expect(look.locator("[data-item-id]")).toHaveCount(15);
      await expect(look.locator("[data-carousel-track]")).toHaveCount(2);
      console.log("track metrics", JSON.stringify(await look.locator("[data-carousel-track]").evaluateAll((els) => els.map((el) => ({ client: el.clientWidth, scroll: el.scrollWidth, tiles: Array.from(el.children).map((c) => Math.round(c.getBoundingClientRect().width)) })))));
      console.log("dots by carousel", JSON.stringify(await look.locator("[role='group'][aria-roledescription]").evaluateAll((els) => els.map((el) => el.querySelectorAll("[data-carousel-dot]").length))));
      await expect(look.locator("[role='group'][aria-roledescription] [data-carousel-dot]")).toHaveCount(4);
      expect(await look.locator("[role='group'][aria-roledescription] > button, [role='group'][aria-roledescription] button:not([data-carousel-dot])").count()).toBeGreaterThanOrEqual(2);
      const copyText = (await look.locator("body").innerText()).replace(/\s+/g, " ");
      const originalText = await (async () => {
        const reader = await browser.newPage();
        await reader.goto(original);
        // Text node by text node, so two buttons side by side are two words and not one ("Les merKjøp nå").
        const text = await reader.evaluate(() => {
          const out: string[] = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const parent = node.parentElement;
            if (parent && !["SCRIPT", "STYLE"].includes(parent.tagName)) out.push(node.textContent ?? "");
          }
          return out.join(" ");
        });
        await reader.close();
        return text;
      })();
      // Every word of every card of the original is in the copy (arrows' signs and the page's own chrome are not cards' words).
      const cardWords = [...originalText.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => m[0]).filter((w) => w.length > 2);
      const missing = [...new Set(cardWords.filter((w) => !copyText.includes(w)))];
      expect(missing, `words of the original missing in the copy: ${missing.join(", ")}`).toEqual([]);
      await look.close();

      // Measured against the original, the copy is the page, and no grid is named among the weakest stretches under 60 %.
      const copy = await openCopy(browser, frame, "desktop");
      const [a, b] = [await raster(desktop.screenshot, 360), await raster(copy.screenshot, 360)];
      const score = compareRasters(a.raster, b.raster, a.scale);
      fs.writeFileSync("test-results/replicate-grid-original.png", desktop.screenshot);
      fs.writeFileSync("test-results/replicate-grid-copy.png", copy.screenshot);
      console.log("grid copy match:", score.match, "weakest:", JSON.stringify(score.weakest), "heights", JSON.stringify(score.heights));
      expect(score.match).toBeGreaterThan(70);
      expect(weakGrids(built.parts, score.weakest)).toEqual([]);
      expect(Math.abs(copy.capture.docHeight - desktop.capture.docHeight)).toBeLessThan(desktop.capture.docHeight * 0.12);

      // At a phone's width the grid is a column of cards, the carousel one that scrolls.
      const phone = await openCopy(browser, frame, "mobile");
      expect(Math.abs(phone.capture.docHeight - mobile.capture.docHeight)).toBeLessThan(mobile.capture.docHeight * 0.25);
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
