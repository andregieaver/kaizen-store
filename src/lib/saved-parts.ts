import { z } from "zod";

import {
  BLOCKS_MAX,
  pageBlockSchema,
  pageColumnSchema,
  pageRowSchema,
  type PageBlock,
  type PageColumn,
  type PageRow,
} from "./page-content";

/**
 * Rows, columns and components saved to use again (D46). Shared by the
 * page builder (in the browser) and the server, which checks them again.
 */

export const SAVED_NAME_MAX = 80;
export const SAVED_PARTS_MAX = 200;

export type SavedPartKind = "row" | "column" | "block";

export type SavedPart = { id: string; name: string; updatedAt: string } & (
  | { kind: "row"; content: PageRow }
  | { kind: "column"; content: PageColumn }
  | { kind: "block"; content: PageBlock }
);

export const SAVED_KIND_LABELS: Record<SavedPartKind, { one: string; many: string }> = {
  row: { one: "Row", many: "Rows" },
  column: { one: "Column", many: "Columns" },
  block: { one: "Component", many: "Components" },
};

const name = z
  .string()
  .trim()
  .min(1, "Give it a name.")
  .max(SAVED_NAME_MAX, `Keep the name under ${SAVED_NAME_MAX} characters.`);

const blocksOf = (part: { kind: SavedPartKind; content: unknown }): PageBlock[] =>
  part.kind === "row"
    ? (part.content as PageRow).columns.flatMap((c) => c.blocks)
    : part.kind === "column"
      ? (part.content as PageColumn).blocks
      : [part.content as PageBlock];

const idsOf = (part: { kind: SavedPartKind; content: unknown }): string[] =>
  part.kind === "row"
    ? [(part.content as PageRow).id, ...(part.content as PageRow).columns.flatMap((c) => [c.id, ...c.blocks.map((b) => b.id)])]
    : part.kind === "column"
      ? [(part.content as PageColumn).id, ...(part.content as PageColumn).blocks.map((b) => b.id)]
      : [(part.content as PageBlock).id];

/** What the builder sends to save, with the checks shown to the admin. */
export const savedPartInput = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("row"), name, content: pageRowSchema }),
    z.object({ kind: z.literal("column"), name, content: pageColumnSchema }),
    z.object({ kind: z.literal("block"), name, content: pageBlockSchema }),
  ])
  .superRefine((part, ctx) => {
    if (blocksOf(part).length > BLOCKS_MAX) {
      ctx.addIssue({ code: "custom", message: `It holds more than ${BLOCKS_MAX} blocks.` });
    }
    const ids = idsOf(part);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "Two parts have the same id. Reload the page and try again." });
    }
  });

export type SavedPartInput = z.infer<typeof savedPartInput>;

/** A stored part, or null if it cannot be read (then it is not offered). */
export function parseSavedPart(row: { id: string; kind: string; name: string; content: unknown; updatedAt: string }): SavedPart | null {
  const parsed = savedPartInput.safeParse({ kind: row.kind, name: row.name, content: row.content });
  return parsed.success ? ({ id: row.id, updatedAt: row.updatedAt, ...parsed.data } as SavedPart) : null;
}
