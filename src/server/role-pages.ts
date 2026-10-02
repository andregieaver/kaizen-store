import "server-only";

import { isTestedPlace, type TestedPlace } from "@/lib/ab-site";
import type { PageRole } from "@/lib/page-roles";

import { siteTests, siteVersionContent, type SiteTest } from "./experiments";
import { pageForRole, type PublishedPage } from "./pages";

/**
 * A page a store chose for a place of its own, as this visitor sees it (D148, phases 9 and 10): the page, or, while a test of it runs
 * (a working page by a part around the shop's own component, the front page or the All products page whole or by a part) and the address
 * carries the visitor's other version of it (`ab`, from `resolveShop()`), that version's page. `test` is the running test of the page, if
 * any, with the version drawn (`a` for the original), for the marker that reports the exposure. Cached with the tests and the pages: a
 * store without a test of it draws the page as it always did.
 */
export async function placePageForVisitor(
  storeId: string,
  place: TestedPlace,
  page: PublishedPage | null,
  ab: Record<string, string> = {},
): Promise<{ page: PublishedPage | null; test: SiteTest | null; version: string }> {
  if (!page || !isTestedPlace(place)) return { page, test: null, version: "a" };
  const test = (await siteTests(storeId)).find((t) => t.kind === "role" && t.role === place && t.targetPageId === page.id) ?? null;
  const key = test ? ab[test.token] : undefined;
  if (test && key && key !== "a") {
    const version = await siteVersionContent(storeId, test.id, key);
    if (version) return { page: { ...page, content: version.content }, test, version: key };
  }
  return { page, test, version: "a" };
}

/** The page chosen for a role (D112) as this visitor sees it: `placePageForVisitor()` for the role's page. */
export async function rolePageForVisitor(
  store: { id: string; pageRoles: Partial<Record<PageRole, string>> },
  role: PageRole,
  ab: Record<string, string> = {},
): Promise<{ page: PublishedPage | null; test: SiteTest | null; version: string }> {
  return placePageForVisitor(store.id, role as TestedPlace, await pageForRole(store, role), ab);
}
