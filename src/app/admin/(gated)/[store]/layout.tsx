import Link from "next/link";
import { after } from "next/server";

import { AdminTrail, SignOutForm } from "@/components/admin/admin-trail";
import { StoreSidebar, StoreTabs, type NavGroup, type NavItem } from "@/components/admin/store-admin-nav";
import { StoreMain } from "@/components/admin/store-main";
import { HidingHeader, MobileMenu } from "@/components/store-chrome";
import { storeBase, storeHref } from "@/lib/paths";
import { requireMember } from "@/server/auth";
import { ensureStorePaymentMethods, ensureTestAccount, requestIp } from "@/server/connect";
import { countPendingRequests } from "@/server/platform";

import { signOut } from "../actions";

/**
 * A store's admin (D39): a header that stays at the top and slides away
 * while scrolling down, with the main sections as tabs; the store's
 * settings grouped in a sidebar, which on phones slides out from the menu
 * button together with the account's links.
 */
export default async function StoreAdminLayout({ children, params }: LayoutProps<"/admin/[store]">) {
  const { account, store, role } = await requireMember((await params).store);
  // In test mode, Kaizen sets up the store's test Stripe account itself, after
  // the page is sent, so test purchases work without any setup (D20).
  if (store.paymentsTest) {
    const ip = await requestIp();
    after(() => ensureTestAccount(store.id, account.id, ip));
  }
  // Payment methods added to Kaizen since the store's accounts were made (D23).
  after(() => ensureStorePaymentMethods(store.id));
  const pending = account.platformAdmin ? await countPendingRequests() : 0;

  const base = `/admin/${store.slug}`;
  const tabs: NavItem[] = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/orders`, label: "Orders" },
    { href: `${base}/subscriptions`, label: "Subscriptions" },
    { href: `${base}/products`, label: "Products" },
    { href: `${base}/pages`, label: "Pages" },
    { href: `${base}/articles`, label: "Blog" },
    { href: `${base}/discounts`, label: "Coupons" },
    { href: `${base}/wishlists`, label: "Wishlists" },
  ];
  const groups: NavGroup[] = [
    {
      heading: "Sales",
      items: [
        { href: `${base}/customers`, label: "Customers" },
        { href: `${base}/cart-reminders`, label: "Cart reminders" },
        { href: `${base}/settings/shipping`, label: "Shipping" },
        { href: `${base}/settings/payments`, label: "Payments" },
      ],
    },
    {
      heading: "Store",
      items: [
        { href: `${base}/settings/seo`, label: "SEO & Reach" },
        { href: `${base}/settings/navigation`, label: "Header and footer" },
        { href: `${base}/settings/design`, label: "Design" },
        { href: `${base}/settings/domains`, label: "Domains" },
        { href: `${base}/settings/company`, label: "Company" },
        { href: `${base}/integrations`, label: "Integrations" },
        { href: `${base}/settings/cookies`, label: "Cookies and tracking" },
      ],
    },
    {
      heading: "Account",
      items: [
        { href: `${base}/billing`, label: "Billing" },
        { href: `${base}/staff`, label: "Team" },
      ],
    },
  ];
  const platform = account.platformAdmin && (
    <Link href="/admin/platform" className="underline">
      Platform{pending > 0 ? ` (${pending} waiting)` : ""}
    </Link>
  );

  return (
    <>
      <AdminTrail storeSlug={store.slug} />
      <HidingHeader>
        <header className="border-b border-border bg-background">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
            {/* The slide-out menu (below) opens on any `data-open-menu` button. */}
            <button
              type="button"
              data-open-menu
              aria-haspopup="dialog"
              className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-md hover:bg-surface lg:hidden"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              </svg>
              <span className="sr-only">Menu</span>
            </button>
            <Link href="/admin/stores" className="hidden shrink-0 font-semibold sm:block" title="All your stores">
              Kaizen
            </Link>
            <span aria-hidden="true" className="hidden text-muted sm:block">
              /
            </span>
            <Link href={base} className="min-w-0 truncate font-medium">
              {store.name}
            </Link>
            <div className="ml-auto flex shrink-0 items-center gap-3 text-sm">
              <Link
                href={storeHref(store.slug, storeBase(store.slug))}
                className="flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 hover:bg-surface"
              >
                View store
                <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 5h5v5M19 5l-8 8M10 5H5v14h14v-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <div className="hidden items-center gap-3 lg:flex">
                {platform}
                <Link href="/admin/account" className="max-w-56 truncate text-muted underline" title={`Your account (${role})`}>
                  {account.email}
                </Link>
                <SignOutForm action={signOut} />
              </div>
            </div>
          </div>
          <div className="mx-auto max-w-7xl px-1 sm:px-3">
            <StoreTabs items={tabs} label="Main sections" />
          </div>
        </header>
      </HidingHeader>

      <StoreMain
        sidebar={
          <aside className="hidden w-52 shrink-0 py-8 lg:block">
            <div className="sticky top-32">
              <StoreSidebar groups={groups} label="Settings" />
            </div>
          </aside>
        }
      >
        {children}
      </StoreMain>

      <MobileMenu title={<span className="font-medium">{store.name}</span>} labels={{ close: "Close menu", menu: "Menu" }}>
        <StoreSidebar groups={[{ heading: "Sections", items: tabs }, ...groups]} label="All pages" />
        <div className="flex flex-col gap-4 border-t border-border px-3 pt-6 text-sm">
          <Link href="/admin/stores" className="underline">
            All your stores
          </Link>
          {platform}
          <Link href="/admin/account" className="truncate underline">
            {account.email} <span className="text-muted">({role})</span>
          </Link>
          <SignOutForm action={signOut} />
        </div>
      </MobileMenu>
    </>
  );
}
