/* global figma, __html__ */
/**
 * Kaizena Flow's plugin for Figma (D898 F1 and F3, docs/design-tools.md): *Send to my store* and *Send colours and type*. This file runs in
 * Figma's sandbox: it reads the frames the person selected (boxes, auto layout, fills, corners, shadows, text runs) and the bytes of their
 * pictures, or the file's colour styles, colour variables and text styles, and keeps the store's token in Figma's client storage and, in the
 * file, which look it made for each store. Its window (ui.html) signs in and talks to Kaizena Flow; nothing here reaches the network.
 */

const NODES_MAX = 2000;
const PICTURES_MAX = 60;
const COLOURS_MAX = 300;
const TEXT_STYLES_MAX = 100;
const TOKEN_KEY = "kaizena-flow-token";
/** The look made from this file for a store, kept in the file: sending again brings that look up to date. */
const lookKey = (store) => `kaizena-look:${String(store).slice(0, 80)}`;

figma.showUI(__html__, { width: 360, height: 520, themeColors: true });

const round = (n) => Math.round(n * 100) / 100;
const colour = (c, opacity) => ({ r: round(c.r), g: round(c.g), b: round(c.b), a: round((c.a === undefined ? 1 : c.a) * (opacity === undefined ? 1 : opacity)) });

/** The fills that show: solid colours, gradients' first stop, and pictures by their hash. */
function paints(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const paint of list) {
    if (paint.visible === false) continue;
    if (paint.type === "SOLID") out.push({ type: "SOLID", color: colour(paint.color, paint.opacity) });
    else if (paint.type === "IMAGE" && paint.imageHash) out.push({ type: "IMAGE", hash: paint.imageHash, scale: paint.scaleMode });
    else if (paint.type.indexOf("GRADIENT") === 0 && paint.gradientStops && paint.gradientStops.length > 0) {
      out.push({ type: "GRADIENT", kind: paint.type, stops: paint.gradientStops.map((s) => ({ at: round(s.position), color: colour(s.color, paint.opacity) })) });
    }
  }
  return out;
}

