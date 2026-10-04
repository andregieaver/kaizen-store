import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { buildReplica } from "../src/lib/replicate-build";
import type { ContentGridBlock, PageBlock } from "../src/lib/page-content";
import { CAPTURE_NODES_MAX, CAPTURE_STYLES, walk } from "../src/lib/replicate-capture";
import { extractPage } from "../src/lib/replicate-extract";
import { openOriginal } from "../src/lib/replicate-open";
import { WATCH } from "../src/lib/replicate-watch";

/**
 * Adversarial review of D155 part C (safety and bounds), in a real browser: what a page can do to the capture's time and to the watch for
 * autoplay. Local pages only (`everything` lets the browser reach them).
 */

const PICTURES: Record<string, string> = { "/img/a.svg": "mug.svg", "/img/b.svg": "lamp.svg", "/img/c.svg": "notebook.svg", "/img/d.svg": "tote.svg" };

async function serve(html: string) {
  const server = http.createServer((request, response) => {
    const picture = PICTURES[request.url ?? ""];
    if (picture) {
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end(fs.readFileSync(path.join(__dirname, "..", "public", "demo", picture)));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, close: () => server.close() };
}
const everything = async () => true;

test("a fade slider with thousands of slides that are display: none is read in time linear in the slides, not their square", async ({ browser }) => {
  test.setTimeout(120_000);
  const n = 4000;
  const slides = Array.from({ length: n }, (_, i) => `<li style="${i === 0 ? "" : "display:none"}"><h3>Slide ${i}</h3><p>Words of slide ${i}</p></li>`).join("");
  const html = `<!doctype html><html><body><section style="padding:40px"><div style="width:600px;position:relative;overflow:hidden"><ul class="slick-track" style="list-style:none;margin:0;padding:0;position:relative;height:100px">${slides}</ul></div></section></body></html>`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.setContent(html);
    const begun = Date.now();
    await page.evaluate(extractPage, { maxNodes: CAPTURE_NODES_MAX, styles: CAPTURE_STYLES, width: 1440, height: 900 });
    const took = Date.now() - begun;
    console.log(`${n} hidden slides read in ${took} ms`);
    // The same slides hidden by `visibility` or `opacity` take about 100 ms; 4000 take 20 s or more when each hidden one scans all its siblings.
    expect(took).toBeLessThan(3000);
  } finally {
    await page.close();
  }
});

test("a page that stops answering after the capture does not hang the open: the watch gives up within its own total", async ({ browser }) => {
  test.setTimeout(120_000);
  const slides = Array.from({ length: 6 }, (_, i) => `<div style="flex:0 0 200px;width:200px;height:120px"><h3>Logo ${i}</h3><p>Company number ${i}</p></div>`).join("");
  // The page locks up four seconds after the extractor marks a track, which is after the capture and its photograph are done.
  const html = `<!doctype html><html><body><section style="padding:40px"><div style="width:600px;overflow:hidden"><div class="swiper-wrapper" style="display:flex;width:max-content;transform:translateX(-10px)">${slides}</div></div></section>
  <script>new MutationObserver(function(){setTimeout(function(){for(;;){}},4000)}).observe(document.documentElement,{attributes:true,subtree:true,attributeFilter:['data-rp-track']})</script></body></html>`;
  const site = await serve(html);
  try {
    const begun = Date.now();
    const outcome = await Promise.race([
      openOriginal(browser, site.url, "desktop", everything).then(() => "opened"),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 60_000)),
    ]);
    console.log(`open ${outcome} after ${Date.now() - begun} ms`);
    expect(outcome).toBe("opened");
    // Without the watch the same page opens in about two seconds.
    expect(Date.now() - begun).toBeLessThan(WATCH.totalMs + 20_000);
  } finally {
    site.close();
  }
});

test("a script ticker that moves every frame is not copied as a carousel that autoplays", async ({ browser }) => {
  test.setTimeout(120_000);
  const slides = Array.from({ length: 6 }, (_, i) => `<div style="flex:0 0 200px;width:200px;height:120px;border:1px solid #ccc"><h3>Logo ${i}</h3><p>Company number ${i}</p></div>`).join("");
  const html = `<!doctype html><html><body><section style="padding:40px"><div style="width:600px;overflow:hidden"><div id="t" class="swiper-wrapper" style="display:flex;width:max-content">${slides}</div></div></section>
  <script>var x=0;function f(){x-=0.5;document.getElementById('t').style.transform='translateX('+x+'px)';requestAnimationFrame(f)}f()</script></body></html>`;
  const site = await serve(html);
  try {
    const desktop = await openOriginal(browser, site.url, "desktop", everything);
    const built = buildReplica({ desktop: desktop.capture, mobile: null, picture: () => null, shot: () => null, video: () => null, font: () => null }, randomUUID);
    const grids = built.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks)).filter((block) => block.type === "contentGrid");
    expect(grids).toHaveLength(1);
    const carousel = (grids[0] as { carousel?: { autoplay?: unknown } }).carousel;
    // It moved the whole time it was watched: that is not a slide every N seconds, and it must not turn autoplay on in the copy.
    expect(carousel?.autoplay).toBeUndefined();
  } finally {
    site.close();
  }
});

