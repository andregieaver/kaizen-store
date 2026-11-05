import "server-only";

import { sql } from "drizzle-orm";
import fontverter from "fontverter";
import subsetFont from "subset-font";
import { z } from "zod";

import { db } from "@/db/client";
import { fontAxes, trimRange } from "@/lib/font-axes";
import { installedWeightRange } from "@/lib/fonts";

import { findFont } from "./fonts";
import { log } from "./log";
import { col, typedRows } from "./typed-rows";

/**
 * Self-hosted fonts cut to the weights a site uses (D59, `docs/performance.md`, Fonts found late). Google sends a variable family's
 * whole weight axis (100 to 900) whatever is asked for, and the builder offers 400 to 700 (`installedStyles()`), so a phone fetched
 * weights no page draws: Inter's Latin file 48 KB, 34 KB cut. Every character, OpenType feature and other axis is kept; what is drawn
 * at the installed weights is the same, its width within a pixel a line.
 *
 * A file keeps its name (a hash of the file Google sent) and its stylesheet, so no page or stylesheet changes and none waits on this;
 * a browser that has the whole file keeps using it. Done by the five-minute dispatcher (`trimFontFiles()`) rather than when a family
 * is installed, so only that job's route carries the WebAssembly (`next.config.ts`).
 */

/** A file cut to the weights `weights`, as woff2, or null when there is nothing to cut or the cut would not be smaller. */
export async function trimFontFile(woff2: Uint8Array, weights: { min: number; max: number }): Promise<Buffer | null> {
  const sfnt = await fontverter.convert(Buffer.from(woff2), "truetype");
  const range = trimRange(fontAxes(sfnt), weights);
  if (!range) return null;
  const cut = await subsetFont(sfnt, null, { keepAllGlyphs: true, variationAxes: { wght: range }, targetFormat: "woff2" });
  // What came out is read back: a weight axis of exactly that range, or none where one weight was kept.
  const kept = fontAxes(await fontverter.convert(cut, "truetype")).find((axis) => axis.tag === "wght");
  const right = kept ? kept.min === range.min && kept.max === range.max : range.min === range.max;
  if (!right) throw new Error(`The cut file's weight axis is ${kept ? `${kept.min} to ${kept.max}` : "gone"}, not ${range.min} to ${range.max}.`);
  return cut.length < woff2.byteLength ? cut : null;
}

/** At most this many files a run, and none started after `RUN_MS`: a few seconds each at most. */
const PER_RUN = 20;
const RUN_MS = 20_000;

const fileRow = z.object({ name: col.text, data: z.custom<Uint8Array>((value) => value instanceof Uint8Array), family: col.textOrNull });

/**
 * The five-minute dispatcher's `fonts` step: font files not yet looked at (`font_files.trimmed_at`), the oldest first, each cut to its
 * family's installed weights (`installedWeightRange()`) and marked, so each is done once. A file that cannot be cut (a static family,
 * one already within them, one no stylesheet names) is marked as it is; one HarfBuzz fails on is logged and marked, and stays whole.
 */
export async function trimFontFiles(now = Date.now): Promise<{ trimmed: number; kept: number; saved: number }> {
  const until = now() + RUN_MS;
  const rows = await typedRows(
    fileRow,
    sql`
      select f.name, f.data, (select family from commerce.fonts where strpos(css, f.name) > 0 order by family limit 1) as family
      from commerce.font_files f
      where f.trimmed_at is null
      order by f.created_at, f.name
      limit ${PER_RUN}
    `,
  );
  let trimmed = 0;
  let kept = 0;
  let saved = 0;
  for (const row of rows) {
    if (now() > until) break;
    const font = row.family ? findFont(row.family) : null;
    let cut: Buffer | null = null;
    try {
      cut = font ? await trimFontFile(row.data, installedWeightRange(font)) : null;
    } catch (error) {
      log("warn", "fonts.trim_failed", { file: row.name }, error);
    }
    if (cut) {
      await db().execute(sql`update commerce.font_files set data = ${cut}, trimmed_at = now() where name = ${row.name} and trimmed_at is null`);
      trimmed++;
      saved += row.data.byteLength - cut.length;
    } else {
      await db().execute(sql`update commerce.font_files set trimmed_at = now() where name = ${row.name} and trimmed_at is null`);
      kept++;
    }
  }
  if (rows.length > 0) log("info", "fonts.trimmed", { trimmed, kept, saved });
  return { trimmed, kept, saved };
}
