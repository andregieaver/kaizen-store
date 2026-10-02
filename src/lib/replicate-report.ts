import { CSS_MAX } from "./custom-css";
import { BLOCKS_MAX, ROWS_MAX, pageBlockSchema } from "./page-content";
import type { ReplicaLogEntry, ReplicaNote, ReplicaPass, ReplicaSummary } from "./replicate";
import type { Dropped, PartInfo } from "./replicate-build";
import { indexByPath, walk, type Box, type CaptureHit, type CaptureNode, type PageCapture } from "./replicate-capture";
import { BAND, stretchMatch, TOLERANCE, type Raster } from "./replicate-diff";
import type { Analysis } from "./replicate-prompts";

/**
 * The report a copy leaves for whoever improves the replicator (D150): what the original contains, what the copy lacks,
 * where it differs and by how much, each gap with its evidence and the files that would change. It is counted and measured
 * in code; the only words that are a model's are marked as the AI's. The owner can copy it as one piece of Markdown and hand
 * it to a developer (or an assistant) as the brief for the next change to the converter, the extractor or the builder.
 */

export type ReportSeverity = "high" | "medium" | "low";
/** Who has to change: the replicator (extractor, converter, patches) or the page builder (a component it lacks). */
export type ReportArea = "replicator" | "builder" | "both";

export type ReportFinding = {
  id: string;
  severity: ReportSeverity;
  area: ReportArea;
  title: string;
  /** What was counted or measured, with where in the original. */
  evidence: string[];
  /** The change that would close the gap, concretely. */
  change: string;
  /** The files to start in. */
  where: string[];
};

export type Census = {
  nodes: number;
  capped: boolean;
  hidden: number;
  tags: Record<string, number>;
  headings: number[];
  links: number;
  buttons: number;
  controls: { total: number; types: Record<string, number>; samples: CaptureHit[] };
  embeds: { host: string; title: string; y: number }[];
  gradients: { total: number; samples: CaptureHit[] };
  /** Pieces of content (words, pictures) placed absolutely: a collage, not a flow. */
  placed: { total: number; samples: CaptureHit[] };
  styles: { boxShadow: number; textShadow: number; transform: number; filter: number; translucent: number; absolute: number; grid: number; flex: number };
  hints: Record<string, { total: number; samples: CaptureHit[] }>;
  extras: NonNullable<PageCapture["extras"]> | null;
  fixed: string[];
  viewport: { desktop: number; phone: number | null };
  docWidth: { desktop: number; phone: number | null };
  heights: { desktop: number; phone: number | null };
};

export type ReportRow = {
  index: number;
  id: string;
  y: number;
  height: number;
  phoneY: number | null;
  phoneHeight: number | null;
  /** The copy's own height of this row at the last check, to compare with `height`. */
  copyHeight: number | null;
  copyPhoneHeight: number | null;
  label: string;
  sel: string;
  match: { desktop: number | null; phone: number | null };
  columns: number;
  blocks: { label: string; sel: string; y: number }[];
};

export type ReportDeviation = { id: string; label: string; kind: PartInfo["kind"]; row: number; viewport: "computers" | "phones"; /** Copy minus original, in pixels: x, y, width, height. */ d: [number, number, number, number] };

/** What the last check of the copy found, part by part. */
export type FinalDiff = {
  rows: { id: string; desktop: number | null; phone: number | null; copy: Box | null; copyM: Box | null }[];
  off: ReportDeviation[];
};

export type ReplicaReport = {
  version: 1;
  createdAt: string;
  source: { url: string; title: string; lang: string; description: string };
  outcome: ReplicaSummary["outcome"];
  problem: string | null;
  settings: { passesAsked: number; passesRun: number; stoppedEarly: boolean; vision: { used: boolean; why: string | null } };
  result: { desktop: number | null; phone: number | null; heights: { desktop: { original: number; copy: number } | null; phone: { original: number; copy: number } | null }; counts: ReplicaSummary["counts"]; words: number };
  passes: { iteration: number; desktop: number; phone: number | null; weakest: { y: number; height: number; match: number }[]; changes: string[]; ai?: ReplicaPass["ai"] }[];
  census: Census;
  rows: ReportRow[];
  deviations: ReportDeviation[];
  dropped: Dropped[];
  assets: {
    pictures: { found: number; kept: number; failed: { url: string; why: string }[] };
    videos: { found: number; kept: number; failed: { url: string; why: string }[] };
    graphics: { found: number; kept: number };
    fonts: { family: string; chars: number; installed: string | null }[];
  };
  analysis: Analysis | null;
  css: { length: number | null; limit: number; trimmed: string | null };
  warnings: string[];
  limits: { rows: number; blocks: number };
  findings: ReportFinding[];
};

// ---------------------------------------------------------------------------
// What the builder has, and what the converter uses of it
// ---------------------------------------------------------------------------

/** Blocks for any page, from the builder's own schema; the shop's and the site's own parts are not for a copied page. */
const SPECIAL_BLOCKS = new Set(["product", "site", "storePart", "plans", "search", "customField", "fieldLoop"]);
export const BUILDER_BLOCKS: readonly string[] = pageBlockSchema.options.map((option) => String(option.shape.type.value)).filter((type) => !SPECIAL_BLOCKS.has(type));
/** What `buildReplica()` makes. A block the builder has and this list lacks is one the converter could use but does not. */
export const CONVERTER_BLOCKS: readonly string[] = ["heading", "richText", "button", "image", "video", "separator"];

// ---------------------------------------------------------------------------
// The original, counted
// ---------------------------------------------------------------------------

