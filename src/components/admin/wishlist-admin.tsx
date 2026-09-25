import Link from "next/link";

import { formatMoney } from "@/lib/money";
import { CART_ADD_STATUS, type CartAddRow, type CartAddStatus } from "@/server/wishlist-admin";

/** "Colour: Black · DEMO-MUG-BLACK", or the SKU alone. */
export function variantText(options: Record<string, string> | null, sku: string): string {
  const values = options ? Object.values(options).filter(Boolean) : [];
  return values.length > 0 ? `${values.join(", ")} · ${sku}` : sku;
}

/** The two views of the store's wishlists (D36): the lists, and what went from them to the cart and was bought. */
export function WishlistTabs({ storeSlug, current }: { storeSlug: string; current: "lists" | "activity" }) {
  const base = `/admin/${storeSlug}/wishlists`;
  const tabs = [
    { key: "lists", href: base, label: "Lists" },
    { key: "activity", href: `${base}/activity`, label: "From list to purchase" },
  ];
  return (
    <nav aria-label="Wishlist views" className="flex flex-wrap gap-2 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? "page" : undefined}
          className="rounded px-2 py-1 aria-[current=page]:bg-background aria-[current=page]:font-semibold"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

const STATUS_TONE: Record<CartAddStatus, string> = {
  bought: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  awaiting_payment: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  cancelled: "bg-surface text-muted",
  in_cart: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  removed: "bg-surface text-muted",
  left: "bg-surface text-muted",
};

export function CartAddStatusBadge({ status }: { status: CartAddStatus }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_TONE[status]}`}>
      {CART_ADD_STATUS[status]}
    </span>
  );
}

/**
 * Items put in the cart from a list, each with where it ended up: its
 * order, the list it came from and the shopper, all linked.
 */
export function CartAddTable({
  rows,
  storeSlug,
  locale,
  showList = true,
  showCustomer = true,
}: {
  rows: CartAddRow[];
  storeSlug: string;
  locale: string;
  showList?: boolean;
  showCustomer?: boolean;
}) {
  const base = `/admin/${storeSlug}`;
  const date = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-2 pr-4 font-medium">Item</th>
            {showList && <th scope="col" className="hidden py-2 pr-4 font-medium md:table-cell">From list</th>}
            {showCustomer && <th scope="col" className="hidden py-2 pr-4 font-medium sm:table-cell">Shopper</th>}
            <th scope="col" className="py-2 pr-4 font-medium">What happened</th>
            <th scope="col" className="py-2 text-right font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const value =
              row.order && row.status === "bought"
                ? formatMoney(row.order.boughtMinor, row.order.currency, locale)
                : row.unitPriceMinor !== null
                  ? formatMoney(row.unitPriceMinor * row.quantity, row.currency, locale)
                  : "–";
            return (
              <tr key={row.id} className="border-b border-border align-top last:border-0">
                <td className="py-2 pr-4">
                  {row.productId ? (
                    <Link href={`${base}/products/${row.productId}`} className="font-medium underline-offset-2 hover:underline">
                      {row.title}
                    </Link>
                  ) : (
                    <span className="font-medium">{row.title}</span>
                  )}
                  <span className="block text-xs text-muted">
                    {row.quantity} × {variantText(row.options, row.sku)}
                  </span>
                  <span className="block text-xs text-muted">Added to the cart {date(row.addedAt)}</span>
                </td>
                {showList && (
                  <td className="hidden py-2 pr-4 md:table-cell">
                    {row.wishlist.id ? (
                      <Link href={`${base}/wishlists/${row.wishlist.id}`} className="underline">
                        {row.wishlist.name}
                      </Link>
                    ) : (
                      <>
                        {row.wishlist.name}
                        <span className="block text-xs text-muted">List deleted</span>
                      </>
                    )}
                  </td>
                )}
                {showCustomer && (
                  <td className="hidden py-2 pr-4 sm:table-cell">
                    {row.customer ? (
                      <Link href={`${base}/customers/${row.customer.key}`} className="underline">
                        {row.customer.name || row.customer.email}
                      </Link>
                    ) : (
                      <span className="text-muted">Guest, not known yet</span>
                    )}
                  </td>
                )}
                <td className="py-2 pr-4">
                  <CartAddStatusBadge status={row.status} />
                  {row.order && (
                    <span className="block text-xs">
                      <Link href={`${base}/orders/${row.order.id}`} className="underline">
                        Order #{row.order.number}
                      </Link>
                      {row.status === "bought" && row.order.boughtQuantity < row.quantity && (
                        <span className="text-muted"> · {row.order.boughtQuantity} of {row.quantity} bought</span>
                      )}
                    </span>
                  )}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {value}
                  {row.status !== "bought" && value !== "–" && <span className="block text-xs text-muted">when added</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
