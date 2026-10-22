import Link from "next/link";
import { after } from "next/server";
import { Suspense } from "react";

import { AdminFrame, MenuFooterLink } from "@/components/admin/admin-frame";
import { AdminAccountMenu, LevelSwitcher, storesOf } from "@/components/admin/admin-shell-parts";
import { AdminTrail } from "@/components/admin/admin-trail";
import { AiManagerLauncher } from "@/components/admin/ai-manager-launcher";
import type { NavArea, NavItem } from "@/components/admin/store-admin-nav";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { LEVEL_LAYOUTS } from "@/lib/admin-layouts";
import { adminText } from "@/lib/admin-text";
import { featureOn } from "@/lib/store-features";
import { storeBase, storeHref, storeOrigins } from "@/lib/paths";
import { canOpenPath, permissionOfPath } from "@/lib/permissions";
import { keyAllowedWhenNotOpen, ownerMayReopen } from "@/lib/store-closure";
import { storeAreas, storeTabs } from "@/lib/store-nav";
import { STARTING_CONTENT_HREF, demoStoreHref } from "@/lib/theme-admin-paths";
import { holderOf } from "@/server/auth";
import { memberCan, requireMemberAny } from "@/server/permissions";
import { ensureStorePaymentMethods, ensureTestAccount, requestIp } from "@/server/connect";
import { waitingCount } from "@/server/support";
import { memberDesk } from "@/server/support-desk";
import { starterOfStore } from "@/server/store-starters";

import {
  assistantHearAction,
  decideApprovalAction,
  deleteConversationAction,
  loadConversationAction,
  rateAnswerAction,
  startAssistantAction,
} from "./assistant/actions";

/**
 * Tools drawn in the `workspace` layout (D230): the page editor (a page's own address, or a new page, D53) and the media library use the
 * whole width beside a narrowed rail, without the section's sidebar; the support inbox too, with its section's pages in the top bar.
 */
const FULL_WIDTH = String.raw`^/admin/[^/]+/((pages|articles|product-layouts|headers|footers)/(new|[0-9a-f-]{36})|media)$`;
const INBOX = String.raw`^/admin/[^/]+/support$`;

/** The setup wizard is drawn in the `focus` layout (D229): one step at a time, nothing of the store's navigation beside it. */
const SETUP = String.raw`^/admin/[^/]+/setup(/|$)`;

/**
 * A store's admin (D39, D107, D147): the shared admin shell, with the store's
 * sections as tabs with icons, each section's own pages in its sidebar (the
 * slide-out menu on phones) and the whole width of the screen to work in, as
 * the platform's (D144). The level switcher takes the person to any other
 * store, the control center or the platform. Drawn in the `rail` layout
 * (docs/admin-style.md 6.3): the sections are the rail's icons.
 */
