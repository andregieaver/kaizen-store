import { BRANDS_DEFAULTS, type BrandsBlock } from "./page-content";
import { valueAt } from "./responsive";
import type { Size } from "./breakpoints";

/**
 * How many logos are in a row at a screen size (D204): the owner's value for the size (`at.*.columns`, else the block's own for Extra
 * large), and with none set for the size or a larger one the block's columns on computers, at most four on Medium and two on Small. In a carousel they are
 * the logos seen at once.
 */
export function brandColumns(block: Pick<BrandsBlock, "columns" | "at">, size: Size): number {
  const base = block.columns ?? BRANDS_DEFAULTS.columns;
  const chain: Record<Size, readonly ("lg" | "md" | "sm")[]> = { xl: [], lg: ["lg"], md: ["md", "lg"], sm: ["sm", "md", "lg"] };
  if (chain[size].some((s) => block.at?.[s]?.columns !== undefined)) return valueAt(block, "columns", size) ?? base;
  if (size === "md") return Math.min(4, base);
  if (size === "sm") return Math.min(2, base);
  return base;
}
