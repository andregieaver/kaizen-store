import Link from "next/link";
import type { ReactNode } from "react";

import type { AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { INVENTORY_TABS, inventoryPaths, type InventoryTab } from "@/lib/inventory-admin";
import { MoreMenu } from "@/components/admin/orders/order-folds";
import { PageHeader } from "@/components/admin/ui";

const MAIN = new Set<InventoryTab>(["list", "history"]);

/**
 * The head of every Inventory page (wave 3, D172, `docs/wave-3-inventory.md` 2.2): the title, what the page is for and the tabs (the list, the history,
 * the locations, import and export). Full width like the other admin pages and in the admin's tokens only; the active tab carries `aria-current`, so it
 * works without a script. A page reached from a tab (one import) gives `back`. The tabs are in the admin's language (`lang`, D312 A5).
 */
export function InventoryHead({
  slug,
  active,
  title,
  intro,
  back,
  lang = "en",
}: {
  slug: string;
  active: InventoryTab;
  title: string;
  /** What the page is for; the list leaves it out and says what needs a look itself (round 7). */
  intro?: ReactNode;
  back?: { href: string; label: string };
  lang?: AdminLang;
}) {
  const paths = inventoryPaths(slug);
  const w = adminText(lang, "inventory").head;
  return (
    <header className="flex flex-col gap-3">
      {back && (
        <Link href={back.href} className="text-sm text-muted underline underline-offset-2">
          {back.label}
        </Link>
      )}
      <PageHeader title={<>{title}</>} description={intro ? <>{intro}</> : undefined} />
      {/* Round 7 (D624): the list and its history as tabs; the tools for more than one shelf under More, the open one shown as a tab. */}
      <nav aria-label={w.nav} className="flex flex-wrap items-end gap-1 border-b border-line text-sm">
        {INVENTORY_TABS.filter((tab) => MAIN.has(tab.id) || tab.id === active).map((tab) => (
          <Link
            key={tab.id}
            href={paths[tab.id]}
            aria-current={active === tab.id ? "page" : undefined}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-muted hover:text-ink aria-[current=page]:border-brand aria-[current=page]:font-medium aria-[current=page]:text-ink"
          >
            {w.tabs[tab.id]}
          </Link>
        ))}
        <div className="mb-1 ml-auto">
          <MoreMenu label={w.more}>
            {INVENTORY_TABS.filter((tab) => !MAIN.has(tab.id) && tab.id !== active).map((tab) => (
              <Link key={tab.id} href={paths[tab.id]} className="inline-flex min-h-10 items-center rounded-pill px-4 text-sm hover:bg-sunken">
                {w.tabs[tab.id]}
              </Link>
            ))}
          </MoreMenu>
        </div>
      </nav>
    </header>
  );
}
