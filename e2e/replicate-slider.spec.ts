import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import type { ContentGridBlock, PageBlock } from "../src/lib/page-content";
import { buildReplica } from "../src/lib/replicate-build";
import { CAPTURE_NODES_MAX, CAPTURE_STYLES, VIEWPORTS, walk } from "../src/lib/replicate-capture";
import { extractPage } from "../src/lib/replicate-extract";
import { gridLines } from "../src/lib/replicate-grid";
import { openOriginal } from "../src/lib/replicate-open";
import { WATCH } from "../src/lib/replicate-watch";

/**
 * Sliders that are not Swiper's (D155, C2), read in a real browser: a fade slider (slides on top of each other, one with opacity, moved by a timer),
 * a Bootstrap-like carousel (every item but one `display: none`, floated over each other), and a hero slider whose slides are not one kind of card.
 * The fade slider and the carousel are carousels of custom items made of slides the page was not showing (the fade's autoplay is not carried over: the copy scrolls),
 * the hero slider stays as it was with the reason, and reading the page leaves it as it was (a slide shown for measuring is put back).
 */

const fixture = fs.readFileSync(path.join(__dirname, "fixtures", "replica-slider.html"), "utf8");
const demo = (name: string) => fs.readFileSync(path.join(__dirname, "..", "public", "demo", name));
const PICTURES: Record<string, string> = { "/img/a.svg": "mug.svg", "/img/b.svg": "lamp.svg", "/img/c.svg": "notebook.svg", "/img/d.svg": "tote.svg" };

test("fade, display none and hero sliders are read as they are, and the page is left as it was", async ({ browser }) => {
  test.setTimeout(180_000);
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
    // Reading the page leaves it as it was: the slides that are `display: none` are still, and carry no inline display.
    const page = await browser.newPage({ viewport: { width: VIEWPORTS.desktop.w, height: VIEWPORTS.desktop.h } });
    await page.goto(original);
    const before = await page.evaluate(() => document.documentElement.scrollHeight);
    const read = await page.evaluate(extractPage, { maxNodes: CAPTURE_NODES_MAX, styles: CAPTURE_STYLES, width: VIEWPORTS.desktop.w, height: VIEWPORTS.desktop.h });
    const after = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      displays: Array.from(document.querySelectorAll(".carousel-item")).map((el) => getComputedStyle(el).display),
      inline: Array.from(document.querySelectorAll(".carousel-item")).map((el) => (el as HTMLElement).style.getPropertyValue("display")),
    }));
    expect(after.displays).toEqual(["block", "none", "none"]);
    expect(after.inline).toEqual(["", "", ""]);
    expect(after.height).toBe(before);
    expect([...walk(read.root)].filter((n) => n.slider)).toHaveLength(3);
    await page.close();

    const t0 = Date.now();
    const desktop = await openOriginal(browser, original, "desktop", everything);
    const watched = Date.now() - t0;
    const mobile = await openOriginal(browser, original, "mobile", everything);
    // Three sliders were watched; the bound holds however many there are.
    expect(watched).toBeLessThan(WATCH.totalMs + 30_000);

    const tracks = [...walk(desktop.capture.root)].filter((n) => n.slider);
    expect(tracks.map((t) => t.slider!.kind)).toEqual(["stack", "stack", "transform"]);
    // The fade slider: every slide is kept with its words, the three that do not show are marked see-through; it plays by itself.
    expect(tracks[0].children.map((c) => c.slide?.hide ?? "shown")).toEqual(["shown", "opacity", "opacity", "opacity"]);
    expect(tracks[0].children[3].slide!.text).toBe("Posen tåler alt jeg legger i den. Per fra Stavanger");
    expect(tracks[0].watch).toMatchObject({ observed: true });
    // The carousel: the slides that are `display: none` were measured and read.
    expect(tracks[1].children.map((c) => c.slide?.hide ?? "shown")).toEqual(["shown", "none", "none"]);
    expect(tracks[1].children[2].box[2]).toBeGreaterThan(300);
    expect(tracks[1].children[2].slide!.text).toBe("Bok Fem stjerner fra Eli. Les mer");
    expect(tracks[1].watch).toMatchObject({ observed: false });
    // The hero: its second and third slides lie beyond the box that clips the track.
    expect(tracks[2].children.map((c) => c.slide?.hide ?? "shown")).toEqual(["shown", "outside", "outside"]);

    const own = (url: string) => {
      const name = PICTURES[new URL(url).pathname];
      return name ? { url: `/demo/${name}`, width: 800, height: 600 } : null;
    };
    const built = buildReplica({ desktop: desktop.capture, mobile: mobile.capture, picture: own, shot: () => null, video: () => null, font: () => null }, randomUUID);
    const blocks: PageBlock[] = built.rows.flatMap((row) => row.columns.flatMap((column) => column.blocks));
    const grids = blocks.filter((b): b is ContentGridBlock => b.type === "contentGrid");
    expect(built.grids.built.map((g) => g.items)).toEqual([4, 3]);
    expect(grids).toHaveLength(2);

    // The fade slider: four items made of slides that were all but one see-through, one at a time, with its dots. The effect is gone, and so is its autoplay: it moved by
    // itself in the original, but the copy scrolls, and the report says it did not carry that over.
    const [fade, boot] = grids;
    expect(fade.items!.map((i) => i.title)).toEqual(["Rask levering og fint pakket.", "Lampen ble stuens midtpunkt.", "Notatboken holder hele året.", "Posen tåler alt jeg legger i den."]);
    expect(fade.items![1].text).toBe("Ola fra Tromsø");
    expect(fade.items![1].picture).toMatchObject({ alt: "Ola" });
    expect(fade.display).toBe("carousel");
    expect(fade.columns).toMatchObject({ desktop: 1, mobile: 1 });
    expect(fade.carousel).toMatchObject({ dots: true });
    expect(fade.carousel?.autoplay).toBeUndefined();
    expect(built.grids.built[0].carousel).toMatchObject({ arrows: true, script: { kind: "stack", hidden: 3 } });
    expect(gridLines(built.grids).problems.join(" ")).toContain("fades or swaps its slides in one place");
    expect(gridLines(built.grids).problems.join(" ")).toContain("its autoplay is not carried over");

    // The carousel with `display: none` slides: all three, whose words were never on the screen but the first.
    expect(boot.items!.map((i) => i.title)).toEqual(["Krus", "Lampe", "Bok"]);
    expect(boot.items![2]).toMatchObject({ text: "Fem stjerner fra Eli.", buttonLabel: "Les mer", link: { kind: "url", url: expect.stringContaining("/anmeldelse/bok") } });
    expect(boot.carousel).toMatchObject({ dots: true });
    expect(boot.carousel?.autoplay).toBeUndefined();

    // The hero slider is kept as it was, with the reason and what the copy lacks; its second and third slides are not in the copy.
    const hero = built.grids.kept.find((k) => k.slider);
    expect(hero).toBeTruthy();
    expect(hero!.reason).toMatch(/built differently|structurally different/);
    expect(hero!.reason).toContain("2 slides out of view");
    const json = JSON.stringify(built.rows);
    expect(json).toContain("Våren er her");
    expect(json).not.toContain("Sommerutsalg");
    expect(json).not.toContain("Gratis frakt");
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