// -- what a visitor sees, and what the copy says of it (review of D155 part C: correctness) ----------------------------

const gridsIn = (built: ReturnType<typeof buildReplica>) => built.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks)).filter((block: PageBlock): block is ContentGridBlock => block.type === "contentGrid");
const own = () => ({ desktop: null as never, mobile: null, picture: (url: string) => ({ url: `/demo/${PICTURES[new URL(url).pathname] ?? "mug.svg"}`, width: 800, height: 600 }), shot: () => null, video: () => null, font: () => null });

test("words hidden by visibility, opacity or a zero font size are not copied; a screen-reader-only part is no label; words a pseudo-element draws are named as left out", async ({ browser }) => {
  test.setTimeout(120_000);
  const html = fs.readFileSync(path.join(__dirname, "fixtures", "replica-adversarial.html"), "utf8");
  const site = await serve(html);
  try {
    const desktop = await openOriginal(browser, site.url, "desktop", everything, undefined, { watch: false });
    const built = buildReplica({ ...own(), desktop: desktop.capture }, randomUUID);
    const json = JSON.stringify(built.rows);
    // Hidden text is no text of the page.
    for (const hidden of ["Sold out", "transparent1", "transparent2", "zerofont3", "(secret)", "secret"]) expect(json, hidden).not.toContain(hidden);
    const grids = gridsIn(built);
    // The first row: a title and a line of words for each, as a visitor reads them.
    expect(grids[0].items!.map((item) => item.title)).toEqual(["Lamp", "Mug", "Bag"]);
    expect(grids[0].items!.map((item) => item.text)).toEqual(["Warm light", "Warm drink", "Big bag"]);
    // A sentence with a screen-reader-only part is one sentence of text, not a bold label and a value (and no colon is added).
    expect(grids[1].items!.map((item) => item.text)).toEqual(["Fine print one", "Fine print two", "Fine print three"]);
    expect(grids[1].items!.every((item) => item.details.length === 0)).toBe(true);
    // The row whose headings are drawn with `::before { content: "NEW " }`: the words are no run, so the copy lacks them, and says so.
    expect(built.grids.kept.some((k) => /words that the page draws with CSS/.test(k.reason))).toBe(true);
    expect(built.dropped.some((d) => d.kind === "generated-text" && d.text === "NEW")).toBe(true);
    expect(built.notes.some((n) => /draws with CSS/.test(n.text))).toBe(true);
  } finally {
    site.close();
  }
});

test("stacked panels under tabs are not a carousel, and the panels that do not show are not copied", async ({ browser }) => {
  test.setTimeout(120_000);
  const panels = ["One", "Two", "Three"].map((name, i) => `<div style="position:absolute;inset:0;${i === 0 ? "" : "opacity:0;visibility:hidden"}"><h3>Panel ${name}</h3><p>Words of panel ${name.toLowerCase()}.</p></div>`).join("");
  const html = `<!doctype html><html><body style="margin:0"><section style="padding:40px"><div style="display:flex;gap:12px"><button>Tab one</button><button>Tab two</button><button>Tab three</button></div><div style="position:relative;height:160px;width:600px">${panels}</div></section></body></html>`;
  const site = await serve(html);
  try {
    const desktop = await openOriginal(browser, site.url, "desktop", everything, undefined, { watch: false });
    expect([...walk(desktop.capture.root)].filter((n) => n.slider)).toHaveLength(0);
    const built = buildReplica({ ...own(), desktop: desktop.capture }, randomUUID);
    expect(gridsIn(built)).toHaveLength(0);
    const json = JSON.stringify(built.rows);
    expect(json).toContain("Panel One");
    expect(json).not.toContain("Panel Two");
    expect(json).not.toContain("Panel Three");
  } finally {
    site.close();
  }
});

