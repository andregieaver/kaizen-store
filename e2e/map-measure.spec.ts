import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { Browser as CoreBrowser } from "playwright-core";

import { shootMap } from "../src/lib/map-shoot";

import { storePageRows } from "./db";

/**
 * Heatmaps' pictures (D656, `docs/heatmaps-and-recordings.md` step 6): the photographer opens a real store page, measures where each part
 * sits under the same keys a click is kept against (`anchorOf()`), and photographs it full length.
 */

const ROW = randomUUID();
const COLUMN = randomUUID();
const HEADING = randomUUID();
const TEXT = randomUUID();
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

test("measures a store page's parts by their ids and photographs it", async ({ browser, baseURL }) => {
  const path = await storePageRows("kart", [
    {
      id: ROW,
      type: "row",
      layout: "1",
      columns: [{ id: COLUMN, blocks: [{ id: HEADING, type: "heading", text: "Where people click", level: 1 }, { id: TEXT, type: "richText", doc: doc("A paragraph to click on.") }] }],
    },
  ]);
  const { picture, layout } = await shootMap(browser as unknown as CoreBrowser, `${baseURL}${path}`, { width: 390, height: 844, mobile: true }, []);
  expect(picture.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  for (const id of [ROW, COLUMN, HEADING, TEXT]) expect(layout.anchors[id], id).toBeDefined();
  expect(layout.anchors["@main"]).toBeDefined();
  expect(layout.anchors["@body"]).toEqual([0, 0, layout.w, layout.h]);
  // The heading sits inside its column, which sits inside its row, in page pixels.
  const [rx, ry, rw, rh] = layout.anchors[ROW];
  const [hx, hy, hw, hh] = layout.anchors[HEADING];
  expect(hx).toBeGreaterThanOrEqual(rx);
  expect(hy).toBeGreaterThanOrEqual(ry);
  expect(hx + hw).toBeLessThanOrEqual(rx + rw);
  expect(hy + hh).toBeLessThanOrEqual(ry + rh);
  expect(layout).toMatchObject({ v: 1, w: 390, fold: 844 });
  // The header and footer are measured as the landmarks a click on them is kept against.
  expect(layout.anchors["@header"]).toBeDefined();
  expect(layout.anchors["@footer"]).toBeDefined();
});
