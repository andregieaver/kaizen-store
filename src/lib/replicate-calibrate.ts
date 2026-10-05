import { ROW_GAP, type PartInfo } from "./replicate-build";
import { bottomOf, walk, type Box, type PageCapture } from "./replicate-capture";
import { cleanDecl, ruleOf, type StyleModel } from "./replicate-styles";

/**
 * The copy measured against the original, part by part (D150): where the browser put each row and block of the copy
 * against where the original had it, and the spacing set right again. This is arithmetic, not judgement: a font that wraps one line
 * more pushes everything under it down, and the next block's space above is made smaller by as much, so the rest of the page
 * is where it was. The AI looks at what measuring cannot see (colours, weights, shapes). Run on each pass, at both widths.
 */

export type Calibration = {
  /** Blocks whose space above was changed, rows whose room above or below was changed. */
  blocks: number;
  rows: number;
  /** Parts of the original that are missing in the copy. */
  missing: number;
  /** Largest vertical error left in a row, in pixels (before the changes were made). */
  worst: number;
};

const ERROR = 1.5;
/** A space may become this negative: a line that is taller than the original's is pulled up, not cut. */
const MARGIN = { min: -160, max: 1200 };

/** The copy's boxes by the id of the part, from a capture of the copy's own page. */
export function boxesById(copy: PageCapture): Map<string, Box> {
  const found = new Map<string, Box>();
  for (const node of walk(copy.root)) if (node.id) found.set(node.id, node.box);
  return found;
}

const pixels = (value: string | undefined): number => {
  const match = value ? /^(-?\d+(?:\.\d+)?)px$/.exec(value) : null;
  return match ? Number(match[1]) : 0;
};

/**
 * Sets the vertical spacing of the model right by what was measured in the copy: `phone` for the phones' rules and boxes.
 * Rows keep their order; blocks inside a row are taken column by column.
 */
export function calibrate(model: StyleModel, parts: PartInfo[], copy: PageCapture, phone: boolean): Calibration {
  const boxes = boxesById(copy);
  const result: Calibration = { blocks: 0, rows: 0, missing: 0, worst: 0 };
  const side = phone ? "mobile" : "desktop";
  const targetOf = (part: PartInfo) => (phone ? part.targetM : part.target);

  const set = (id: string, suffix: string, property: string, value: number) => {
    const clean = cleanDecl(property, `${Math.round(value * 10) / 10}px`);
    if (clean !== null) ruleOf(model, id, suffix)[side][property] = clean;
  };
  // What a phone's rule says is only what differs from computers': the value in force is computers' where phones say nothing.
  const current = (id: string, property: string): number => pixelsOf(model, id, property, side);

  // Group the parts as the build made them: a row, then its columns each followed by its blocks.
  type Group = { row: PartInfo; blocks: PartInfo[][]; columns: PartInfo[] };
  const groups: Group[] = [];
  for (const part of parts) {
    if (part.kind === "row") groups.push({ row: part, blocks: [], columns: [] });
    else if (part.kind === "column") {
      groups[groups.length - 1]?.blocks.push([]);
      groups[groups.length - 1]?.columns.push(part);
    } else groups[groups.length - 1]?.blocks[groups[groups.length - 1].blocks.length - 1]?.push(part);
  }

  let previousBottomError = 0;
  for (const group of groups) {
    const target = targetOf(group.row);
    const at = boxes.get(group.row.id);
    if (!target) continue; // not on the page at this width
    if (!at) {
      result.missing += 1;
      continue;
    }
    // The space between this row and the one above: what the copy has beyond the original's.
    const topError = at[1] - target[1];
    const spacing = topError - previousBottomError;
    if (Math.abs(spacing) > ERROR) {
      set(group.row.id, "", "margin-top", Math.min(MARGIN.max, Math.max(-ROW_GAP, current(group.row.id, "margin-top") - spacing)));
      result.rows += 1;
    }
    result.worst = Math.max(result.worst, Math.abs(topError));

    // The blocks of each column, one under another: each moves by the error it added to the one above. Columns stacked one under another (at phones'
    // width) are measured each from its own top: what an upper column's change moves is the lower column's business only through its position, which
    // the upper one's change has already carried, so counting it again would overshoot (lampan.no: a footer's four stacked columns swung 137 px each way).
    let tallestLast = 0;
    let tallestBottom = -Infinity;
    let stackedLast = 0;
    let previousColumn: { target: Box; top: number } | null = null;
    group.blocks.forEach((column, columnIndex) => {
      const columnPart = group.columns[columnIndex];
      const columnTarget = columnPart ? targetOf(columnPart) : null;
      const columnHave = columnPart ? boxes.get(columnPart.id) : undefined;
      const stacked = Boolean(previousColumn && columnTarget && columnHave && columnTarget[1] >= bottomOf(previousColumn.target) - 2);
      const baseTarget = stacked && columnTarget ? columnTarget[1] : target[1];
      const baseCopy = stacked && columnHave ? columnHave[1] : at[1];
      let previous = 0;
      let lastBlock: { rel: number; bottom: number } | null = null;
      for (const block of column) {
        const goal = targetOf(block);
        const have = boxes.get(block.id);
        if (!goal) continue;
        if (!have) {
          result.missing += 1;
          continue;
        }
        const rel = have[1] - baseCopy - (goal[1] - baseTarget);
        const local = rel - previous;
        if (Math.abs(local) > ERROR) {
          set(block.id, "", "margin-top", Math.min(MARGIN.max, Math.max(MARGIN.min, current(block.id, "margin-top") - local)));
          result.blocks += 1;
        }
        previous = rel;
        lastBlock = { rel, bottom: bottomOf(have) };
      }
      if (columnTarget) previousColumn = { target: columnTarget, top: columnHave ? columnHave[1] : 0 };
      if (stacked) stackedLast += lastBlock?.rel ?? 0;
      else if (lastBlock && lastBlock.bottom > tallestBottom) {
        tallestBottom = lastBlock.bottom;
        tallestLast = lastBlock.rel;
      }
    });
    tallestLast += stackedLast;

    // The row's own height: its error, less what the blocks' changes will take away.
    const heightError = at[3] - target[3] - tallestLast;
    if (Math.abs(heightError) > ERROR) {
      const room = pixelsOf(model, group.row.id, "padding-bottom", side);
      set(group.row.id, "", "padding-bottom", Math.max(0, room - heightError));
      result.rows += 1;
    }
    previousBottomError = bottomOf(at) - bottomOf(target);
  }
  return result;
}

function pixelsOf(model: StyleModel, id: string, property: string, side: "desktop" | "mobile"): number {
  const rule = model.rules.find((r) => r.id === id && r.suffix === "");
  const own = rule?.[side][property];
  return pixels(own !== undefined || side === "desktop" ? own : rule?.desktop[property]);
}

/** A sentence about what a calibration changed, or null when nothing needed to move. */
export function calibrationWords(c: Calibration, where: "computers" | "phones"): string | null {
  if (c.blocks === 0 && c.rows === 0) return null;
  const parts = [c.blocks > 0 ? `${c.blocks} block${c.blocks === 1 ? "" : "s"}` : null, c.rows > 0 ? `${c.rows} row${c.rows === 1 ? "" : "s"}` : null].filter(Boolean);
  return `Spacing set right on ${parts.join(" and ")} for ${where} by measuring the copy against the original.`;
}
