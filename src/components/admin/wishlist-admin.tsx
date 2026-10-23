import Link from "next/link";

import { fillWords } from "@/lib/admin-fill";
import type { BookingsMessages } from "@/lib/admin-messages/bookings.en";
import { adminText } from "@/lib/admin-text";
import { formatMoney } from "@/lib/money";
import { CART_ADD_STATUS, type CartAddRow, type CartAddStatus } from "@/server/wishlist-admin";

/** "Colour: Black · DEMO-MUG-BLACK", or the SKU alone. */
export function variantText(options: Record<string, string> | null, sku: string): string {
  const values = options ? Object.values(options).filter(Boolean) : [];
  return values.length > 0 ? `${values.join(", ")} · ${sku}` : sku;
}

type WishlistWords = BookingsMessages["wishlists"];
const ENGLISH = (): WishlistWords => adminText("en", "bookings").wishlists;

/** The two views of the store's wishlists (D36): the lists, and what went from them to the cart and was bought. */
export function WishlistTabs({ storeSlug, current, words: w = ENGLISH() }: { storeSlug: string; current: "lists" | "activity"; words?: WishlistWords }) {
  const base = `/admin/${storeSlug}/wishlists`;
  const tabs = [
    { key: "lists", href: base, label: w.tabs.lists },
    { key: "activity", href: `${base}/activity`, label: w.tabs.activity },
  ];
  return (
    <nav aria-label={w.tabs.label} className="flex flex-wrap gap-2 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === current ? "page" : undefined}
          className="rounded px-2 py-1 aria-[current=page]:bg-card aria-[current=page]:font-medium"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

const STATUS_TONE: Record<CartAddStatus, string> = {
  bought: "bg-positive-soft text-positive-text",
  awaiting_payment: "bg-warning-soft text-warning-text",
  cancelled: "bg-sunken text-muted",
  in_cart: "bg-insight-soft text-insight-text",
  removed: "bg-sunken text-muted",
  left: "bg-sunken text-muted",
};

export function CartAddStatusBadge({ status, words }: { status: CartAddStatus; words?: WishlistWords }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_TONE[status]}`}>
      {words?.status[status] ?? CART_ADD_STATUS[status]}
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
  words: w = ENGLISH(),
  dateLocale = locale,
}: {
  rows: CartAddRow[];
  storeSlug: string;
  locale: string;
  showList?: boolean;
  showCustomer?: boolean;
  /** The table's words and date format (D312 A11); English when none are given. */
  words?: WishlistWords;
  dateLocale?: string;
}) {
  const base = `/admin/${storeSlug}`;
  const date = (iso: string) =>
    new Date(iso).toLocaleString(dateLocale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="py-2 pr-4 font-medium">{w.table.item}</th>
            {showList && <th scope="col" className="hidden py-2 pr-4 font-medium md:table-cell">{w.table.fromList}</th>}
            {showCustomer && <th scope="col" className="hidden py-2 pr-4 font-medium sm:table-cell">{w.table.shopper}</th>}
            <th scope="col" className="py-2 pr-4 font-medium">{w.table.what}</th>
            <th scope="col" className="py-2 text-right font-medium">{w.table.value}</th>
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
              <tr key={row.id} className="border-b border-line align-top last:border-0">
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
                  <span className="block text-xs text-muted">{fillWords(w.table.added, { date: date(row.addedAt) })}</span>
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
                        <span className="block text-xs text-muted">{w.table.deleted}</span>
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
                      <span className="text-muted">{w.table.guest}</span>
                    )}
                  </td>
                )}
                <td className="py-2 pr-4">
                  <CartAddStatusBadge status={row.status} words={w} />
                  {row.order && (
                    <span className="block text-xs">
                      <Link href={`${base}/orders/${row.order.id}`} className="underline">
                        {fillWords(w.table.order, { number: row.order.number })}
                      </Link>
                      {row.status === "bought" && row.order.boughtQuantity < row.quantity && (
                        <span className="text-muted"> · {fillWords(w.table.boughtOf, { n: row.order.boughtQuantity, of: row.quantity })}</span>
                      )}
                    </span>
                  )}
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {value}
                  {row.status !== "bought" && value !== "–" && <span className="block text-xs text-muted">{w.table.whenAdded}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
