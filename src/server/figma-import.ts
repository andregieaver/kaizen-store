import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { cssProblem } from "@/lib/custom-css";
import { figmaFrame, figmaToCapture, pictureKeys, type SentPicture } from "@/lib/figma-capture";
import { newPageContent } from "@/lib/page-content";
import { buildReplica, type Picture } from "@/lib/replicate-build";
import { renderStyles } from "@/lib/replicate-styles";
import { fontRelation } from "@/lib/replicate-fonts";
import { slugify } from "@/lib/slug";

import type { Account } from "./auth";
import { freePageSlug, savePage } from "./pages";
import { installFamily } from "./replicate-assets";
import { col, typedRows } from "./typed-rows";

/**
 * A draft page from a Figma frame (D898 F2, `docs/design-tools.md`): the frame the Kaizena Flow plugin read becomes a page capture
 * (`figmaToCapture()`), and the page copy engine builds it as it builds a copied page (`buildReplica()`, `renderStyles()`), saved as a draft
 * by the editor's own save. Its pictures are the store's library items the plugin sent first (each checked to be this store's own image);
 * its typefaces are installed from Google Fonts, or the nearest one stands in, as the copy does. Nothing is published.
 */

/** The most typefaces one import installs: a design rarely has more, and each is a download. */
const FAMILIES_MAX = 6;

export type FigmaImport = { ok: true; id: string; title: string; summary: string; notes: string[] } | { ok: false; problem: string };

export async function importFigmaPage(
  owner: { account: Account; storeId: string },
  input: { file?: string; desktop: unknown; mobile?: unknown; pictures: Record<string, { id: string }> },
  deps: { install?: typeof installFamily } = {},
): Promise<FigmaImport> {
  const frame = figmaFrame.safeParse(input.desktop);
  if (!frame.success) return { ok: false, problem: "The frame could not be read. Update the Kaizena Flow plugin in Figma and send it again." };
  if (input.mobile != null && !figmaFrame.safeParse(input.mobile).success) return { ok: false, problem: "The phone frame could not be read." };
  const file = (input.file ?? "").slice(0, 200);

  // Only the store's own pictures, by the ids the plugin was given; the addresses are the library's, not the plugin's.
  const wanted = pictureKeys(frame.data).filter((key) => input.pictures[key] && z.uuid().safeParse(input.pictures[key].id).success);
  const ids = [...new Set(wanted.map((key) => input.pictures[key].id))];
  const rows = ids.length
    ? await typedRows(
        z.object({ id: col.uuid, url: col.text, width: z.number().int().nullable(), height: z.number().int().nullable() }),
        sql`select id, url, width, height from commerce.media
            where store_id = ${owner.storeId}::uuid and kind = 'image' and id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`,
      )
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pictures = new Map<string, SentPicture>();
  for (const key of wanted) {
    const row = byId.get(input.pictures[key].id);
    if (row) pictures.set(key, { url: row.url, width: row.width, height: row.height });
  }
  const byUrl = new Map<string, Picture>([...pictures.values()].map((p) => [p.url, { url: p.url, width: p.width ?? 0, height: p.height ?? 0 }]));

  const capture = figmaToCapture(frame.data, pictures, file);
  const notes: string[] = [];
  const missing = pictureKeys(frame.data).length - pictures.size;
  if (missing > 0) notes.push(`${missing} picture${missing === 1 ? " was" : "s were"} not sent and ${missing === 1 ? "is" : "are"} left out.`);
  if (frame.data.cut) notes.push("The frame has more parts than one import takes; the last ones are left out.");
  if (input.mobile) notes.push("The phone frame is not used yet: the builder makes the phone version from the computers'.");

  // Its typefaces, the most used first: installed from Google Fonts, or the nearest one stands in.
  const install = deps.install ?? installFamily;
  const fonts: Record<string, string | null> = {};
  const families = [...new Map(capture.fonts.map((f) => [f.family, f.chars])).entries()].sort((a, b) => b[1] - a[1]).map(([family]) => family);
  for (const family of families.slice(0, FAMILIES_MAX)) {
    const installed = await install(family);
    fonts[family] = installed.ok ? installed.family : null;
    if (!installed.ok) notes.push(`The typeface ${family} is not in Google Fonts; the site's own is used instead.`);
    else if (fontRelation(family, installed.family) === "lookalike") notes.push(`The typeface ${family} is not in Google Fonts; ${installed.family}, the nearest, stands in.`);
  }

  const built = buildReplica(
    { desktop: capture, mobile: null, picture: (url) => byUrl.get(url) ?? null, shot: () => null, video: () => null, font: (family) => fonts[family] ?? null },
    randomUUID,
  );
  if (built.rows.length === 0) return { ok: false, problem: "Nothing in the frame could be turned into rows of the builder." };
  const styled = renderStyles(built.model, built.shared);
  if (styled.trimmed) notes.push(styled.trimmed);
  const refused = cssProblem(styled.css);
  if (refused) return { ok: false, problem: `The page's styles were refused: ${refused}` };
  for (const note of built.notes.slice(0, 8)) notes.push(note.text);

  const title = (frame.data.name || file || "Figma design").slice(0, 190);
  const content = {
    ...newPageContent(),
    title,
    slug: await freePageSlug(owner.storeId, slugify(title, 60) || "figma-design"),
    seo: { title: title.slice(0, 120), description: "" },
    rows: built.rows,
    css: styled.css,
  };
  let saved = await savePage(owner.account, owner.storeId, null, content, { publish: false, type: "page" });
  for (let attempt = 0; attempt < 3 && !saved.ok && saved.problems.some((p) => /address|slug/i.test(p)); attempt++) {
    saved = await savePage(owner.account, owner.storeId, null, { ...content, slug: `${content.slug}-${randomUUID().slice(0, 4)}` }, { publish: false, type: "page" });
  }
  if (!saved.ok) return { ok: false, problem: `The builder did not accept the page: ${saved.problems.slice(0, 3).join(" ")}` };
  const c = built.counts;
  const summary = `Built a draft page: ${c.rows} row${c.rows === 1 ? "" : "s"} with ${c.headings} heading${c.headings === 1 ? "" : "s"}, ${c.texts} text block${c.texts === 1 ? "" : "s"}, ${c.pictures} picture${c.pictures === 1 ? "" : "s"} and ${c.buttons} button${c.buttons === 1 ? "" : "s"}.`;
  return { ok: true, id: saved.id, title, summary, notes: notes.slice(0, 20) };
}
