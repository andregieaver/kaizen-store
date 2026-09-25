import Link from "next/link";
import { after } from "next/server";

import { AdminTrail } from "@/components/admin/admin-trail";
import { storeBase } from "@/lib/paths";
import { requireMember } from "@/server/auth";
import { ensureStorePaymentMethods, ensureTestAccount, requestIp } from "@/server/connect";

export default async function StoreAdminLayout({
  children,
  params,
}: LayoutProps<"/admin/[store]">) {
  const { account, store, role } = await requireMember((await params).store);
  // In test mode, Kaizen sets up the store's test Stripe account itself, after
  // the page is sent, so test purchases work without any setup (D20).
  if (store.paymentsTest) {
    const ip = await requestIp();
    after(() => ensureTestAccount(store.id, account.id, ip));
  }
  // Payment methods added to Kaizen since the store's accounts were made (D23).
  after(() => ensureStorePaymentMethods(store.id));
  const base = `/admin/${store.slug}`;
  const nav = [
    { href: base, label: "Overview" },
    { href: `${base}/orders`, label: "Orders" },
    { href: `${base}/subscriptions`, label: "Subscriptions" },
    { href: `${base}/products`, label: "Products" },
    { href: `${base}/discounts`, label: "Discounts" },
    { href: `${base}/cart-reminders`, label: "Cart reminders" },
    { href: `${base}/settings/shipping`, label: "Shipping" },
    { href: `${base}/settings/payments`, label: "Payments" },
    { href: `${base}/settings/navigation`, label: "Header and footer" },
    { href: `${base}/settings/seo`, label: "Search" },
    { href: `${base}/staff`, label: "Staff" },
    { href: `${base}/billing`, label: "Plan" },
  ];

  return (
    <>
      <AdminTrail storeSlug={store.slug} />
      <div className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-2">
          <nav aria-label={`${store.name} admin`} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-medium">{store.name}</span>
            <ul className="flex flex-wrap gap-1 text-sm">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="rounded px-2 py-1 hover:bg-surface">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted">{role}</span>
            <Link href={storeBase(store.slug)} className="underline">
              View store
            </Link>
            <Link href="/admin/stores" className="underline">
              All stores
            </Link>
          </div>
        </div>
      </div>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}
