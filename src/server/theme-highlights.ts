import "server-only";

import sharp, { type OverlayOptions } from "sharp";

import {
  DEVICES,
  HIGHLIGHT_SIZE,
  backdropColours,
  closeupPlace,
  collageLayout,
  collageSections,
  phoneDetailTop,
  type HighlightKind,
  type Place,
} from "@/lib/theme-highlights";
import type { ShotParts } from "@/lib/theme-shots";

/**
 * Draws a theme's three highlights from its own look's photographs (`docs/theme-showcase-phase-2.md` step 2): frames, shadows and the
 * backdrop are code (SVG composed by `sharp`), the screens the photographs, nothing a model made and no words.
 */

/** What the highlights are drawn from: the computer's and the phone's photographs (decoded files), the parts measured, the theme's colours. */
export type HighlightSources = {
  computerFull: Buffer;
  computerScreen: Buffer;
  /** The product part at twice the pixels, when the photograph had one; else it is cut from the page. */
  detail: Buffer | null;
  phoneFull: Buffer;
  phoneScreen: Buffer;
  parts: ShotParts | null;
  phoneParts: ShotParts | null;
  palette: { surface: string; accent: string };
};

export type Highlight = { kind: HighlightKind; bytes: Buffer; width: number; height: number };

const W = HIGHLIGHT_SIZE.width;
const H = HIGHLIGHT_SIZE.height;
const svg = (body: string, width: number = W, height: number = H) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);

