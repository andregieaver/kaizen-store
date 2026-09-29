import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";

import { pagesTag } from "./pages";

/**
 * Whether a site has a published modal (D121) that opens by itself (a timer
 * or exit intent) and is not shown every time: it remembers that a visitor
 * closed it, which is a preference the cookie page lists and the visitor is
 * asked about (D58). Kept until the site's pages change.
 */
export async function usesRememberedModals(storeId: string | null): Promise<boolean> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(storeId));
  const [row] = await readDb().execute<{ found: boolean }>(sql`
    select exists (
      select 1 from commerce.pages
      where store_id is not distinct from ${storeId}::uuid and published is not null
        and jsonb_path_exists(published, '$.rows[*].modal ? ((@.frequency == "session" || @.frequency == "days" || !exists(@.frequency)) && (@.triggers.exitIntent == true || exists(@.triggers.timer)))')
    ) as found
  `);
  return Boolean(row?.found);
}