const shadows = (effects) =>
  (Array.isArray(effects) ? effects : [])
    .filter((e) => e.visible !== false && (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW"))
    .map((e) => ({ inner: e.type === "INNER_SHADOW", x: e.offset.x, y: e.offset.y, blur: e.radius, spread: e.spread || 0, color: colour(e.color) }));

function corners(node) {
  if (typeof node.cornerRadius === "number") return node.cornerRadius > 0 ? [node.cornerRadius, node.cornerRadius, node.cornerRadius, node.cornerRadius] : null;
  if ("topLeftRadius" in node) return [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius];
  return null;
}

function layout(node) {
  if (!("layoutMode" in node) || node.layoutMode === "NONE") return null;
  return {
    mode: node.layoutMode,
    wrap: node.layoutWrap === "WRAP",
    gap: node.itemSpacing || 0,
    crossGap: node.counterAxisSpacing || 0,
    padding: [node.paddingTop || 0, node.paddingRight || 0, node.paddingBottom || 0, node.paddingLeft || 0],
    main: node.primaryAxisAlignItems,
    cross: node.counterAxisAlignItems,
  };
}

const lineHeight = (lh, size) => (!lh || lh.unit === "AUTO" ? null : lh.unit === "PIXELS" ? lh.value : (lh.value / 100) * size);
const spacing = (ls, size) => (!ls ? 0 : ls.unit === "PIXELS" ? ls.value : (ls.value / 100) * size);

/** A text's runs: its words with their font, size, weight, colour and link, as Figma styles them. */
function textOf(node) {
  const segments = node.getStyledTextSegments(["fontName", "fontSize", "fontWeight", "fills", "textDecoration", "hyperlink", "lineHeight", "letterSpacing", "textCase"]);
  return {
    align: node.textAlignHorizontal,
    runs: segments.map((s) => {
      const fill = paints(s.fills).find((p) => p.type === "SOLID");
      return {
        t: s.characters,
        family: s.fontName.family,
        style: s.fontName.style,
        weight: s.fontWeight,
        size: s.fontSize,
        color: fill ? fill.color : null,
        line: lineHeight(s.lineHeight, s.fontSize),
        tracking: round(spacing(s.letterSpacing, s.fontSize)),
        underline: s.textDecoration === "UNDERLINE" || undefined,
        strike: s.textDecoration === "STRIKETHROUGH" || undefined,
        upper: s.textCase === "UPPER" || undefined,
        href: s.hyperlink && s.hyperlink.type === "URL" ? s.hyperlink.value : undefined,
      };
    }),
  };
}

const VECTORS = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE", "ELLIPSE"];

/** Reads a frame: its tree, the picture hashes it uses, and the vector shapes to photograph. */
async function readFrame(frame) {
  const origin = frame.absoluteBoundingBox || { x: frame.x, y: frame.y };
  const hashes = new Set();
  const shots = [];
  let count = 0;
  function walk(node) {
    if (node.visible === false || count >= NODES_MAX) return null;
    count += 1;
    const box = node.absoluteBoundingBox;
    if (!box) return null;
    const fills = "fills" in node && node.type !== "TEXT" ? paints(node.fills) : [];
    for (const fill of fills) if (fill.type === "IMAGE") hashes.add(fill.hash);
    const out = {
      id: node.id,
      type: node.type,
      name: node.name.slice(0, 60),
      box: [round(box.x - origin.x), round(box.y - origin.y), round(box.width), round(box.height)],
      opacity: node.opacity === undefined || node.opacity === 1 ? undefined : round(node.opacity),
      fills: fills.length > 0 ? fills : undefined,
      stroke: "strokes" in node && typeof node.strokeWeight === "number" && node.strokeWeight > 0 ? (paints(node.strokes).find((p) => p.type === "SOLID") || {}).color : undefined,
      strokeWeight: "strokes" in node && typeof node.strokeWeight === "number" && node.strokeWeight > 0 && paints(node.strokes).length > 0 ? node.strokeWeight : undefined,
      corners: corners(node) || undefined,
      shadows: "effects" in node && shadows(node.effects).length > 0 ? shadows(node.effects) : undefined,
      layout: layout(node) || undefined,
      clips: "clipsContent" in node && node.clipsContent ? true : undefined,
    };
    if (node.type === "TEXT") {
      out.text = textOf(node);
    } else if (VECTORS.indexOf(node.type) >= 0 && shots.length < PICTURES_MAX) {
      // A drawn shape (an icon, a line, a logo) is sent as its picture.
      out.shot = `shot:${node.id}`;
      shots.push(node);
    } else if ("children" in node) {
      out.children = node.children.map(walk).filter(Boolean);
    }
    return out;
  }
  const tree = walk(frame);
  return { tree, hashes: [...hashes], shots, cut: count >= NODES_MAX };
}

/** A picture's type from its first bytes: only what Kaizena Flow's library takes. */
function typeOf(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/** The selection as the window sends it: the frames (the widest is the computer's, one at phone width the phone's) and their pictures. */
async function readSelection() {
  const frames = figma.currentPage.selection.filter((n) => ["FRAME", "COMPONENT", "INSTANCE", "SECTION"].indexOf(n.type) >= 0).slice(0, 2);
  if (frames.length === 0) return { problem: "none" };
  frames.sort((a, b) => b.width - a.width);
  const desktop = frames[0];
  const mobile = frames.length > 1 && frames[1].width <= 600 ? frames[1] : null;
  const read = [await readFrame(desktop)].concat(mobile ? [await readFrame(mobile)] : []);
  const pictures = [];
  const hashes = new Set();
  for (const frame of read) for (const hash of frame.hashes) hashes.add(hash);
  for (const hash of hashes) {
    if (pictures.length >= PICTURES_MAX) break;
    const image = figma.getImageByHash(hash);
    if (!image) continue;
    const bytes = await image.getBytesAsync();
    // A GIF, or another type the library does not take, is left out: the page is built without that picture.
    const type = typeOf(bytes);
    if (type) pictures.push({ key: `image:${hash}`, bytes, type });
  }
  for (const frame of read) {
    for (const node of frame.shots) {
      if (pictures.length >= PICTURES_MAX) break;
      try {
        const bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
        pictures.push({ key: `shot:${node.id}`, bytes, type: "image/png" });
      } catch {
        // A shape Figma cannot draw is left out; the page is built without it.
      }
    }
  }
  return {
    file: figma.root.name.slice(0, 120),
    desktop: { name: desktop.name.slice(0, 120), width: desktop.width, height: desktop.height, tree: read[0].tree, cut: read[0].cut },
    mobile: mobile ? { name: mobile.name.slice(0, 120), width: mobile.width, height: mobile.height, tree: read[1].tree, cut: read[1].cut } : null,
    pictures,
  };
}

const hexOf = (c) => `#${[c.r, c.g, c.b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;

/** A variable's colour in a mode: an alias followed to the colour it names, in the same mode by its name or its collection's first. */
async function resolved(value, modeName, depth) {
  if (!value || depth > 5) return null;
  if (value.type === "VARIABLE_ALIAS") {
    const target = await figma.variables.getVariableByIdAsync(value.id);
    if (!target) return null;
    const collection = await figma.variables.getVariableCollectionByIdAsync(target.variableCollectionId);
    if (!collection) return null;
    const mode = collection.modes.find((m) => m.name === modeName) || collection.modes.find((m) => m.modeId === collection.defaultModeId);
    return mode ? resolved(target.valuesByMode[mode.modeId], modeName, depth + 1) : null;
  }
  return typeof value.r === "number" ? value : null;
}

/** The file's colours and type, as a look is made of them (D898 F3): its colour styles, its colour variables in each mode, its text styles. */
async function readLook(store) {
  const colours = [];
  for (const style of await figma.getLocalPaintStylesAsync()) {
    const paint = style.paints.find((p) => p.visible !== false && p.type === "SOLID");
    if (paint) colours.push({ name: style.name.slice(0, 120), color: hexOf(paint.color) });
  }
  if (figma.variables) {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const byId = new Map(collections.map((c) => [c.id, c]));
    for (const variable of await figma.variables.getLocalVariablesAsync("COLOR")) {
      if (colours.length >= COLOURS_MAX) break;
      const collection = byId.get(variable.variableCollectionId);
      if (!collection) continue;
      for (const mode of collection.modes) {
        const value = await resolved(variable.valuesByMode[mode.modeId], mode.name, 0);
        if (value) colours.push({ name: variable.name.slice(0, 120), color: hexOf(value), mode: mode.name.slice(0, 60), main: mode.modeId === collection.defaultModeId });
      }
    }
  }
  const text = [];
  for (const style of (await figma.getLocalTextStylesAsync()).slice(0, TEXT_STYLES_MAX)) {
    text.push({
      name: style.name.slice(0, 120),
      family: style.fontName.family,
      style: style.fontName.style,
      size: style.fontSize,
      line: lineHeight(style.lineHeight, style.fontSize),
      tracking: round(spacing(style.letterSpacing, style.fontSize)),
      upper: style.textCase === "UPPER" || undefined,
    });
  }
  return { file: figma.root.name.slice(0, 120), install: figma.root.getPluginData(lookKey(store)) || null, colours: colours.slice(0, COLOURS_MAX), text };
}

figma.ui.onmessage = async (message) => {
  if (!message || typeof message.type !== "string") return;
  if (message.type === "open" && typeof message.url === "string") figma.openExternal(message.url);
  else if (message.type === "token-get") figma.ui.postMessage({ type: "token", value: (await figma.clientStorage.getAsync(TOKEN_KEY)) || null });
  else if (message.type === "token-set") await figma.clientStorage.setAsync(TOKEN_KEY, message.value || null);
  else if (message.type === "read") {
    try {
      figma.ui.postMessage({ type: "selection", value: await readSelection() });
    } catch {
      figma.ui.postMessage({ type: "selection", value: { problem: "unreadable" } });
    }
  } else if (message.type === "read-look") {
    try {
      figma.ui.postMessage({ type: "look", value: await readLook(message.store) });
    } catch {
      figma.ui.postMessage({ type: "look", value: { problem: "unreadable" } });
    }
  } else if (message.type === "look-made" && typeof message.id === "string") {
    try {
      figma.root.setPluginData(lookKey(message.store), message.id);
    } catch {
      // A file the person may only view keeps nothing: the next send makes a new look.
    }
  } else if (message.type === "selected-ask") figma.ui.postMessage({ type: "selected", count: framesSelected() });
  else if (message.type === "close") figma.closePlugin();
};

function framesSelected() {
  return figma.currentPage.selection.filter((n) => ["FRAME", "COMPONENT", "INSTANCE", "SECTION"].indexOf(n.type) >= 0).length;
}

figma.on("selectionchange", () => figma.ui.postMessage({ type: "selected", count: framesSelected() }));
