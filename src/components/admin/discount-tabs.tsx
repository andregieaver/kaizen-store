import { DISCOUNT_TABS, discountTabHref, type DiscountTab } from "@/lib/discount-tabs";

import { AdminLink } from "./ui";

/**
 * The Discounts page's two tabs (ecosystem plan E3.7, D718): links, so each is an address of its own, the current one the strongest
 * contrast on the page (docs/admin-style.md: a black pill with white words).
 */
export function DiscountTabs({ storeSlug, current, words }: { storeSlug: string; current: DiscountTab; words: { label: string } & Record<DiscountTab, string> }) {
  return (
    <nav aria-label={words.label} className="flex flex-wrap gap-2" data-discount-tabs>
      {DISCOUNT_TABS.map((tab) => (
        <AdminLink
          key={tab}
          href={discountTabHref(storeSlug, tab)}
          aria-current={tab === current ? "page" : undefined}
          className={`inline-flex h-9 items-center rounded-pill px-4 text-body ${tab === current ? "bg-inverse text-inverse-ink" : "border border-edge bg-card text-ink hover:bg-sunken"}`}
        >
          {words[tab]}
        </AdminLink>
      ))}
    </nav>
  );
}
