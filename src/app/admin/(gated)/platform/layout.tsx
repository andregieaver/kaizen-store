import { Suspense } from "react";

import { AdminFrame, MenuFooterLink } from "@/components/admin/admin-frame";
import { AdminAccountMenu, LevelSwitcher } from "@/components/admin/admin-shell-parts";
import { AiManagerLauncher } from "@/components/admin/ai-manager-launcher";
import type { NavArea, NavItem } from "@/components/admin/store-admin-nav";
import { PLAN_ITEMS, PLATFORM_BASE, SETTINGS_ITEMS, WEBSITE_ITEMS, sectionPrefixes, withBase } from "@/lib/platform-nav";
import { requirePlatformAdmin } from "@/server/auth";
import { countPendingRequests } from "@/server/platform";

import {
  decidePlatformApprovalAction,
  deletePlatformConversationAction,
  loadPlatformConversationAction,
  platformHearAction,
  ratePlatformAnswerAction,
  startPlatformAssistantAction,
} from "./assistant/actions";

/** The page editor (a page's own address, or a new page) uses the whole width; the rest of the platform admin has its sidebar. */
const FULL_WIDTH = String.raw`^/admin/platform/(pages|articles|headers|footers)/(new|[0-9a-f-]{36})$`;

const base = PLATFORM_BASE;

/**
 * The platform's sections (D144), each with its own sidebar or none: Home, Customers, Stores and Requests need none.
 * Every page of the level is in exactly one area, by its address, which also marks the section's tab.
 */
const website = sectionPrefixes("/website", WEBSITE_ITEMS);
const planPages = sectionPrefixes(null, PLAN_ITEMS);
const settings = sectionPrefixes("/settings", SETTINGS_ITEMS);

const areas: NavArea[] = [
  { prefixes: [], exact: [base], groups: [] },
  { prefixes: website, groups: [{ heading: "Website", items: withBase(WEBSITE_ITEMS) }] },
  { prefixes: [`${base}/stores`, `${base}/customers`, `${base}/requests`, `${base}/assistant`], groups: [] },
  { prefixes: planPages, groups: [{ heading: "Plans", items: withBase(PLAN_ITEMS) }] },
  { prefixes: settings, groups: [{ heading: "Settings", items: withBase(SETTINGS_ITEMS) }] },
];

/**
 * Kaizen's own admin (D107), in the same shell as a store's: the level
 * switcher and account menu in the header, the operator's sections as tabs
 * with icons, each section's own pages in its own sidebar (D144), and the whole
 * width of the screen to work in.
 */
export default async function PlatformLayout({ children }: LayoutProps<"/admin/platform">) {
  const account = await requirePlatformAdmin();
  const waiting = await countPendingRequests();
  const tabs: NavItem[] = [
    { href: base, label: "Home", exact: true, icon: "home" },
    { href: `${base}/website`, label: "Website", icon: "monitor", also: website },
    { href: `${base}/stores`, label: "Stores", icon: "shopping-bag" },
    { href: `${base}/customers`, label: "Customers", icon: "users" },
    { href: `${base}/plans`, label: "Plans", icon: "credit-card", also: planPages },
    { href: `${base}/requests`, label: "Requests", icon: "bell", badge: waiting },
    { href: `${base}/settings`, label: "Settings", icon: "cog", also: settings },
  ];
  return (
    <AdminFrame
      switcher={
        <Suspense fallback={<span className="px-2 font-medium">Platform</span>}>
          <LevelSwitcher account={account} level="platform" label="Platform" />
        </Suspense>
      }
      actions={
        <AiManagerLauncher
          area="platform"
          base={`${base}/assistant`}
          siteName="Kaizen"
          settingsHref={`${base}/ai`}
          start={startPlatformAssistantAction}
          actions={{
            decide: decidePlatformApprovalAction,
            remove: deletePlatformConversationAction,
            load: loadPlatformConversationAction,
            rate: ratePlatformAnswerAction,
            hear: platformHearAction,
          }}
        />
      }
      account={<AdminAccountMenu account={account} role="Platform" />}
      tabs={tabs}
      groups={[]}
      areas={areas}
      wide
      tabsLabel="Platform sections"
      menuTitle={<span className="font-medium">Platform</span>}
      menuFooter={
        <>
          <MenuFooterLink href="/admin">Control center</MenuFooterLink>
          <MenuFooterLink href="/admin/account">Your account</MenuFooterLink>
        </>
      }
      fullWidth={FULL_WIDTH}
    >
      {children}
    </AdminFrame>
  );
}
