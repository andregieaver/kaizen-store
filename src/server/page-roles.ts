import "server-only";

import { t } from "@/lib/i18n";
import { starterPage, type PageRole } from "@/lib/page-roles";
import { marketHome } from "@/lib/paths";

import type { Membership } from "./auth";
import { savePage, setPageRole } from "./pages";

/**
 * Makes a page for one of a store's special places (D112) from a starter that
 * looks like the standard page it replaces, in the store's main language,
 * publishes it and puts it in place. The owner then changes it in the builder.
 */
export async function createRolePage({ account, store }: Membership, role: PageRole): Promise<{ ok: true; id: string } | { ok: false; problems: string[] }> {
  const main = store.localization.locales[0];
  const market = store.markets[0];
  if (!main || !market) return { ok: false, problems: ["The store sells to no country yet."] };
  const content = starterPage(role, t(main.split("-")[0]), () => crypto.randomUUID(), marketHome(store.slug, market.slug));
  // The address is the role's own unless another page has taken it.
  let made: Awaited<ReturnType<typeof savePage>> | null = null;
  for (let n = 1; n <= 5; n++) {
    made = await savePage(account, store.id, null, { ...content, slug: n === 1 ? content.slug : `${content.slug}-${n}` }, { publish: true, type: "page" });
    if (made.ok || !made.problems.some((p) => /address|slug/i.test(p))) break;
  }
  if (!made || !made.ok) return { ok: false, problems: made ? made.problems : ["The page could not be made."] };
  const placed = await setPageRole(account, store.id, role, made.id);
  return placed.ok ? { ok: true, id: made.id } : placed;
}