async function backdrop(palette: HighlightSources["palette"]): Promise<Buffer> {
  const { from, to } = backdropColours(palette);
  return sharp(svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`))
    .png()
    .toBuffer();
}

/** A soft shadow under a rounded box, as an overlay placed a little below it. */
async function shadow(place: Place, radius: number, strength = 0.22): Promise<OverlayOptions> {
  const pad = 48;
  const input = await sharp(
    svg(`<rect x="${pad}" y="${pad}" width="${place.width}" height="${place.height}" rx="${radius}" fill="#000" fill-opacity="${strength}"/>`, place.width + pad * 2, place.height + pad * 2),
  )
    .blur(18)
    .png()
    .toBuffer();
  return { input, left: place.left - pad, top: place.top - pad + 18 };
}

/** `source` cut at `rect` (or whole), filling `place` from its top, with rounded corners. */
async function screen(source: Buffer, place: Place, radius: number, rect?: { left: number; top: number; width: number; height: number }): Promise<OverlayOptions> {
  const meta = await sharp(source).metadata();
  const sw = meta.width ?? place.width;
  const sh = meta.height ?? place.height;
  const cut = rect
    ? { left: Math.max(0, Math.min(rect.left, sw - 1)), top: Math.max(0, Math.min(rect.top, sh - 1)), width: 0, height: 0 }
    : null;
  if (cut && rect) {
    cut.width = Math.max(1, Math.min(rect.width, sw - cut.left));
    cut.height = Math.max(1, Math.min(rect.height, sh - cut.top));
  }
  const input = await sharp(source)
    .extract(cut ?? { left: 0, top: 0, width: sw, height: sh })
    .resize({ width: place.width, height: place.height, fit: "cover", position: "top" })
    .composite([{ input: svg(`<rect width="${place.width}" height="${place.height}" rx="${radius}" ry="${radius}"/>`, place.width, place.height), blend: "dest-in" }])
    .png()
    .toBuffer();
  return { input, left: place.left, top: place.top };
}

const encode = async (canvas: Buffer, layers: OverlayOptions[]): Promise<{ bytes: Buffer; width: number; height: number }> => {
  const { data, info } = await sharp(canvas).composite(layers).webp({ quality: 86, effort: 4 }).toBuffer({ resolveWithObject: true });
  return { bytes: data, width: info.width, height: info.height };
};

const BEZEL = "#1f2023";

async function devices(s: HighlightSources, canvas: Buffer): Promise<Highlight> {
  const { computer, base, phones } = DEVICES;
  const phoneMeta = await sharp(s.phoneFull).metadata();
  const phoneWidth = phoneMeta.width ?? 390;
  const phoneView = Math.round((phoneWidth * phones[1].screen.height) / phones[1].screen.width);
  const rect = (p: { left: number; top: number; width: number; height: number; radius: number }, fill: string) =>
    `<rect x="${p.left}" y="${p.top}" width="${p.width}" height="${p.height}" rx="${p.radius}" fill="${fill}"/>`;
  const phone = async (index: 0 | 1, picture: OverlayOptions): Promise<OverlayOptions[]> => [
    await shadow(phones[index], phones[index].radius),
    { input: svg(rect(phones[index], BEZEL)), left: 0, top: 0 },
    picture,
  ];
  // Back to front: the computer, its screen, then each phone over it.
  const layers: OverlayOptions[] = [
    await shadow({ left: computer.left, top: computer.top, width: computer.width, height: computer.height + 40 }, computer.radius),
    {
      input: svg(
        [rect(computer, BEZEL), rect(base.lip, "#3a3b40"), `<polygon points="${base.foot.map(([x, y]) => `${x},${y}`).join(" ")}" fill="#2b2c30"/>`].join(""),
      ),
      left: 0,
      top: 0,
    },
    await screen(s.computerScreen, computer.screen, computer.screen.radius),
    ...(await phone(0, await screen(s.phoneScreen, phones[0].screen, phones[0].screen.radius))),
    ...(await phone(1, await screen(s.phoneFull, phones[1].screen, phones[1].screen.radius, { left: 0, top: phoneDetailTop(s.phoneParts), width: phoneWidth, height: phoneView }))),
  ];
  return { kind: "devices", ...(await encode(canvas, layers)) };
}

async function collage(s: HighlightSources, canvas: Buffer): Promise<Highlight> {
  const meta = await sharp(s.computerFull).metadata();
  const pageWidth = meta.width ?? 1440;
  const sections = collageSections(s.parts);
  // A page that could not be measured shows its top, cut in two.
  const boxes = sections.length > 0 ? sections : [{ top: 0, height: Math.min(900, meta.height ?? 900) }];
  const layers: OverlayOptions[] = [];
  for (const tile of collageLayout(boxes, pageWidth)) {
    const height = Math.min(tile.height, H - tile.top);
    const sourceHeight = Math.round((height * pageWidth) / tile.width);
    layers.push(await shadow({ ...tile, height }, 16, 0.18));
    layers.push(await screen(s.computerFull, { ...tile, height }, 16, { left: 0, top: tile.section.top, width: pageWidth, height: sourceHeight }));
  }
  return { kind: "collage", ...(await encode(canvas, layers)) };
}

async function closeup(s: HighlightSources, canvas: Buffer): Promise<Highlight> {
  let detail = s.detail;
  // Photographed at twice the pixels: shown at most at its own size. Cut from the page: a little larger at most.
  const maxScale = detail ? 1 : 1.2;
  if (!detail) {
    // No close photograph: the product (or the page's second section) cut from the page itself.
    const meta = await sharp(s.computerFull).metadata();
    const box = s.parts?.product ?? s.parts?.rows[1] ?? { top: 0, height: Math.min(700, meta.height ?? 700) };
    const top = Math.max(0, Math.min(box.top, (meta.height ?? 1) - 1));
    detail = await sharp(s.computerFull)
      .extract({ left: 0, top, width: meta.width ?? 1440, height: Math.max(1, Math.min(box.height, (meta.height ?? 1) - top)) })
      .png()
      .toBuffer();
  }
  const meta = await sharp(detail).metadata();
  const place = closeupPlace(meta.width ?? 1, meta.height ?? 1, maxScale);
  const layers: OverlayOptions[] = [await shadow(place, 20, 0.2), await screen(detail, place, 20)];
  return { kind: "closeup", ...(await encode(canvas, layers)) };
}

/** The three highlights, each 1600 × 1000 WebP. */
export async function composeHighlights(sources: HighlightSources): Promise<Highlight[]> {
  const canvas = await backdrop(sources.palette);
  return [await devices(sources, canvas), await collage(sources, canvas), await closeup(sources, canvas)];
}