const HINTS: Record<string, RegExp> = {
  carousel: /(^|[.\-_#])(carousel|slider|swiper|slick|splide|flickity|glide|embla|owl)([.\-_]|$)/i,
  tabs: /(^|[.\-_#])(tabs?|tablist|tabpanel|tab-panel)([.\-_]|$)/i,
  accordion: /(accordion|collapsible|expandable|faq)/i,
  marquee: /(marquee|ticker)/i,
  modal: /(^|[.\-_#])(modal|popup|lightbox|drawer|offcanvas)([.\-_]|$)/i,
  map: /(^|[.\-_#])(map|leaflet|mapbox|gmap)([.\-_]|$)/i,
  countdown: /(countdown|timer)/i,
  parallax: /(parallax)/i,
  lottie: /(lottie|rive)/i,
};

const hasWords = (n: CaptureNode) => (n.runs ?? []).some((run) => !run.br && (run.t ?? "").trim() !== "");
const at = (hit: { sel: string; y: number }) => `${hit.sel || "(unnamed)"} at ${hit.y}px`;

export function censusOf(desktop: PageCapture, mobile: PageCapture | null): Census {
  const tags: Record<string, number> = {};
  const headings = [0, 0, 0, 0, 0, 0];
  const controls: Census["controls"] = { total: 0, types: {}, samples: [] };
  const embeds: Census["embeds"] = [];
  const gradients: Census["gradients"] = { total: 0, samples: [] };
  const placed: Census["placed"] = { total: 0, samples: [] };
  const styles = { boxShadow: 0, textShadow: 0, transform: 0, filter: 0, translucent: 0, absolute: 0, grid: 0, flex: 0 };
  const hints: Census["hints"] = {};
  let nodes = 0;
  let links = 0;
  let buttons = 0;
  for (const n of walk(desktop.root)) {
    nodes += 1;
    tags[n.tag] = (tags[n.tag] ?? 0) + 1;
    if (/^h[1-6]$/.test(n.tag)) headings[Number(n.tag[1]) - 1] += 1;
    if (n.href) links += 1;
    if (n.button) buttons += 1;
    const sel = n.sel ?? n.tag;
    const y = Math.round(n.box[1]);
    if (n.media?.kind === "control") {
      controls.total += 1;
      controls.types[n.media.type] = (controls.types[n.media.type] ?? 0) + 1;
      if (controls.samples.length < 8) controls.samples.push({ sel, y, note: n.media.label || n.media.type });
    }
    if (n.media?.kind === "embed" && embeds.length < 12) {
      let host = n.media.url;
      try {
        host = new URL(n.media.url).hostname;
      } catch {
        /* keep the address */
      }
      embeds.push({ host, title: n.media.title, y });
    }
    const image = n.s.backgroundImage ?? "";
    if (image.includes("gradient(")) {
      gradients.total += 1;
      if (gradients.samples.length < 6) gradients.samples.push({ sel, y });
    }
    if (n.s.boxShadow && n.s.boxShadow !== "none") styles.boxShadow += 1;
    if (n.s.textShadow && n.s.textShadow !== "none") styles.textShadow += 1;
    if (n.s.transform && n.s.transform !== "none") styles.transform += 1;
    if (n.s.filter && n.s.filter !== "none") styles.filter += 1;
    if (n.s.opacity && Number(n.s.opacity) < 1) styles.translucent += 1;
    if (n.s.position === "absolute") {
      styles.absolute += 1;
      if (n.media?.kind === "img" || (n.runs !== undefined && hasWords(n))) {
        placed.total += 1;
        if (placed.samples.length < 6) placed.samples.push({ sel, y });
      }
    }
    if (/grid/.test(n.s.display ?? "")) styles.grid += 1;
    if (/flex/.test(n.s.display ?? "")) styles.flex += 1;
    if (n.sel) {
      for (const [kind, pattern] of Object.entries(HINTS)) {
        if (!pattern.test(n.sel)) continue;
        const entry = (hints[kind] ??= { total: 0, samples: [] });
        entry.total += 1;
        if (entry.samples.length < 4) entry.samples.push({ sel, y });
      }
    }
  }
  return {
    nodes,
    capped: desktop.left.capped,
    hidden: desktop.left.hidden,
    tags,
    headings,
    links,
    buttons,
    controls,
    embeds,
    gradients,
    placed,
    styles,
    hints,
    extras: desktop.extras ?? null,
    fixed: desktop.left.fixed,
    viewport: { desktop: desktop.viewport.w, phone: mobile?.viewport.w ?? null },
    docWidth: { desktop: desktop.docWidth, phone: mobile?.docWidth ?? null },
    heights: { desktop: desktop.docHeight, phone: mobile?.docHeight ?? null },
  };
}

// ---------------------------------------------------------------------------
// The copy against the original, part by part
// ---------------------------------------------------------------------------

type CopySide = { original: Raster; copy: Raster; scale: number; capture: PageCapture };

function idBoxes(capture: PageCapture): Map<string, Box> {
  const found = new Map<string, Box>();
  for (const n of walk(capture.root)) if (n.id) found.set(n.id, n.box);
  return found;
}

/** How each row of the copy matches its stretch of the original, and which parts are furthest from their original box. */
export function finalDiffOf(parts: PartInfo[], desktop: CopySide, phone: CopySide | null, limit = 30): FinalDiff {
  const copyD = idBoxes(desktop.capture);
  const copyM = phone ? idBoxes(phone.capture) : null;
  const rowIndex = new Map<string, number>();
  parts.filter((p) => p.kind === "row").forEach((p, i) => rowIndex.set(p.id, i + 1));
  const rows = parts
    .filter((p) => p.kind === "row")
    .map((p) => ({
      id: p.id,
      desktop: p.target ? stretchMatch(desktop.original, desktop.copy, desktop.scale, p.target[1], p.target[3]) : null,
      phone: phone && p.targetM ? stretchMatch(phone.original, phone.copy, phone.scale, p.targetM[1], p.targetM[3]) : null,
      copy: copyD.get(p.id) ?? null,
      copyM: copyM?.get(p.id) ?? null,
    }));
  const off: ReportDeviation[] = [];
  const measure = (viewport: ReportDeviation["viewport"], target: (p: PartInfo) => Box | null, copies: Map<string, Box> | null) => {
    if (!copies) return;
    for (const p of parts) {
      const want = target(p);
      const have = copies.get(p.id);
      if (!want || !have) continue;
      const d = [have[0] - want[0], have[1] - want[1], have[2] - want[2], have[3] - want[3]].map((v) => Math.round(v)) as [number, number, number, number];
      if (d.some((v) => Math.abs(v) > 3)) off.push({ id: p.id, label: p.label ?? p.kind, kind: p.kind, row: rowIndex.get(p.row) ?? 0, viewport, d });
    }
  };
  measure("computers", (p) => p.target, copyD);
  measure("phones", (p) => p.targetM, copyM);
  off.sort((a, b) => Math.max(...b.d.map(Math.abs)) - Math.max(...a.d.map(Math.abs)));
  return { rows, off: off.slice(0, limit) };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type ReportFacts = {
  now: string;
  url: string;
  outcome: ReplicaSummary["outcome"];
  problem: string | null;
  iterationsAsked: number;
  stoppedEarly: boolean;
  vision: { used: boolean; why: string | null };
  desktop: PageCapture;
  mobile: PageCapture | null;
  parts: PartInfo[];
  counts: ReplicaSummary["counts"];
  words: number;
  notes: ReplicaNote[];
  dropped: Dropped[];
  passes: ReplicaPass[];
  finalDiff: FinalDiff | null;
  assets: {
    pictures: Record<string, unknown | null>;
    videos: Record<string, unknown | null>;
    shots: Record<string, unknown | null>;
    fonts: Record<string, string | null>;
    failures: Record<string, string>;
  } | null;
  analysis: Analysis | null;
  cssLength: number | null;
  cssTrimmed: string | null;
  log: ReplicaLogEntry[];
};

const F = {
  build: "src/lib/replicate-build.ts",
  extract: "src/lib/replicate-extract.ts",
  capture: "src/lib/replicate-capture.ts",
  styles: "src/lib/replicate-styles.ts",
  patches: "src/lib/replicate-patches.ts",
  prompts: "src/lib/replicate-prompts.ts",
  calibrate: "src/lib/replicate-calibrate.ts",
  content: "src/lib/page-content.ts",
  rows: "src/lib/page-rows.ts",
  forms: "src/lib/forms.ts",
  motion: "src/lib/motion.ts",
  engine: "src/server/replicate.ts",
  assets: "src/server/replicate-assets.ts",
  builder: "src/components/admin/page-builder.tsx",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const examples = (hits: { sel: string; y: number }[], max = 4) => hits.slice(0, max).map(at).join("; ");
const SEVERITY_RANK: Record<ReportSeverity, number> = { high: 0, medium: 1, low: 2 };

/** The gaps, each with its evidence, the change that would close it and where to start. Ordered worst first. */
export function findingsOf(f: ReportFacts, census: Census, rows: ReportRow[]): ReportFinding[] {
  const out: ReportFinding[] = [];
  const add = (finding: ReportFinding) => out.push(finding);
  const droppedOf = (...kinds: Dropped["kind"][]) => f.dropped.filter((d) => kinds.includes(d.kind));
  const unused = BUILDER_BLOCKS.filter((b) => !CONVERTER_BLOCKS.includes(b));

  if (f.mobile === null) {
    const said = f.log.filter((l) => /phone/i.test(l.text) && (l.level === "warn" || l.level === "error")).map((l) => l.text);
    add({
      id: "no-phone",
      severity: "high",
      area: "replicator",
      title: "The page was not looked at at a phone's width",
      evidence: said.length > 0 ? said.slice(0, 3) : ["No phone capture was kept for this job."],
      change: "Without a second capture the copy has the builder's own phone layout and no phone rules, so phones are not compared at all. Find why the second visit failed (the reason is in the evidence): a site's bot protection, a redirect to an app page, a timeout on a heavy page. The second visit's error was swallowed before; it is now logged and tried twice.",
      where: [F.engine + " (stepOpen)", "src/lib/replicate-open.ts (openOriginal, newPage)"],
    });
  }

  // -- Content the copy lacks ------------------------------------------------
  const fields = droppedOf("form-field");
  if (fields.length > 0 || census.controls.total > 0) {
    add({
      id: "forms",
      severity: "high",
      area: "replicator",
      title: "Forms are left out",
      evidence: [
        `${plural(census.controls.total, "form field")} on the page (${Object.entries(census.controls.types).map(([type, n]) => `${n} ${type}`).join(", ")}).`,
        `Where: ${examples(census.controls.samples)}.`,
        "None of them is in the copy: the builder's form blocks need a recipient the original does not reveal.",
      ],
      change:
        "Read each `<form>` as a unit in the extractor (its controls in order with label, placeholder, type, required, select options, and its submit button's text). In the converter, map a form with one email field to a `newsletter` block and any other to an `emailForm` block with those fields, leave its recipients empty, and put a plain note in the summary that the owner must set where it is sent before publishing. Search/filter forms (one text field and a button) are better left out with a note.",
      where: [F.extract + " (mediaOf: controls have no form grouping)", F.build + " (skipped.controls, makeBlock)", F.forms, F.content + " (emailForm, newsletter blocks)"],
    });
  }
  const nested = droppedOf("nested-boxes");
  if (nested.length > 0) {
    add({
      id: "nested",
      severity: "high",
      area: "builder",
      title: "Boxes inside boxes side by side are stacked",
      evidence: [`${plural(nested.length, "section")} have columns whose boxes hold their own columns: ${examples(nested)}.`, "A row holds columns and a column holds blocks; a column cannot hold another row, so the inner boxes are stacked one under the other and the layout differs."],
      change:
        "Either let a column hold a row (a nested row with the same settings, capped at two levels so the CSS and the editor stay manageable), or add a `group` block that lays out its own children in a grid or a flex row. Then make `rowSpecs()` in the converter emit the nested structure instead of setting `nested` and stacking.",
      where: [F.content + " (PageColumn, ROW_LAYOUTS)", F.rows, F.build + " (rowSpecs, spec.nested)", F.builder],
    });
  }
  const shapes = droppedOf("shape");
  if (shapes.length > 0) {
    add({
      id: "shapes",
      severity: shapes.length >= 5 ? "medium" : "low",
      area: "both",
      title: "Decorative boxes have no block",
      evidence: [`${plural(shapes.length, "decorative box", "decorative boxes")} left out (empty boxes with paint: overlays, blobs, cards behind text, icon tiles): ${examples(shapes)}.`],
      change:
        "Add a `box` (shape) block to the builder: a fixed or fluid size, background colour or gradient, border, radius and shadow, no content; or let a column carry such a box as a background layer. Then make the converter's leaf handling (`makeBlock`, the 'thin painted box is a line' branch) emit it for any painted box that has no children, instead of dropping it.",
      where: [F.build + " (makeBlock, skipped.shapes)", F.content + " (a new block type, next to separator)", F.builder + " (BLOCK_TYPES, BLOCK_EDITORS)"],
    });
  }
  const photographed = droppedOf("graphic-unphotographed");
  if (photographed.length > 0) {
    add({
      id: "graphics",
      severity: "medium",
      area: "replicator",
      title: "Graphics drawn on the page could not be kept",
      evidence: [`${plural(photographed.length, "graphic")} (vector graphics, canvases, widgets) could not be photographed and are left out: ${examples(photographed)}.`],
      change: "In `openOriginal()` photograph every element marked `data-rp` with a wait for it to paint and a transparent background; for an `svg`, prefer reading its markup and keeping it as a file (the picture pipeline accepts SVG) over a screenshot. Report the reason a photograph failed (zero size, off screen, cross-origin canvas) in the note.",
      where: ["src/lib/replicate-open.ts (elements)", F.extract + " (data-rp)", F.build + " (makeBlock, input.shot)"],
    });
  }
  const embeds = census.embeds.filter((e) => !/youtube|youtu\.be|vimeo/i.test(e.host));
  if (embeds.length > 0) {
    add({
      id: "embeds",
      severity: "medium",
      area: "both",
      title: "Embedded widgets (iframes) are not carried over",
      evidence: embeds.map((e) => `${e.host}${e.title ? ` (“${e.title}”)` : ""} at ${e.y}px`),
      change: `Only YouTube and Vimeo embeds become video blocks; any other iframe is photographed or dropped. The builder has an \`html\` block: check whether it may hold an iframe from an allowlist of hosts (maps, booking and review widgets) and, if not, add an \`embed\` block with that allowlist, then map these iframes to it.`,
      where: [F.build + " (embedSource, makeBlock)", F.content + " (html block)", "src/components/page-block.tsx"],
    });
  }

  // -- Interactive patterns --------------------------------------------------
  const details = census.tags["details"] ?? 0;
  const accordionHints = census.hints["accordion"]?.total ?? 0;
  const tabsHints = census.hints["tabs"]?.total ?? 0;
  const tabRoles = (census.extras?.roles ?? []).filter((r) => /tab/.test(r.note ?? ""));
  if (details > 0 || accordionHints > 0 || tabsHints > 0 || tabRoles.length > 0) {
    const evidence: string[] = [];
    if (details > 0) evidence.push(`${plural(details, "<details> element")} (native accordions).`);
    if (accordionHints > 0) evidence.push(`Accordion-like boxes by class: ${examples(census.hints["accordion"].samples)}.`);
    if (tabsHints > 0 || tabRoles.length > 0) evidence.push(`Tab-like boxes: ${examples([...(census.hints["tabs"]?.samples ?? []), ...tabRoles])}.`);
    add({
      id: "tabs-accordions",
      severity: "medium",
      area: "replicator",
      title: "Accordions and tabs are copied as plain stacked text",
      evidence: [...evidence, `The builder has ${BUILDER_BLOCKS.filter((b) => ["tabs", "accordion", "faq"].includes(b)).map((b) => `\`${b}\``).join(", ")} blocks, but the converter only makes ${CONVERTER_BLOCKS.map((b) => `\`${b}\``).join(", ")}; every panel is shown open.`],
      change: "Recognise the pattern in the extractor (a `<details>` with its `<summary>`; elements with `role=tablist/tab/tabpanel`; repeated sibling boxes with a clickable heading) and keep the panels' text even when hidden (the extractor skips hidden boxes, so closed panels are lost today: read `details` content and `aria-hidden` panels by their text). Then emit an `accordion` or `tabs` block from `makeBlock` with those items.",
      where: [F.extract + " (visible(), nodeOf)", F.build + " (makeBlock)", F.content + " (accordion, tabs, faq blocks)"],
    });
  }
  if (census.placed.total >= 3) {
    add({
      id: "free-layout",
      severity: census.placed.total >= 6 ? "high" : "medium",
      area: "builder",
      title: "Content placed by position (a collage) has no component",
      evidence: [`${plural(census.placed.total, "picture or text")} placed absolutely over their section, not laid out in a flow: ${examples(census.placed.samples)}.`, "Rows lay content out in columns, so a collage is copied as columns and stacks on phones, with its pieces in the wrong places."],
      change: "Add a free-layout container to the builder: a box with a size (or aspect ratio) whose blocks are placed by offsets and sizes in percent, kept in proportion at any width and stacked on phones in reading order. Read each placed piece's offset against its container in the converter (the extractor has the boxes) and emit them as the container's blocks.",
      where: [F.content + " (a new row or column kind)", F.rows, F.builder, F.build + " (rowSpecs, makeBlock)"],
    });
  }
  const carousel = census.hints["carousel"]?.total ?? 0;
  const scrollers = census.extras?.total.scrollers ?? 0;
  if (carousel > 0) {
    add({
      id: "carousel",
      severity: "medium",
      area: "builder",
      title: "Sliders that move by script have no component",
      evidence: [
        `Slider-like boxes by class: ${examples(census.hints["carousel"].samples)}.`,
        ...(scrollers > 0 ? [`${plural(scrollers, "box")} scroll sideways by themselves and are copied as scrolling rows (the cards keep their widths): ${examples(census.extras!.scrollers)}.`] : []),
        `A slider that is moved by script (a transform, not scrolling) shows only the slide in view; arrows, dots and autoplay are not copied. The builder has no slider block (blocks: ${BUILDER_BLOCKS.join(", ")}).`,
      ],
      change: "Add a `carousel` (slider) block to the builder: a list of slides (picture, heading, text, button), arrows and dots, swipe on phones, optional autoplay that respects reduced motion. In the extractor keep the boxes of slides that are translated out of view (they are skipped as off-screen unless the box scrolls by itself), so the converter can fill the block's slides from them.",
      where: [F.content + " (a new block type)", F.builder, "src/components/page-block.tsx", F.extract + " (the off-screen skip in nodeOf)", F.build + " (makeBlock, the scroller track in the row loop)"],
    });
  }
  const modals = census.hints["modal"]?.total ?? 0;
  if (modals > 0) {
    add({
      id: "modals",
      severity: "low",
      area: "replicator",
      title: "Pop-ups and drawers are not copied",
      evidence: [`Pop-up-like boxes by class: ${examples(census.hints["modal"].samples)}.`],
      change: "Hidden pop-ups are skipped as invisible. The builder has modal rows (D121); read a hidden dialog's content and emit it as a row with `modal` set and a click trigger on the button that opened it.",
      where: [F.extract + " (visible)", F.build, "src/lib/page-modal.ts"],
    });
  }
  const tables = census.tags["table"] ?? 0;
  if (tables > 0) {
    add({
      id: "tables",
      severity: "medium",
      area: "builder",
      title: "Tables have no component",
      evidence: [`${plural(tables, "table")} on the page. Cells are read as separate pieces of text and laid out by the grid heuristics, which loses rows and columns.`],
      change: "Add a `table` block (header row, rows, column alignment) to the builder and map `<table>` to it in the converter, reading cells' text and `colspan` as the block's data.",
      where: [F.content, F.builder, F.build + " (rowSpecs)"],
    });
  }

  // -- What the page does ----------------------------------------------------
  const pseudo = census.extras?.total.pseudo ?? 0;
  if (pseudo > 0) {
    add({
      id: "pseudo",
      severity: pseudo >= 10 ? "medium" : "low",
      area: "replicator",
      title: "Content drawn by ::before and ::after is not copied",
      evidence: [`${plural(pseudo, "element")} draw something with a pseudo-element (icons, quote marks, badges, bullets, decorative shapes): ${(census.extras?.pseudo ?? []).slice(0, 5).map((p) => `${at(p)} (${p.note})`).join("; ")}.`],
      change: "Read `getComputedStyle(el, '::before')` for its text content, size, colour and background in the extractor and add it as a synthetic child node (`tag: '#pseudo'`), so the converter can emit a text run or a shape block. A decorative shape needs the `box` block above.",
      where: [F.extract + " (observe)", F.capture + " (CaptureNode)", F.build],
    });
  }
  const animated = census.extras?.total.animated ?? 0;
  if (animated > 0) {
    add({
      id: "animation",
      severity: "low",
      area: "replicator",
      title: "Animations are not copied",
      evidence: [`${plural(animated, "element")} run a CSS animation: ${(census.extras?.animated ?? []).slice(0, 5).map((a) => `${at(a)} (${a.note})`).join("; ")}.`, "Scroll reveals driven by scripts are not detected at all."],
      change: "Map the common cases (fade or slide up on enter, a marquee) to the builder's motion catalogue (D128: `partFx()`, `ENTER_EFFECTS`) by part id, and note the rest. Detect scroll reveals by comparing opacity/transform of the same box before and after a scroll to the box.",
      where: [F.motion, F.build, F.extract + " (observe)"],
    });
  }
  const sticky = census.extras?.total.sticky ?? 0;
  if (sticky > 0 || census.fixed.length > 0) {
    add({
      id: "sticky",
      severity: "low",
      area: "replicator",
      title: "Sticky and floating elements are left out",
      evidence: [
        ...(census.fixed.length > 0 ? [`Fixed to the screen and left out: ${census.fixed.slice(0, 6).join(", ")}.`] : []),
        ...(sticky > 0 ? [`${plural(sticky, "element")} stick while scrolling: ${examples(census.extras!.sticky)}.`] : []),
      ],
      change: "A sticky or fixed top bar is the site's header: build it as a header page (D80) with the page's menu block and `overlay` where it lies over the first row, instead of a row of the page. Floating widgets (chat, cookie banners) stay out on purpose.",
      where: ["src/lib/site-layout.ts", F.build, F.extract + " (the fixed skip in nodeOf)"],
    });
  }
  const style = census.styles;
  const uncarried = [
    style.transform > 0 ? `${style.transform} with a transform` : "",
    style.filter > 0 ? `${style.filter} with a filter` : "",
    style.translucent > 0 ? `${style.translucent} with opacity below 1` : "",
  ].filter(Boolean);
  if (uncarried.length > 0) {
    add({
      id: "style-gaps",
      severity: "low",
      area: "replicator",
      title: "Some styles are read but not written to the copy",
      evidence: [`Elements ${uncarried.join(", ")}; the converter writes none of them (`+ "`filter` and `opacity` are allowed by the style whitelist; `transform` is not)."],
      change: "Write `opacity` and `filter` where they are set on a part, and decide on `transform` (only `rotate` and `scale` with small values are safe to allow in `PROPS`).",
      where: [F.build + " (the part's declarations)", F.styles + " (PROPS)"],
    });
  }
  if (census.gradients.total > 0) {
    add({
      id: "gradients",
      severity: "low",
      area: "replicator",
      title: "Gradients are only carried on sections",
      evidence: [`${plural(census.gradients.total, "box", "boxes")} have a gradient background: ${examples(census.gradients.samples)}.`, ...(droppedOf("background-layers").length > 0 ? [`A section made of several rows keeps its layered background on the first row only: ${examples(droppedOf("background-layers"))}.`] : [])],
      change: "Write a box's gradient as its `background-image` where it is a column or a block (today only rows and painted columns get one) and repeat a section's layered background across its rows with `continued()`, not only a single picture.",
      where: [F.build + " (paintDecl, continued)"],
    });
  }

  // -- Assets ----------------------------------------------------------------
  if (f.assets) {
    const failedPictures = Object.entries(f.assets.failures).filter(([key]) => !key.startsWith("font:") && f.assets!.pictures[key] === null);
    if (failedPictures.length > 0) {
      const reasons = new Map<string, string[]>();
      for (const [url, why] of failedPictures) reasons.set(why, [...(reasons.get(why) ?? []), url]);
      add({
        id: "pictures",
        severity: failedPictures.length >= 3 ? "high" : "medium",
        area: "replicator",
        title: "Pictures could not be downloaded",
        evidence: [...reasons.entries()].map(([why, urls]) => `${plural(urls.length, "picture")}: ${why} — e.g. ${urls[0].slice(0, 110)}`),
        change: "Group by the reason. 'Not a picture' on a URL that serves HTML usually means hotlink protection or a lazy-load placeholder: take the real address from `data-src`/`srcset` in the extractor. A size limit may need a larger cap for hero pictures. A refused address is the private-network guard and is correct.",
        where: [F.assets, "src/server/replicate-fetch.ts", F.extract + " (mediaOf: currentSrc, data-src)"],
      });
    }
    const failedVideos = Object.entries(f.assets.failures).filter(([key]) => f.assets!.videos[key] === null);
    if (failedVideos.length > 0) {
      add({
        id: "videos",
        severity: "medium",
        area: "replicator",
        title: "Videos could not be copied",
        evidence: failedVideos.map(([url, why]) => `${why} — ${url.slice(0, 110)}`),
        change: "Streamed videos (HLS/DASH) cannot be kept as a file. Use the poster as a still picture (done) and, for hosted players, map the embed to a video block's link when the host is YouTube or Vimeo.",
        where: [F.assets + " (saveVideo)", F.build + " (makeBlock)"],
      });
    }
    const fontsFailed = Object.entries(f.assets.fonts).filter(([, installed]) => !installed);
    if (fontsFailed.length > 0) {
      add({
        id: "fonts",
        severity: "medium",
        area: "both",
        title: "Typefaces that are not in Google Fonts",
        evidence: fontsFailed.map(([family]) => `${family} (${f.desktop.fonts.find((x) => x.family === family)?.chars ?? 0} characters set in it)`),
        change: "The original's own stack is used, which falls back to a system font on a visitor's device. Either map the family to the nearest Google font (a table of look-alikes, shown to the owner as a suggestion) or let an owner upload a font file for a site (the font module only installs Google families).",
        where: ["src/server/fonts.ts", "src/lib/fonts.ts", F.build + " (fontOf)", F.assets + " (installFamily)"],
      });
    }
  }

  // -- Where the copy differs ---------------------------------------------------
  const worst = rows
    .filter((r) => r.match.desktop !== null && r.match.desktop < 90)
    .sort((a, b) => (a.match.desktop ?? 100) - (b.match.desktop ?? 100))
    .slice(0, 5);
  if (worst.length > 0) {
    add({
      id: "weak-rows",
      severity: worst.some((r) => (r.match.desktop ?? 100) < 75) ? "high" : "medium",
      area: "replicator",
      title: "Rows that still differ most from the original",
      evidence: worst.map((r) => {
        const height = r.copyHeight !== null ? `, copy ${r.copyHeight}px tall against ${r.height}px` : "";
        const phone = r.match.phone !== null ? `, ${r.match.phone}% on phones` : "";
        return `Row ${r.index} (${r.sel || r.label}, ${r.y}–${r.y + r.height}px): ${r.match.desktop}% on computers${phone}${height}. Holds ${r.blocks.slice(0, 4).map((b) => b.label).join("; ") || "nothing"}.`;
      }),
      change: "Open the row's original and the copy side by side (the report's outline names each row's selector and blocks). The usual causes, in order: a background picture or gradient that is not carried, text set in a font that is not installed, a column that should be nested, or content the converter dropped (see the findings above for this row's y range). Fix the cause in the converter, not by hand, so the next page gains from it.",
      where: [F.build, F.calibrate],
    });
  }
  const last = f.passes[f.passes.length - 1];
  if (last) {
    const heights = last.desktop.heights;
    const delta = heights.copy - heights.original;
    if (Math.abs(delta) > Math.max(24, heights.original * 0.015)) {
      add({
        id: "height",
        severity: Math.abs(delta) > heights.original * 0.05 ? "high" : "medium",
        area: "replicator",
        title: "The copy is not as tall as the original",
        evidence: [`On computers the copy is ${heights.copy}px tall and the original ${heights.original}px (${delta > 0 ? "+" : ""}${delta}px).`, ...(last.mobile ? [`On phones ${last.mobile.heights.copy}px against ${last.mobile.heights.original}px.`] : [])],
        change: "Find the first row whose copy box starts to drift from the original (the 'largest differences' table is sorted by size; the first row with a growing y offset is where the drift starts) and fix the margin or line-height rule that causes it; `calibrate()` only corrects what is measured per part, so a drift from an unmeasured part (a wrapped heading, a list) survives.",
        where: [F.calibrate, F.build + " (placeAt, ROW_GAP)"],
      });
    }
    if (last.mobile && last.desktop.match - last.mobile.match > 10) {
      add({
        id: "phone",
        severity: "medium",
        area: "replicator",
        title: "The phone layout is much weaker than the computer layout",
        evidence: [`${last.desktop.match}% on computers against ${last.mobile.match}% on phones.`, ...(census.docWidth.phone !== null && census.viewport.phone !== null && census.docWidth.phone > census.viewport.phone + 2 ? [`The original is ${census.docWidth.phone}px wide on a ${census.viewport.phone}px screen: it scrolls sideways.`] : [])],
        change: "Compare each row's phone box (`targetM`) with the copy's: rows that are hidden or restructured on phones in the original (a menu that becomes a button, columns that stack in a different order) need their own phone rules; check `gridM` in the converter and the `display: none` rows.",
        where: [F.build + " (gridM, rowM, sideBySide)", F.calibrate],
      });
    }
    if (f.passes.length > 1) {
      const first = f.passes[0];
      if (last.desktop.match - first.desktop.match < 0.5) {
        add({
          id: "no-gain",
          severity: "low",
          area: "replicator",
          title: "The improving passes did not raise the match",
          evidence: [`${first.desktop.match}% before and ${last.desktop.match}% after ${plural(f.passes.length - 1, "pass", "passes")}.`],
          change: "What is left is structural (the findings above), which spacing corrections cannot reach. Spend the next change on the largest finding rather than on more passes.",
          where: [F.calibrate, F.patches],
        });
      }
    }
  }
  const cut = droppedOf("rows-cut", "blocks-cut", "columns-cut");
  if (cut.length > 0) {
    add({
      id: "limits",
      severity: "medium",
      area: "builder",
      title: "The builder's size limits cut the page",
      evidence: cut.map((d) => `${d.text}${d.y ? ` at ${d.y}px` : ""}.`),
      change: `A page holds at most ${ROWS_MAX} rows, ${BLOCKS_MAX} blocks and six columns per row. For long pages the converter should merge neighbouring rows with the same background into one row (several blocks in one column) before it reaches the limit; for more than six boxes side by side, use a grid-template wrap (a row of 3 + 3) rather than cutting.`,
      where: [F.build + " (rowSpecs, ROWS_MAX, BLOCKS_MAX)", F.content],
    });
  }
  if (f.cssLength !== null && f.cssLength > CSS_MAX * 0.8) {
    add({
      id: "css",
      severity: f.cssTrimmed ? "high" : "medium",
      area: "replicator",
      title: "The copy's style budget is nearly used",
      evidence: [`${f.cssLength.toLocaleString("en")} of ${CSS_MAX.toLocaleString("en")} characters${f.cssTrimmed ? `; ${f.cssTrimmed}` : ""}.`],
      change: "Write fewer rules: drop declarations that equal the browser's default or the inherited value, and share declarations between parts with the same look (one class per look instead of one rule per part).",
      where: [F.styles + " (renderStyles)", F.build + " (put)"],
    });
  }

  // -- The AI's part -----------------------------------------------------------
  const refused = new Map<string, number>();
  for (const pass of f.passes) {
    for (const line of pass.ai?.refused ?? []) {
      const match = /^rp\d+: ([a-z-]+) /.exec(line);
      if (match) refused.set(match[1], (refused.get(match[1]) ?? 0) + 1);
    }
  }
  if (refused.size > 0) {
    add({
      id: "ai-refused",
      severity: "low",
      area: "replicator",
      title: "Changes the AI asked for that the whitelist refused",
      evidence: [...refused.entries()].sort((a, b) => b[1] - a[1]).map(([property, n]) => `${property}: refused ${n} time${n === 1 ? "" : "s"}`),
      change: "Each is a property the AI thought it needed and the style whitelist or its range check turned down. Add the safe ones to `PROPS` (with a value kind) or widen their bounds, and leave the unsafe ones refused.",
      where: [F.styles + " (PROPS, cleanDecl)", F.patches + " (BOUNDS)"],
    });
  }
  const couldNot = [...new Set(f.passes.flatMap((p) => p.ai?.couldNotFix ?? []))];
  if (couldNot.length > 0) {
    add({
      id: "ai-could-not-fix",
      severity: "medium",
      area: "both",
      title: "What the AI said it could not fix",
      evidence: couldNot.slice(0, 8).map((n) => `AI: ${n}`),
      change: "These are the AI's own words about differences it saw but had no allowed change for. Each is a candidate for a new converter feature or builder component; check them against the findings above.",
      where: [F.prompts, F.patches],
    });
  }
  const hard = f.analysis?.hard ?? [];
  if (hard.length > 0) {
    add({
      id: "ai-hard",
      severity: "low",
      area: "both",
      title: "What the AI flagged as hard to copy",
      evidence: hard.slice(0, 8).map((n) => `AI: ${n}`),
      change: "The AI's reading of the page before building, kept as a hint for what the converter may lack.",
      where: [F.prompts + " (analyse)"],
    });
  }
  if (!f.vision.used) {
    add({
      id: "no-vision",
      severity: "low",
      area: "replicator",
      title: "The AI did not look at the pictures",
      evidence: [f.vision.why ?? "No text model that sees pictures is set up for the site."],
      change: "The copy was corrected by measuring only. Choose a text model that sees pictures under AI settings, then run the same page again to see what the AI adds.",
      where: [F.engine + " (stepExamine, stepRefine)"],
    });
  }
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

function outlineOf(parts: PartInfo[], desktop: PageCapture, diff: FinalDiff | null): ReportRow[] {
  const index = indexByPath(desktop.root);
  const rows: ReportRow[] = [];
  const byId = new Map<string, ReportRow>();
  for (const p of parts) {
    if (p.kind === "row") {
      const scored = diff?.rows.find((r) => r.id === p.id);
      const row: ReportRow = {
        index: rows.length + 1,
        id: p.id,
        y: Math.round(p.target?.[1] ?? 0),
        height: Math.round(p.target?.[3] ?? 0),
        phoneY: p.targetM ? Math.round(p.targetM[1]) : null,
        phoneHeight: p.targetM ? Math.round(p.targetM[3]) : null,
        copyHeight: scored?.copy ? Math.round(scored.copy[3]) : null,
        copyPhoneHeight: scored?.copyM ? Math.round(scored.copyM[3]) : null,
        label: p.label ?? "row",
        sel: index.get(p.path)?.sel ?? "",
        match: { desktop: scored?.desktop ?? null, phone: scored?.phone ?? null },
        columns: 0,
        blocks: [],
      };
      rows.push(row);
      byId.set(p.id, row);
    } else {
      const row = byId.get(p.row);
      if (!row) continue;
      if (p.kind === "column") row.columns += 1;
      else row.blocks.push({ label: p.label ?? "block", sel: index.get(p.path)?.sel ?? index.get(p.path)?.tag ?? "", y: Math.round(p.target?.[1] ?? 0) });
    }
  }
  return rows;
}

const WARN_LOG = new Set(["warn", "error"]);

export function buildReport(f: ReportFacts): ReplicaReport {
  const census = censusOf(f.desktop, f.mobile);
  const rows = outlineOf(f.parts, f.desktop, f.finalDiff);
  const last = f.passes[f.passes.length - 1] ?? null;
  const pictures = f.assets ? Object.values(f.assets.pictures) : [];
  const videos = f.assets ? Object.values(f.assets.videos) : [];
  const shots = f.assets ? Object.values(f.assets.shots) : [];
  const failures = f.assets?.failures ?? {};
  return {
    version: 1,
    createdAt: f.now,
    source: { url: f.url, title: f.desktop.title, lang: f.desktop.lang, description: f.desktop.description },
    outcome: f.outcome,
    problem: f.problem,
    settings: { passesAsked: f.iterationsAsked, passesRun: Math.max(0, f.passes.length - 1), stoppedEarly: f.stoppedEarly, vision: f.vision },
    result: {
      desktop: last?.desktop.match ?? null,
      phone: last?.mobile?.match ?? null,
      heights: { desktop: last ? last.desktop.heights : null, phone: last?.mobile ? last.mobile.heights : null },
      counts: f.counts,
      words: f.words,
    },
    passes: f.passes.map((p) => ({ iteration: p.iteration, desktop: p.desktop.match, phone: p.mobile?.match ?? null, weakest: p.desktop.weakest, changes: p.changes.slice(0, 12), ...(p.ai ? { ai: p.ai } : {}) })),
    census,
    rows,
    deviations: f.finalDiff?.off ?? [],
    dropped: f.dropped,
    assets: {
      pictures: { found: pictures.length, kept: pictures.filter(Boolean).length, failed: Object.entries(failures).filter(([url]) => f.assets && url in f.assets.pictures && f.assets.pictures[url] === null).slice(0, 15).map(([url, why]) => ({ url, why })) },
      videos: { found: videos.length, kept: videos.filter(Boolean).length, failed: Object.entries(failures).filter(([url]) => f.assets && url in f.assets.videos && f.assets.videos[url] === null).slice(0, 10).map(([url, why]) => ({ url, why })) },
      graphics: { found: shots.length, kept: shots.filter(Boolean).length },
      fonts: f.desktop.fonts.slice(0, 12).map((font) => ({ family: font.family, chars: font.chars, installed: f.assets && font.family in f.assets.fonts ? (f.assets.fonts[font.family] ?? null) : null })),
    },
    analysis: f.analysis,
    css: { length: f.cssLength, limit: CSS_MAX, trimmed: f.cssTrimmed },
    warnings: [...new Set(f.log.filter((l) => WARN_LOG.has(l.level)).map((l) => l.text))].slice(0, 25),
    limits: { rows: ROWS_MAX, blocks: BLOCKS_MAX },
    findings: findingsOf(f, census, rows),
  };
}

// ---------------------------------------------------------------------------
// Markdown: the brief
// ---------------------------------------------------------------------------

const pct = (n: number | null) => (n === null ? "n/a" : `${n}%`);
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ");

/** The report as Markdown, to paste as the brief for the next change to the replicator or the builder. */
export function reportMarkdown(r: ReplicaReport): string {
  const lines: string[] = [];
  const out = (...text: string[]) => lines.push(...text);
  let host = r.source.url;
  try {
    host = new URL(r.source.url).hostname;
  } catch {
    /* keep the address */
  }
  out(`# Page replicator report: ${host}`, "");
  out(
    "> Written by the page replicator for whoever improves it (the extractor, the converter or the page builder). Numbers are measured or counted in code; only text marked \"AI\" is a model's. Use it as the brief: every finding gives its evidence, the change that would close it and the files to start in. Background: `docs/page-replicator.md`, and the D150 entry in `CLAUDE.md`.",
    "",
  );
  out("## Verdict", "");
  out(`- Original: ${r.source.url}${r.source.title ? ` (“${r.source.title}”` : " ("}${r.source.lang ? `, lang ${r.source.lang}` : ""}), copied ${r.createdAt.slice(0, 16).replace("T", " ")} UTC.`);
  out(`- Outcome: **${r.outcome}**${r.problem ? ` — ${r.problem}` : ""}.`);
  out(`- Match with the original: **${pct(r.result.desktop)} on computers, ${pct(r.result.phone)} on phones** (${r.settings.passesRun} improving ${r.settings.passesRun === 1 ? "pass" : "passes"} of ${r.settings.passesAsked} asked${r.settings.stoppedEarly ? ", stopped early because the copy was as close as pixels allow" : ""}).`);
  if (r.result.heights.desktop) out(`- Height: copy ${r.result.heights.desktop.copy}px against ${r.result.heights.desktop.original}px on computers${r.result.heights.phone ? `; ${r.result.heights.phone.copy}px against ${r.result.heights.phone.original}px on phones` : ""}.`);
  out(`- Built: ${r.result.counts.rows} rows, ${r.result.counts.blocks} blocks (${r.result.counts.headings} headings, ${r.result.counts.texts} text, ${r.result.counts.pictures} pictures, ${r.result.counts.buttons} buttons, ${r.result.counts.videos} videos); ${r.result.words} words copied.`);
  out(`- The AI ${r.settings.vision.used ? "looked at the pictures" : `did not look at the pictures${r.settings.vision.why ? ` (${r.settings.vision.why})` : ""}`}.`);
  out("");

  out("## Findings, worst first", "");
  if (r.findings.length === 0) out("None: nothing was found that the copy lacks.", "");
  r.findings.forEach((finding, i) => {
    out(`### ${i + 1}. [${finding.severity} · ${finding.area === "builder" ? "builder component missing" : finding.area === "both" ? "builder and replicator" : "replicator"}] ${finding.title}`, "");
    out("Evidence:");
    for (const line of finding.evidence) out(`- ${line}`);
    out("", `Change: ${finding.change}`, "", `Start in: ${finding.where.map((w) => `\`${w}\``).join(", ")}`, "");
  });

  out("## Page outline (rows of the copy, with where each came from)", "");
  out("| # | y | height | selector in the original | match (computers / phones) | copy height | contents |", "|---|---|---|---|---|---|---|");
  for (const row of r.rows) {
    out(`| ${row.index} | ${row.y} | ${row.height} | ${cell(clip(row.sel || "—", 40))} | ${pct(row.match.desktop)} / ${pct(row.match.phone)} | ${row.copyHeight ?? "—"} | ${cell(clip(`${row.columns} col; ${row.blocks.slice(0, 5).map((b) => b.label).join("; ")}${row.blocks.length > 5 ? `; +${row.blocks.length - 5}` : ""}`, 150))} |`);
  }
  out("");

  if (r.deviations.length > 0) {
    out("## Largest differences, part by part (copy minus original, px: x, y, width, height)", "");
    out("| row | part | viewport | dx | dy | dw | dh |", "|---|---|---|---|---|---|---|");
    for (const d of r.deviations.slice(0, 20)) out(`| ${d.row} | ${cell(clip(d.label, 60))} | ${d.viewport} | ${d.d.join(" | ")} |`);
    out("");
  }

  if (r.dropped.length > 0) {
    out("## Left out or simplified (where in the original)", "");
    for (const d of r.dropped.slice(0, 40)) out(`- ${d.kind}: \`${d.sel || "—"}\` at ${d.y}px${d.text ? ` — ${d.text}` : ""}`);
    out("");
  }

  out("## The original, counted", "");
  const c = r.census;
  out(`- ${c.nodes} boxes read${c.capped ? " (the limit was reached: only the first part of a very large page)" : ""}; ${c.hidden} hidden boxes skipped. ${c.links} links, ${c.buttons} buttons. Headings h1–h6: ${c.headings.join("/")}.`);
  out(`- Widths: ${c.viewport.desktop}px computers${c.viewport.phone ? `, ${c.viewport.phone}px phones` : ""}; the page is ${c.docWidth.desktop}px wide on computers${c.docWidth.phone ? ` and ${c.docWidth.phone}px on phones` : ""}; ${c.heights.desktop}px tall${c.heights.phone ? ` (${c.heights.phone}px on phones)` : ""}.`);
  out(`- Media: ${["img", "svg", "canvas", "video", "iframe", "picture"].map((t) => `${c.tags[t] ?? 0} ${t}`).join(", ")}; forms: ${c.controls.total} fields; tables: ${c.tags["table"] ?? 0}; details: ${c.tags["details"] ?? 0}.`);
  out(`- Layout: ${c.styles.grid} grid and ${c.styles.flex} flex boxes, ${c.styles.absolute} absolutely placed.`);
  out(`- Looks: ${c.styles.boxShadow} box shadows, ${c.styles.textShadow} text shadows, ${c.gradients.total} gradients, ${c.styles.transform} transforms, ${c.styles.filter} filters, ${c.styles.translucent} translucent.`);
  if (c.extras) out(`- Behaviour seen: ${c.extras.total.pseudo} pseudo-element contents, ${c.extras.total.animated} animations, ${c.extras.total.sticky} sticky, ${c.extras.total.scrollers} sideways scrollers, ${c.extras.total.roles} role-marked elements.`);
  const hintLines = Object.entries(c.hints).map(([kind, h]) => `${kind} ×${h.total} (${examples(h.samples, 2)})`);
  if (hintLines.length > 0) out(`- Patterns by class name: ${hintLines.join("; ")}.`);
  out("");

  out("## Assets", "");
  out(`- Pictures: ${r.assets.pictures.kept} of ${r.assets.pictures.found} kept. Videos: ${r.assets.videos.kept} of ${r.assets.videos.found}. Graphics photographed: ${r.assets.graphics.kept} of ${r.assets.graphics.found}.`);
  for (const p of r.assets.pictures.failed) out(`  - picture failed: ${p.url.slice(0, 120)} — ${p.why}`);
  for (const v of r.assets.videos.failed) out(`  - video failed: ${v.url.slice(0, 120)} — ${v.why}`);
  out(`- Typefaces by use: ${r.assets.fonts.map((x) => `${x.family} (${x.chars} chars, ${x.installed ? `installed as ${x.installed}` : x.installed === null ? "not installed" : "installed"})`).join("; ") || "none"}.`);
  out(`- Style: ${r.css.length === null ? "n/a" : `${r.css.length.toLocaleString("en")} of ${r.css.limit.toLocaleString("en")} characters`}${r.css.trimmed ? ` — ${r.css.trimmed}` : ""}.`, "");

  if (r.analysis) {
    out("## The AI's reading of the original (AI)", "");
    out(r.analysis.summary);
    if (r.analysis.palette.length > 0) out("", `Colours: ${r.analysis.palette.map((p) => `${p.hex}${p.use ? ` (${p.use})` : ""}`).join(", ")}.`);
    if (r.analysis.typography) out(`Type: ${r.analysis.typography}`);
    if (r.analysis.sections.length > 0) out("", "Sections:", ...r.analysis.sections.map((s) => `- ${s.name}${s.purpose ? ` — ${s.purpose}` : ""}`));
    out("");
  }

  out("## Passes", "");
  out("| pass | computers | phones | weakest stretches (computers) | what changed |", "|---|---|---|---|---|");
  for (const p of r.passes) {
    out(`| ${p.iteration === 0 ? "first copy" : p.iteration} | ${p.desktop}% | ${pct(p.phone)} | ${p.weakest.map((w) => `${w.y}–${w.y + w.height}px ${w.match}%`).join("; ") || "—"} | ${cell(clip(p.changes.join("; ") || "—", 200))} |`);
  }
  out("");
  const aiPasses = r.passes.filter((p) => p.ai);
  if (aiPasses.length > 0) {
    out("### What the AI said each pass (AI)", "");
    for (const p of aiPasses) {
      out(`- Pass ${p.iteration}: ${p.ai!.summary || "(no summary)"} (${p.ai!.applied} changes applied, ${p.ai!.refused.length} refused)`);
      for (const n of p.ai!.couldNotFix) out(`  - could not fix: ${n}`);
    }
    out("");
  }

  if (r.warnings.length > 0) {
    out("## Warnings the job logged", "");
    for (const w of r.warnings) out(`- ${w}`);
    out("");
  }

  out("## How to read the numbers", "");
  out(`- Match: the page is shrunk to a quarter; a square is right when each colour channel is within ${TOLERANCE}/255 of the original's; the page is judged in bands of ${BAND} squares. A row's match is the same measure over that row's stretch of the original. Heights compare the copy's page with the original's.`);
  out(`- The builder's general blocks are ${BUILDER_BLOCKS.map((b) => `\`${b}\``).join(", ")}; the converter makes ${CONVERTER_BLOCKS.map((b) => `\`${b}\``).join(", ")}. A page holds at most ${r.limits.rows} rows and ${r.limits.blocks} blocks.`);
  out("- To reproduce: run Replicate on the same address with the same number of passes; compare this report's findings with the new one.");
  return `${lines.join("\n")}\n`;
}
