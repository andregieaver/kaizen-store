import { PIECE_GROUPS, STORE_PARTS, STORE_PIECES } from "../store-parts";

type Copy = { name: string; hint: string };

/**
 * The shop's components and pieces as the page builder names them (D113, D312): their English is in `src/lib/store-parts.ts`, which
 * the builder draws from anyway, so this area is server-only (`SERVER_AREAS` in `admin-text.ts`) and a page that draws the builder in
 * another language hands it down (`useHandedText("storeParts")`); in English the builder reads `store-parts.ts` itself. Nothing is
 * added to the first scripts of other screens (`e2e/signed-in/admin-scripts.spec.ts`).
 */
export const storePartsEn = {
  /** Every component (`STORE_PARTS`) and piece (`STORE_PIECES`) by its key. */
  parts: Object.fromEntries([...Object.entries(STORE_PARTS), ...Object.entries(STORE_PIECES)].map(([key, part]) => [key, { name: part.name, hint: part.hint }])) as Record<
    string,
    Copy
  >,
  /** The working pages that come in pieces (`PIECE_GROUPS`), by route. */
  groups: Object.fromEntries(PIECE_GROUPS.map((group) => [group.route, { name: group.name, hint: group.hint }])) as Record<string, Copy>,
};

export type StorePartsMessages = typeof storePartsEn;
