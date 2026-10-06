import Link from "next/link";
import type { ReactNode } from "react";

import { INVENTORY_TABS, inventoryPaths, type InventoryTab } from "@/lib/inventory-admin";

/**
 * The head of every Inventory page (wave 3, D172, `docs/wave-3-inventory.md` 2.2): the title, what the page is for and the tabs (the list, the history,
 * the locations, import and export). Full width like the other admin pages and in the admin's tokens only; the active tab carries `aria-current`, so it
 * works without a script. A page reached from a tab (one import) gives `back`.
 */
export function InventoryHead({ slug, active, title, intro, back }: { slug: string; active: InventoryTab; title: string; intro: ReactNode; back?: { href: string; label: string } }) {
  const paths = inventoryPaths(slug);
  return (
    <header className="flex flex-col gap-3">
      {back && (
        <Link href={back.href} className="text-sm text-muted underline underline-offset-2">
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="max-w-3xl text-sm text-muted">{intro}</p>
      </div>
      <nav aria-label="Inventory" className="flex flex-wrap gap-1 border-b border-border text-sm">
        {INVENTORY_TABS.map((tab) => (
          <Link
            key={tab.id}
            href={paths[tab.id]}
            aria-current={active === tab.id ? "page" : undefined}
            className="-mb-px border-b-2 border-transparent px-3 py-2 text-muted hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
