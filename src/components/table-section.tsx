import { t } from "@/lib/i18n";
import type { TableBlock } from "@/lib/page-content";
import type { GridPlace } from "@/server/content-grid";
import { placeLang } from "@/server/place-lang";

import { TableView } from "./table-view";

/**
 * A table (D194) where a page shows it: what it says only to screen readers (its icons' names, D201, and an untitled section, D197) in the
 * language of the place (`placeLang()`: a store's market, or the language of Kaizena Flow's own page).
 */
export async function TableSection({ block, place }: { block: TableBlock; place: GridPlace }) {
  const lang = await placeLang(place);
  const m = t(lang);
  // The icons' names load only where a table is drawn (the storefront messages budget).
  const { iconWords } = await import("@/lib/icon-words");
  return <TableView block={block} words={{ icons: iconWords(lang), section: m.tableSection }} />;
}
