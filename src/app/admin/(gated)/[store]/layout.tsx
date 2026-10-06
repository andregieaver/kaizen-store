import Link from "next/link";
import { after } from "next/server";
import { Suspense } from "react";

import { AdminFrame, MenuFooterLink } from "@/components/admin/admin-frame";
import { AdminAccountMenu, LevelSwitcher, storesOf } from "@/components/admin/admin-shell-parts";
import { AdminTrail } from "@/components/admin/admin-trail";
import { AiManagerLauncher } from "@/components/admin/ai-manager-launcher";
import type { NavArea, NavItem } from "@/components/admin/store-admin-nav";
import { storeBase, storeHref, storeOrigins } from "@/lib/paths";
import { canOpenPath, permissionOfPath } from "@/lib/permissions";
import { keyAllowedWhenNotOpen, ownerMayReopen } from "@/lib/store-closure";
import { storeAreas, storeTabs } from "@/lib/store-nav";
import { holderOf } from "@/server/auth";
import { memberCan, requireMemberAny } from "@/server/permissions";
import { ensureStorePaymentMethods, ensureTestAccount, requestIp } from "@/server/connect";

import {
  assistantHearAction,
  decideApprovalAction,
  deleteConversationAction,
  loadConversationAction,
  rateAnswerAction,
  startAssistantAction,
} from "./assistant/actions";

/** The page editor (a page's own address, or a new page) uses the whole width, without the section's sidebar (D53). */
const FULL_WIDTH = String.raw`^/admin/[^/]+/(pages|articles|product-layouts|headers|footers)/(new|[0-9a-f-]{36})$`;

/**
 * A store's admin (D39, D107, D147): the shared admin shell, with the store's
 * sections as tabs with icons, each section's own pages in its sidebar (the
 * slide-out menu on phones) and the whole width of the screen to work in, as
 * the platform's (D144). The level switcher takes the person to any other
 * store, the control center or the platform.
 */
export default async function StoreAdminLayout({ children, params }: LayoutProps<"/admin/[store]">) {
  const member = await requireMemberAny((await params).store);
  const { account, store, role } = member;
  const isOwner = memberCan(member, "owner");
  // In test mode, Kaizen sets up the store's test Stripe account itself, after
  // the page is sent, so test purchases work without any setup (D20).
  // A store that is not open (D171) gets no Stripe set-up from a visit to its admin.
  if (store.status === "active" && store.paymentsTest) {
    const ip = await requestIp();
    after(() => ensureTestAccount(store.id, account.id, ip));
  }
  // Payment methods added to Kaizen since the store's accounts were made (D23).
  if (store.status === "active") after(() => ensureStorePaymentMethods(store.id));
  const stores = await storesOf(account);

  const base = `/admin/${store.slug}`;
  // The store's sections (D147): a tab each with its own sidebar, none for Home. The AI manager is in the header.
  // Only what the member can open (wave 1, 1f): their role's areas, and no page that would be a 404.
  const holder = holderOf(member);
  // A store that is not open (suspended or closed, D171) offers only what a member may still do there: its orders, customers and analytics.
  const open = store.status === "active";
  const canOpen = (path: string) => canOpenPath(holder, path) && (open || keyAllowedWhenNotOpen(permissionOfPath(path, "read")));
  const tabs: NavItem[] = storeTabs(base, store, canOpen);
  const areas: NavArea[] = storeAreas(base, store, canOpen);
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
          {isOwner && open && (
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
      account={<AdminAccountMenu account={account} role={member.roleName ?? (member.kind === "collaborator" ? "collaborator" : role)} />}
      tabs={tabs}
      groups={[]}
      areas={areas}
      wide
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
      {!open && (
        <div role="status" className="mb-4 rounded-lg border border-border bg-surface p-4 text-sm">
          <p className="font-medium">{store.status === "suspended" ? "This store is suspended." : "This store is closed."}</p>
          <p className="text-muted">
            {store.status === "suspended"
              ? "Kaizen has paused it: it takes no orders and cannot be changed. You can still see and handle what was already sold."
              : "It takes no orders. Its orders, invoices, returns and customer data stay here to read and download."}
            {isOwner && store.status === "closed" && (
              <>
                {" "}
                <Link href={`${base}/settings/close`} className="font-medium underline underline-offset-2">
                  {ownerMayReopen(store.status, store.closedAt ? new Date(store.closedAt) : null, new Date()) ? "Reopen the store" : "About reopening"}
                </Link>
              </>
            )}
          </p>
        </div>
      )}
      {children}
    </AdminFrame>
  );
}
