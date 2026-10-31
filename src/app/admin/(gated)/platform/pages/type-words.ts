import type { PlatformSiteMessages } from "@/lib/admin-messages/platform-site.en";
import type { PageType } from "@/lib/page-content";

export type TypeWords = PlatformSiteMessages["pages"]["types"]["page"];

/** A type's words in the admin's language; Kaizena Flow has pages, articles, headers and footers (stores' product layouts and test versions are not its). */
export function typeWords(w: PlatformSiteMessages, type: PageType): TypeWords {
  const types: Partial<Record<PageType, TypeWords>> = w.pages.types;
  return types[type] ?? w.pages.types.page;
}
