import { sql } from "drizzle-orm";
import opentype from "opentype.js";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { makeBrandMarks } = await import("./brand-marks");
const { forgetFontOutlines } = await import("./font-outlines");
const ownerTools = await import("./owner-tools");
const siteTools = await import("./site-tools");
const { newStore } = await import("./inventory-test-support");
const { brandMarksInput, ICON_SIZE, LOGO_HEIGHT } = await import("@/lib/brand-marks");

type Row = Record<string, unknown>;

/**
 * The brand's logo and icon (D330 F2a, `docs/ai-autopilot.md` 14.4): drawn from a stand-in font's outlines (Google Fonts played by code,
 * only its two hosts asked), kept as three pictures at their sizes; a name the font has no letters for is refused, keeping nothing; and the
 * icon taken by `set_header_footer` only when it is a square picture of the site's own library.
 */

/** A font of plain boxes for the letters given, so every letter has outlines and every other one is missing. */
function standInFont(chars: string): ArrayBuffer {
  const box = (char: string, i: number) => {
    const path = new opentype.Path();
    const w = 400 + (i % 3) * 60;
    path.moveTo(40, 0);
    path.lineTo(w, 0);
    path.lineTo(w, 700);
    path.lineTo(40, 700);
    path.close();
    return new opentype.Glyph({ name: `g${i}`, unicode: char.codePointAt(0), advanceWidth: w + 80, path });
  };
  const glyphs = [
    new opentype.Glyph({ name: ".notdef", unicode: 0, advanceWidth: 500, path: new opentype.Path() }),
    new opentype.Glyph({ name: "space", unicode: 32, advanceWidth: 250, path: new opentype.Path() }),
    ...[...new Set(chars)].map(box),
  ];
  return new opentype.Font({ familyName: "Inter", styleName: "Bold", unitsPerEm: 1000, ascender: 800, descender: -200, glyphs }).toArrayBuffer();
}

const fontFile = standInFont("BergnRoastBR");
const asked: string[] = [];
const fakeFetch = async (url: string) => {
  asked.push(new URL(url).hostname);
  if (url.startsWith("https://fonts.googleapis.com/css2")) return new Response("@font-face { src: url(https://fonts.gstatic.com/s/inter/v1/bold.ttf) format('truetype'); }");
  if (url === "https://fonts.gstatic.com/s/inter/v1/bold.ttf") return new Response(fontFile);
  return new Response("not here", { status: 404 });
};

let store: Awaited<ReturnType<typeof newStore>>;
const kept: { name: string; width: number; height: number; smallHeight: number; url: string }[] = [];

/** The media library played by a row per picture, with its real size, so the header's checks read it as they would. */
const keepInLibrary = async (owner: { storeId: string | null }, image: File, thumbnail: File, details: { fileName: string }) => {
  const big = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
  const small = await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata();
  const url = `https://media.example/${owner.storeId}/${Math.random().toString(36).slice(2)}-${details.fileName}`;
  await db().execute(sql`
    insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, size_bytes, width, height)
    values (${owner.storeId}::uuid, 'image', ${url}, ${`${url}?small`}, 'product-media', ${`${owner.storeId}/${details.fileName}`}, null, ${details.fileName}, 'image/png', ${image.size}, ${big.width ?? 0}, ${big.height ?? 0})
  `);
  kept.push({ name: details.fileName, width: big.width ?? 0, height: big.height ?? 0, smallHeight: small.height ?? 0, url });
  return { ok: true as const, url, thumbnailUrl: `${url}?small` };
};

const ctx = () => ({ account: store.member.account, store: store.member.store, invalidate: () => {} });
const scope = () => ({ account: { id: store.accountId }, store: store.member.store });
const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof ownerTools.OwnerToolError ? error.message : `not a tool refusal: ${String(error)}`;
  }
};

beforeAll(async () => {
  store = await newStore("marks");
});

beforeEach(() => {
  forgetFontOutlines();
  asked.length = 0;
});

afterAll(closeDb);

describe("the brand's marks", () => {
  it("draws the logo for light and dark and the icon from the font's outlines, kept at their sizes, asking only Google Fonts' two hosts", async () => {
    const marks = await makeBrandMarks(scope(), brandMarksInput.parse({ text: "Bergen Roast", font: "Inter" }), { fetch: fakeFetch, store: keepInLibrary });
    expect(marks).toMatchObject({ text: "Bergen Roast", letters: "BR", font: "Inter", weight: 700 });
    expect([...new Set(asked)].sort()).toEqual(["fonts.googleapis.com", "fonts.gstatic.com"]);
    expect(kept.map((k) => k.name)).toEqual(["bergen-roast-logo.png", "bergen-roast-logo-dark.png", "bergen-roast-icon.png"]);
    const [logo, logoDark, icon] = kept;
    expect([logo.height, logoDark.height, logo.smallHeight]).toEqual([LOGO_HEIGHT, LOGO_HEIGHT, LOGO_HEIGHT / 2]);
    expect(logo.width).toBeGreaterThan(logo.height * 2);
    expect([icon.width, icon.height]).toEqual([ICON_SIZE, ICON_SIZE]);
    expect([marks.logo, marks.logoDark, marks.icon]).toEqual(kept.map((k) => k.url));
  });

  it("refuses words the font has no letters for, keeping nothing", async () => {
    const before = kept.length;
    const problem = await refusal(makeBrandMarks(scope(), brandMarksInput.parse({ text: "Bergen Roastx", font: "Inter" }), { fetch: fakeFetch, store: keepInLibrary }));
    expect(problem).toContain('Inter has no letters for "x"');
    expect(kept.length).toBe(before);
  });

  it("puts the icon in the header only when it is a square picture of the site's library, waiting for a yes", async () => {
    const [logo, , icon] = kept;
    expect(await refusal(ownerTools.preflightOwnerTool(ctx(), "set_header_footer", { icon: logo.url }))).toContain("must be a square picture");
    expect(await ownerTools.gateNeeded(store.member.store, "set_header_footer", { icon: icon.url })).toBe(true);
    expect(await siteTools.headerFooterApprovalWords(ctx(), { logo: logo.url, icon: icon.url })).toBe("Change the standard header and footer: a new logo; a new icon in browser tabs.");
    await ownerTools.runOwnerTool(ctx(), "set_header_footer", { logo: logo.url, icon: icon.url });
    const [row] = await db().execute<Row>(sql`select navigation from commerce.stores where id = ${store.storeId}::uuid`);
    expect((row.navigation as Row).favicon).toEqual({ url: icon.url, smallUrl: `${icon.url}?small` });
  });
});
