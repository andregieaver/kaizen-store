import Link from "next/link";

import { formatMoney } from "@/lib/money";

export type CustomerBarData = {
  /** Where the customer's page is. */
  href: string;
  name: string;
  email: string;
  account: "verified" | "unverified" | null;
  /** "3 orders · 1 active subscription · 1 249,00 kr spent". */
  facts: string[];
  /** Shown instead of the account's standing, e.g. a store owner's role. */
  badge?: string;
};

/** The account's standing, in a word or two. */
export function accountLabel(account: CustomerBarData["account"]): string {
  return account === "verified" ? "Account" : account === "unverified" ? "Account, email not confirmed" : "Guest";
}

/** "NOK 1 249,00 + SEK 300,00". */
export function moneyByCurrency(minor: Record<string, number>, locale: string): string {
  return Object.entries(minor)
    .map(([currency, amount]) => formatMoney(Number(amount), currency, locale))
    .join(" + ");
}

function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words.at(-1)![0]}`.toUpperCase();
  return (words[0]?.[0] ?? email[0] ?? "?").toUpperCase();
}

/**
 * Who an order, subscription or invoice belongs to (D35), at the top of
 * its page: the same bar everywhere, one click from the customer's page,
 * which lists all of their orders and subscriptions in turn.
 */
export function CustomerBar({ customer }: { customer: CustomerBarData }) {
  return (
    <section
      aria-label="Customer"
      className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-background p-4"
    >
      <span
        aria-hidden="true"
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background"
      >
        {initials(customer.name, customer.email)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {customer.name || customer.email}
          <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-xs font-normal text-muted">
            {customer.badge ?? accountLabel(customer.account)}
          </span>
        </p>
        <p className="truncate text-sm text-muted">
          {customer.name && `${customer.email} · `}
          {customer.facts.join(" · ")}
        </p>
      </div>
      <Link
        href={customer.href}
        className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface"
      >
        Customer details
      </Link>
    </section>
  );
}

/** The bar for a store's customer (D35), from their summary. */
export function storeCustomerBar(
  storeSlug: string,
  customer: {
    key: string;
    name: string;
    email: string;
    account: CustomerBarData["account"];
    orders: number;
    liveSubscriptions: number;
    spentMinor: Record<string, number>;
  },
  locale: string,
): CustomerBarData {
  const spent = moneyByCurrency(customer.spentMinor, locale);
  return {
    href: `/admin/${storeSlug}/customers/${customer.key}`,
    name: customer.name,
    email: customer.email,
    account: customer.account,
    facts: [
      customer.orders === 1 ? "1 order" : `${customer.orders} orders`,
      ...(customer.liveSubscriptions > 0
        ? [customer.liveSubscriptions === 1 ? "1 active subscription" : `${customer.liveSubscriptions} active subscriptions`]
        : []),
      ...(spent ? [`${spent} spent`] : []),
    ],
  };
}
