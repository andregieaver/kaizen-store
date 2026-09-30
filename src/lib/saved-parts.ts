import { z } from "zod";

import {
  BLOCKS_MAX,
  pageBlockSchema,
  pageColumnSchema,
  pageRowSchema,
  type PageBlock,
  type PageColumn,
  type PageRow,
  type PageText,
} from "./page-content";
import type { GlobalPart, Translations } from "./global-parts";
import { layoutBlocks, pageLayoutSchema, type PageLayout } from "./page-layout";
import { PART_SHARING, type PartSharing } from "./templates";

/**
 * Rows, columns and components saved to use again (D46). Shared by the
 * page builder (in the browser) and the server, which checks them again.
 */

export const SAVED_NAME_MAX = 80;
export const SAVED_PARTS_MAX = 200;

/** A whole page's layout is one too (D127): saved, shared and used as a template, never a global. */
export type SavedPartKind = "row" | "column" | "block" | "page";

export type SavedPart = {
  id: string;
  name: string;
  updatedAt: string;
  /** Global (D98): its uses on pages are kept the same as it. */
  global: boolean;
  /** A global's texts in the owner's other languages (D55), by their place in `content`. */
  translations: Translations;
  /** How many pages (drafts or live) use a global. */
  uses: number;
  /** Who else can use it as a template (D125); Kaizen's own are the marketplace's. */
  sharing: PartSharing;
} & (
  | { kind: "row"; content: PageRow }
  | { kind: "column"; content: PageColumn }
  | { kind: "block"; content: PageBlock }
  | { kind: "page"; content: PageLayout }
);

/** A global saved part as its uses are made from it (D98); null for one that is not global. */
export function globalOf(part: SavedPart): GlobalPart | null {
  return part.global && part.kind !== "page"
    ? { id: part.id, kind: part.kind, content: part.content, translations: part.translations }
    : null;
}

/** The owner's globals by id. */
export function globalsOf(parts: readonly SavedPart[]): Map<string, GlobalPart> {
  return new Map(parts.flatMap((part) => {
    const global = globalOf(part);
    return global ? [[part.id, global] as const] : [];
  }));
}

export const SAVED_KIND_LABELS: Record<SavedPartKind, { one: string; many: string }> = {
  row: { one: "Row", many: "Rows" },
  column: { one: "Column", many: "Columns" },
  block: { one: "Component", many: "Components" },
  page: { one: "Page layout", many: "Page layouts" },
};

const name = z
  .string()
  .trim()
  .min(1, "Give it a name.")
  .max(SAVED_NAME_MAX, `Keep the name under ${SAVED_NAME_MAX} characters.`);

const blocksOf = (part: { kind: SavedPartKind; content: unknown }): PageBlock[] =>
  part.kind === "page"
    ? layoutBlocks(part.content as PageLayout)
    : part.kind === "row"
      ? (part.content as PageRow).columns.flatMap((c) => c.blocks)
      : part.kind === "column"
        ? (part.content as PageColumn).blocks
        : [part.content as PageBlock];

const idsOf = (part: { kind: SavedPartKind; content: unknown }): string[] =>
  part.kind === "page"
    ? (part.content as PageLayout).rows.flatMap((r) => [r.id, ...r.columns.flatMap((c) => [c.id, ...c.blocks.map((b) => b.id)])])
    : part.kind === "row"
      ? [(part.content as PageRow).id, ...(part.content as PageRow).columns.flatMap((c) => [c.id, ...c.blocks.map((b) => b.id)])]
      : part.kind === "column"
        ? [(part.content as PageColumn).id, ...(part.content as PageColumn).blocks.map((b) => b.id)]
        : [(part.content as PageBlock).id];

/** Texts in other languages by their place (checked again against the content when saved, `cleanTranslations`). */
const translations = z
  .record(
    z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
    z.record(
      z.string().max(120),
      z.custom<PageText>((v) => typeof v === "string" || (typeof v === "object" && v !== null && !Array.isArray(v))),
    ),
  )
  .default({});

const shared = { name, global: z.boolean().default(false), translations, sharing: z.enum(PART_SHARING).default("private") };

/** What the builder sends to save, with the checks shown to the admin. */
export const savedPartInput = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("row"), content: pageRowSchema, ...shared }),
    z.object({ kind: z.literal("column"), content: pageColumnSchema, ...shared }),
    z.object({ kind: z.literal("block"), content: pageBlockSchema, ...shared }),
    z.object({ kind: z.literal("page"), content: pageLayoutSchema, ...shared }),
  ])
  .superRefine((part, ctx) => {
    if (part.kind === "page" && part.global) {
      ctx.addIssue({ code: "custom", message: "A whole page layout cannot be global." });
    }
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
export function parseSavedPart(row: {
  id: string;
  kind: string;
  name: string;
  content: unknown;
  updatedAt: string;
  global?: boolean;
  translations?: unknown;
  uses?: number;
  sharing?: string;
}): SavedPart | null {
  const parsed = savedPartInput.safeParse({
    kind: row.kind,
    name: row.name,
    content: row.content,
    global: row.global ?? false,
    translations: row.translations ?? {},
    sharing: row.sharing ?? "private",
  });
  return parsed.success ? ({ id: row.id, updatedAt: row.updatedAt, uses: row.uses ?? 0, ...parsed.data } as SavedPart) : null;
}
