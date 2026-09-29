import Link from "next/link";
import { after } from "next/server";
import { Suspense } from "react";

import { AdminFrame, MenuFooterLink } from "@/components/admin/admin-frame";
import { AdminAccountMenu, LevelSwitcher, storesOf } from "@/components/admin/admin-shell-parts";
import { AdminTrail } from "@/components/admin/admin-trail";
import { AiManagerLauncher } from "@/components/admin/ai-manager-launcher";
import type { NavGroup, NavItem } from "@/components/admin/store-admin-nav";
import { storeBase, storeHref, storeOrigins } from "@/lib/paths";
import { requireMember } from "@/server/auth";
import { ensureStorePaymentMethods, ensureTestAccount, requestIp } from "@/server/connect";

import {
  assistantHearAction,
  decideApprovalAction,
  deleteConversationAction,
  loadConversationAction,
  rateAnswerAction,
  startAssistantAction,
} from "./assistant/actions";

/** The page editor (a page's own address, or a new page) uses the whole width, without the settings sidebar (D53). */
const FULL_WIDTH = String.raw`^/admin/[^/]+/(pages|articles|product-layouts|headers|footers)/(new|[0-9a-f-]{36})$`;

/**
 * A store's admin (D39, D107): the shared admin shell, with the store's
 * main sections as tabs and its settings grouped in a sidebar (the slide-out
 * menu on phones). The level switcher takes the person to any other store, the
 * control center or the platform.
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
  const stores = await storesOf(account);

  const base = `/admin/${store.slug}`;
  const tabs: NavItem[] = [
    { href: base, label: "Overview", exact: true },
    // The AI manager (D94, D103), for owners.
    ...(role === "owner" ? [{ href: `${base}/assistant`, label: "AI manager" }] : []),
    { href: `${base}/orders`, label: "Orders" },
    { href: `${base}/subscriptions`, label: "Subscriptions" },
    { href: `${base}/products`, label: "Products" },
    { href: `${base}/product-layouts`, label: "Product layouts" },
    { href: `${base}/pages`, label: "Pages" },
    { href: `${base}/articles`, label: "Blog" },
    { href: `${base}/media`, label: "Media" },
    { href: `${base}/discounts`, label: "Coupons" },
    { href: `${base}/wishlists`, label: "Wishlists" },
  ];
  const groups: NavGroup[] = [
    // Appointments (D65), once the store has switched bookings on.
    ...(store.bookingsOn
      ? [
          {
            heading: "Bookings",
            items: [
              { href: `${base}/bookings`, label: "Calendar", exact: true },
              { href: `${base}/bookings/staff`, label: "Staff and hours" },
              { href: `${base}/bookings/stays`, label: "Stays and rentals" },
              { href: `${base}/bookings/units`, label: "Rooms and items" },
              { href: `${base}/hosts`, label: "Hosts" },
            ],
          },
        ]
      : []),
    {
      heading: "Sales",
      items: [
        { href: `${base}/customers`, label: "Customers" },
        { href: `${base}/customer-groups`, label: "Customer groups" },
        { href: `${base}/companies`, label: "Companies" },
        // Weekly deliveries (D102), once switched on.
        ...(store.deliveriesOn ? [{ href: `${base}/deliveries`, label: "Subscription boxes" }] : []),
        { href: `${base}/cart-reminders`, label: "Cart reminders" },
        { href: `${base}/settings/shipping`, label: "Shipping" },
        { href: `${base}/settings/payments`, label: "Payments" },
      ],
    },
    {
      heading: "Store",
      items: [
        { href: `${base}/search`, label: "Search" },
        { href: `${base}/chat`, label: "Chat agent" },
        { href: `${base}/settings/localization`, label: "Languages and currencies" },
        { href: `${base}/translate`, label: "Translate the store" },
        { href: `${base}/settings/seo`, label: "SEO & Reach" },
        { href: `${base}/menus`, label: "Menus" },
        { href: `${base}/settings/navigation`, label: "Header and footer" },
        { href: `${base}/headers`, label: "Headers" },
        { href: `${base}/footers`, label: "Footers" },
        { href: `${base}/settings/design`, label: "Design" },
        { href: `${base}/settings/domains`, label: "Domains" },
        { href: `${base}/settings/company`, label: "Company" },
        { href: `${base}/integrations`, label: "Integrations" },
        { href: `${base}/settings/ai`, label: "AI" },
        { href: `${base}/settings/features`, label: "Features" },
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
  return (
    <AdminFrame
      before={<AdminTrail storeSlug={store.slug} storeOrigins={storeOrigins(store.slug)} />}
      switcher={
        <Suspense fallback={<span className="px-2 font-medium">{store.name}</span>}>
          <LevelSwitcher account={account} level="store" label={store.name} currentSlug={store.slug} />
        </Suspense>
      }
      actions={
        <>
          {/* The AI manager (D103), from every page of the store's admin, for owners. */}
          {role === "owner" && (
            <AiManagerLauncher
              area="store"
              base={`${base}/assistant`}
              siteName={store.name}
              settingsHref={`${base}/settings/ai`}
              start={startAssistantAction.bind(null, store.slug)}
              actions={{
                decide: decideApprovalAction.bind(null, store.slug),
                remove: deleteConversationAction.bind(null, store.slug),
                load: loadConversationAction.bind(null, store.slug),
                rate: rateAnswerAction.bind(null, store.slug),
                hear: assistantHearAction.bind(null, store.slug),
              }}
            />
          )}
          <Link href={storeHref(store.slug, storeBase(store.slug))} className="flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 hover:bg-surface">
            <span className="hidden sm:inline">View store</span>
            <span className="sr-only sm:hidden">View store</span>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 5h5v5M19 5l-8 8M10 5H5v14h14v-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </>
      }
      account={<AdminAccountMenu account={account} role={role} />}
      tabs={tabs}
      groups={groups}
      tabsLabel="Main sections"
      menuTitle={<span className="font-medium">{store.name}</span>}
      menuFooter={
        <>
          {stores.some((s) => s.role === "owner") && <MenuFooterLink href="/admin">Control center</MenuFooterLink>}
          <MenuFooterLink href="/admin/stores">All your stores</MenuFooterLink>
          {account.platformAdmin && <MenuFooterLink href="/admin/platform">Platform</MenuFooterLink>}
          <MenuFooterLink href="/admin/account">Your account</MenuFooterLink>
        </>
      }
      fullWidth={FULL_WIDTH}
    >
      {children}
    </AdminFrame>
  );
}