export default async function StoreAdminLayout({ children, params }: LayoutProps<"/admin/[store]">) {
  const member = await requireMemberAny((await params).store);
  const { account, store, role } = member;
  const isOwner = memberCan(member, "owner");
  // In test mode, Kaizen sets up the store's test Stripe account itself, after
  // the page is sent, so test purchases work without any setup (D20).
  // A store that is not open (D171) gets no Stripe set-up from a visit to its admin, nor does a store template (D175), which takes no orders.
  // A website (D178 step 5: the online shop off) takes no payments, so neither is set up.
  const selling = featureOn(store, "shop");
  if (store.status === "active" && !store.starter && store.paymentsTest && selling) {
    const ip = await requestIp();
    after(() => ensureTestAccount(store.id, account.id, ip));
  }
  // Payment methods added to Kaizen since the store's accounts were made (D23).
  if (store.status === "active" && selling) after(() => ensureStorePaymentMethods(store.id));
  const stores = await storesOf(account);

  const base = `/admin/${store.slug}`;
  // The store's sections (D147): a tab each with its own sidebar, none for Home. The AI manager is in the header.
  // Only what the member can open (wave 1, 1f): their role's areas, and no page that would be a 404.
  const holder = holderOf(member);
  // A store that is not open (suspended or closed, D171) offers only what a member may still do there: its orders, customers and analytics.
  const open = store.status === "active";
  const canOpen = (path: string) => canOpenPath(holder, path) && (open || keyAllowedWhenNotOpen(permissionOfPath(path, "read")));
  // Support (D216): the number of conversations waiting for a person, on the Support tab of those who may read it.
  const waiting = memberCan(member, "support:read") ? await waitingCount([memberDesk(member).desk]) : 0;
  // A starter store says what it is (D175): starting content, or a live demo store (D277) with its own page for platform admins.
  const starter = store.starter ? await starterOfStore(store.id) : null;
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "shell");
  const tabs: NavItem[] = storeTabs(base, store, canOpen, { support: waiting });
  const areas: NavArea[] = storeAreas(base, store, canOpen);
  return (
    <AdminFrame
      layout={LEVEL_LAYOUTS.store}
      lang={lang}
      home={{ href: "/admin", label: w.store.homeLabel }}
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
          <Link href={storeHref(store.slug, storeBase(store.slug))} className="flex min-h-10 items-center gap-1.5 rounded-pill border border-edge px-3 hover:bg-sunken">
            <span className="hidden sm:inline">{w.store.viewStore}</span>
            <span className="sr-only sm:hidden">{w.store.viewStore}</span>
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
      tabsLabel={w.levels.storeSections}
      menuTitle={<span className="font-medium">{store.name}</span>}
      menuFooter={
        <>
          {stores.some((s) => s.role === "owner") && <MenuFooterLink href="/admin">{w.levels.controlCenter}</MenuFooterLink>}
          <MenuFooterLink href="/admin/stores">{w.store.allYourStores}</MenuFooterLink>
          {account.platformAdmin && <MenuFooterLink href="/admin/platform">{w.levels.platform}</MenuFooterLink>}
          <MenuFooterLink href="/admin/account">{w.store.yourAccount}</MenuFooterLink>
        </>
      }
      fullWidth={FULL_WIDTH}
      workspaceLinks={INBOX}
      focus={{ pattern: SETUP, back: { href: base, label: w.store.leaveSetup }, title: fillWords(w.store.settingUp, { name: store.name }) }}
    >
      {store.starter && starter?.kind === "demo" && (
        <div role="status" className="mb-4 rounded-panel bg-sunken p-4 text-sm">
          <p className="font-medium">{starter.published ? w.store.demoLive : w.store.demoNotPublished}</p>
          <p className="text-muted">
            {starter.published ? w.store.demoLiveText : w.store.demoDraftText} {w.store.demoRules}
            {account.platformAdmin && (
              <>
                {" "}
                <Link href={demoStoreHref(starter.id)} className="font-medium underline underline-offset-2">
                  {w.store.itsPage}
                </Link>
              </>
            )}
          </p>
        </div>
      )}
      {store.starter && starter?.kind !== "demo" && (
        <div role="status" className="mb-4 rounded-panel bg-sunken p-4 text-sm">
          <p className="font-medium">{w.store.startingContent}</p>
          <p className="text-muted">
            {w.store.startingContentText}
            {account.platformAdmin && (
              <>
                {" "}
                <Link href={starter ? demoStoreHref(starter.id) : STARTING_CONTENT_HREF} className="font-medium underline underline-offset-2">
                  {w.store.itsPage}
                </Link>
              </>
            )}
          </p>
        </div>
      )}
      {!open && (
        <div role="status" className="mb-4 rounded-panel bg-sunken p-4 text-sm">
          <p className="font-medium">{store.status === "suspended" ? w.store.suspended : w.store.closed}</p>
          <p className="text-muted">
            {store.status === "suspended" ? w.store.suspendedText : w.store.closedText}
            {isOwner && store.status === "closed" && (
              <>
                {" "}
                <Link href={`${base}/settings/close`} className="font-medium underline underline-offset-2">
                  {ownerMayReopen(store.status, store.closedAt ? new Date(store.closedAt) : null, new Date()) ? w.store.reopen : w.store.aboutReopening}
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
