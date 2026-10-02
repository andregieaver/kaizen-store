import "server-only";

import { isWorkingRole } from "@/lib/ab-site";
import type { PageRole } from "@/lib/page-roles";

import { siteTests, siteVersionContent, type SiteTest } from "./experiments";
import { pageForRole, type PublishedPage } from "./pages";

/**
 * The page a store chose for a place (D112), as this visitor sees it (D148, phase 9): the page, or, while a test of a working page runs
 * (the cart, the checkout, … by a part around the shop's own component) and the address carries the visitor's other version of it (`ab`, from
 * `resolveShop()`), that version's page. `test` is the running test of the page, if any, with the version drawn (`a` for the original), for
 * the marker that reports the exposure. Cached with the tests and the pages: a store without a test of it draws the page as it always did.
 */
export async function rolePageForVisitor(
  store: { id: string; pageRoles: Partial<Record<PageRole, string>> },
  role: PageRole,
  ab: Record<string, string> = {},
): Promise<{ page: PublishedPage | null; test: SiteTest | null; version: string }> {
  const page = await pageForRole(store, role);
  if (!page || !isWorkingRole(role)) return { page, test: null, version: "a" };
  const test = (await siteTests(store.id)).find((t) => t.kind === "role" && t.targetPageId === page.id) ?? null;
  const key = test ? ab[test.token] : undefined;
  if (test && key && key !== "a") {
    const version = await siteVersionContent(store.id, test.id, key);
    if (version) return { page: { ...page, content: version.content }, test, version: key };
  }
  return { page, test, version: "a" };
}
