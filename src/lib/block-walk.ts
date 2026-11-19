import type { PageBlock, PageColumn } from "./page-content";

/** Walking a block's own children (D208, D294): pure functions over block values, apart from the schemas (bloat review step 2.22). */

/** The block with each component it holds changed by `change` (D208, D294); the block itself when it holds none. */
export function mapChildBlocks(block: PageBlock, change: (child: PageBlock) => PageBlock): PageBlock {
  if (block.type === "columns") return mapInnerColumns(block, (column) => ({ ...column, blocks: column.blocks.map(change) }));
  if (block.type !== "faq" || !block.items.some((item) => item.blocks?.length)) return block;
  return { ...block, items: block.items.map((item) => (item.blocks?.length ? { ...item, blocks: item.blocks.map(change) } : item)) };
}

/** A Columns component with each of its columns changed by `change` (D294); any other block as it is. */
export function mapInnerColumns(block: PageBlock, change: (column: PageColumn) => PageColumn): PageBlock {
  return block.type === "columns" ? { ...block, columns: block.columns.map(change) } : block;
}
