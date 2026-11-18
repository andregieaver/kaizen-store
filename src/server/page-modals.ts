import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";

import { pagesTag } from "./pages";
import { owned } from "./owned";

/**
 * Whether a site has a published modal (D121) that opens by itself (a timer
 * or exit intent) and is not shown every time: it remembers that a visitor
 * closed it, which is a preference the cookie page lists and the visitor is
 * asked about (D58). Kept until the site's pages change. The flag is the
 * generated column `remembered_modal`; its rule is the column's expression in
 * `src/db/schema.ts`, and changing the rule is a migration that drops and adds
 * the column.
 */
export async function usesRememberedModals(storeId: string | null): Promise<boolean> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(storeId));
  const [row] = await readDb().execute<{ found: boolean }>(modalsQuery(storeId));
  return Boolean(row?.found);
}

/** The statement behind usesRememberedModals(), apart so a test can explain it (bloat review step 2.16). */
export function modalsQuery(storeId: string | null) {
  return sql`
    select exists (
      select 1 from commerce.pages
      where ${owned(storeId)} and remembered_modal
    ) as found
  `;
}