test("a loop slider's clones do not spend the node budget of the page after it", async ({ browser }) => {
  test.setTimeout(180_000);
  const slide = (i: number, clone: boolean) => `<div class="swiper-slide${clone ? " swiper-slide-duplicate" : ""}" ${clone ? `data-swiper-slide-index="${i}"` : ""} style="flex:0 0 200px;width:200px;height:120px"><div><div><h3>Slide ${i}</h3><p>Words ${i}</p><ul><li><span>a</span></li><li><span>b</span></li></ul><a href="/s/${i}">More</a></div></div></div>`;
  const real = Array.from({ length: 60 }, (_, i) => slide(i, false)).join("");
  const clones = Array.from({ length: 60 }, (_, i) => slide(i, true)).join("");
  const rows = Array.from({ length: 720 }, (_, i) => `<p>Plain row ${i}</p>`).join("");
  const html = `<!doctype html><html><body style="margin:0"><section><div style="width:600px;overflow:hidden"><div class="swiper-wrapper" style="display:flex;width:max-content;transform:translateX(-12000px)">${clones}${real}${clones}</div></div></section>${rows}<footer><p>Footer words</p></footer></body></html>`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.setContent(html);
    const read = await page.evaluate(extractPage, { maxNodes: CAPTURE_NODES_MAX, styles: CAPTURE_STYLES, width: 1440, height: 900 });
    // The page after the slider is all there: the slider's copies are read for their words only, not as boxes of their own.
    expect(read.left.capped).toBe(false);
    expect(JSON.stringify(read.root)).toContain("Footer words");
    const track = [...walk(read.root)].find((n) => n.slider)!;
    expect(track.children.filter((c) => c.slide?.clone !== undefined).every((c) => c.children.length === 0)).toBe(true);
    expect(track.children.filter((c) => c.slide?.clone === undefined && c.slide?.key !== undefined)).toHaveLength(0);
  } finally {
    await page.close();
  }
});

test("a native scroller of two cards is a carousel only with something to go to: arrows found by their label count, a bare pair does not", async ({ browser }) => {
  test.setTimeout(120_000);
  const card = (i: number) => `<div style="flex:0 0 420px;box-sizing:border-box;padding:16px;border:1px solid #ccc"><img src="/img/${["a", "b"][i]}.svg" alt="P${i}" style="width:100%;height:120px"><h3>Card ${i}</h3><p>Words of card ${i}</p></div>`;
  const track = `<div style="display:flex;gap:20px;width:600px;overflow-x:auto;scroll-snap-type:x mandatory">${card(0)}${card(1)}</div>`;
  const withArrows = `<!doctype html><html><body style="margin:0"><section style="padding:40px"><div style="display:flex;align-items:center;gap:8px">${track}<button class="b1" aria-label="Next" style="width:32px;height:32px">›</button></div></section></body></html>`;
  const bare = `<!doctype html><html><body style="margin:0"><section style="padding:40px">${track}</section></body></html>`;
  for (const [name, html, expected] of [["labelled", withArrows, 1], ["bare", bare, 0]] as const) {
    const site = await serve(html);
    try {
      const desktop = await openOriginal(browser, site.url, "desktop", everything, undefined, { watch: false });
      const scroller = [...walk(desktop.capture.root)].find((n) => n.scroll);
      expect(scroller, name).toBeTruthy();
      expect(scroller!.controls?.arrows.length ?? 0, name).toBe(expected);
      const built = buildReplica({ ...own(), desktop: desktop.capture }, randomUUID);
      expect(gridsIn(built), name).toHaveLength(expected);
    } finally {
      site.close();
    }
  }
});

test("slides that say the same and go to different places keep their addresses in what the browser read", async ({ browser }) => {
  test.setTimeout(120_000);
  const links = ["women", "men", "kids", "home"].map((c) => `<div style="flex:0 0 280px;width:280px;height:100px"><a href="/cat/${c}"><img src="/img/a.svg" alt="" style="width:100%;height:60px"><h3>Summer sale</h3></a></div>`).join("");
  const html = `<!doctype html><html><body style="margin:0"><section style="padding:40px"><div style="width:700px;overflow:hidden"><div class="swiper-wrapper" style="display:flex;width:max-content;transform:translateX(0)">${links}</div></div></section></body></html>`;
  const site = await serve(html);
  try {
    const desktop = await openOriginal(browser, site.url, "desktop", everything, undefined, { watch: false });
    const track = [...walk(desktop.capture.root)].find((n) => n.slider)!;
    expect(track.children.map((c) => c.slide?.links?.map((l) => new URL(l).pathname))).toEqual([["/cat/women"], ["/cat/men"], ["/cat/kids"], ["/cat/home"]]);
    const built = buildReplica({ ...own(), desktop: desktop.capture }, randomUUID);
    expect(gridsIn(built)[0]?.items?.map((item) => (item.link as { url: string }).url.split("/").pop())).toEqual(["women", "men", "kids", "home"]);
  } finally {
    site.close();
  }
});

test("a box parked above the page (a cookie tool's iframe at -9999px) is not on the page: it is no row, and no row after it is pushed down", async ({ browser }) => {
  test.setTimeout(120_000);
  const html = `<!doctype html><html><body style="margin:0;font-family:Arial">
    <iframe srcdoc="<p>Consent</p>" style="position:absolute;top:-9999px;left:0;width:300px;height:200px"></iframe>
    <div id="away" style="position:absolute;left:-5000px;top:100px;width:200px;height:100px">Parked left</div>
    <h1 style="margin:0;padding:20px">First heading</h1>
    <p style="margin:0;padding:20px">Second paragraph</p>
  </body></html>`;
  const site = await serve(html);
  try {
    const desktop = await openOriginal(browser, site.url, "desktop", everything, undefined, { watch: false });
    const boxes = [...walk(desktop.capture.root)].map((n) => n.box);
    // Nothing of the page lies above the top or left of it.
    expect(boxes.every((b) => b[1] + b[3] > -20 && b[0] + b[2] > -20)).toBe(true);
    const built = buildReplica({ ...own(), desktop: desktop.capture }, randomUUID);
    const json = JSON.stringify(built.rows);
    expect(json).toContain("First heading");
    expect(json).toContain("Second paragraph");
    expect(json).not.toContain("Parked left");
    expect(json).not.toContain("Consent");
    // The first row starts where the first heading does, not 10,000 px above it.
    expect(built.rows[0]).toBeTruthy();
    expect(JSON.stringify(built.parts.map((p) => p.target?.[1] ?? 0).filter((y) => y < -100))).toBe("[]");
  } finally {
    site.close();
  }
});

test("a read-more box is read as far as it is seen: its text is 600 px tall and the visitor sees 170, and what follows follows the 170", async ({ browser }) => {
  test.setTimeout(120_000);
  const html = `<!doctype html><html><body style="margin:0;font-family:Arial">
    <div id="more" style="position:relative;max-height:170px;overflow:hidden"><div id="text" style="height:600px"><p style="margin:0;padding:10px">First paragraph, seen</p><p style="margin:0;padding:10px;position:absolute;top:900px">Far below, hidden</p></div></div>
    <button id="btn" style="display:block;margin:0 auto">Read more</button>
  </body></html>`;
  const site = await serve(html);
  try {
    const desktop = await openOriginal(browser, site.url, "desktop", everything, undefined, { watch: false });
    const nodes = [...walk(desktop.capture.root)];
    const more = nodes.find((n) => n.sel?.includes("#more"));
    const inner = nodes.find((n) => n.sel?.includes("#text"));
    expect(more?.box[3]).toBe(170);
    // The inner box is cut to what is seen, so the row after it starts where the visitor sees it start.
    expect(inner?.box[3]).toBe(170);
    const button = nodes.find((n) => n.sel?.includes("#btn"));
    expect(button!.box[1]).toBeCloseTo(170, 0);
    expect(JSON.stringify(desktop.capture.root)).not.toContain("Far below");
  } finally {
    site.close();
  }
});

test("a cookie dialog and a script that one load injects in front of the page do not renumber its boxes: the same box has the same address in both", async ({ browser }) => {
  test.setTimeout(120_000);
  const body = `<h1 id="h" style="margin:0;padding:20px">First heading</h1><p id="p" style="margin:0;padding:20px">Second paragraph</p>`;
  const injected = `<script>window.x=1</script><div id="consent" style="position:fixed;left:20px;bottom:20px;width:300px;height:120px;background:#eee">Cookies</div><script>window.y=2</script>`;
  const withDialog = await serve(`<!doctype html><html><body style="margin:0;font-family:Arial">${injected}${body}</body></html>`);
  const without = await serve(`<!doctype html><html><body style="margin:0;font-family:Arial">${body}</body></html>`);
  try {
    const a = await openOriginal(browser, withDialog.url, "desktop", everything, undefined, { watch: false });
    const b = await openOriginal(browser, without.url, "mobile", everything, undefined, { watch: false });
    const at = (capture: typeof a.capture, id: string) => [...walk(capture.root)].find((n) => n.sel?.includes(`#${id}`))?.p;
    expect(at(a.capture, "h")).toBeDefined();
    expect(at(a.capture, "h")).toBe(at(b.capture, "h"));
    expect(at(a.capture, "p")).toBe(at(b.capture, "p"));
    expect(JSON.stringify(a.capture.root)).not.toContain("Cookies");
  } finally {
    withDialog.close();
    without.close();
  }
});
