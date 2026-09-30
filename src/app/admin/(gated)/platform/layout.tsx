import { Suspense } from "react";

import { AdminFrame, MenuFooterLink } from "@/components/admin/admin-frame";
import { AdminAccountMenu, LevelSwitcher } from "@/components/admin/admin-shell-parts";
import { AiManagerLauncher } from "@/components/admin/ai-manager-launcher";
import type { NavGroup, NavItem } from "@/components/admin/store-admin-nav";
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

const base = "/admin/platform";

const groups: NavGroup[] = [
  {
    heading: "Website",
    items: [
      { href: `${base}/pages`, label: "Pages" },
      { href: `${base}/articles`, label: "Blog" },
      { href: `${base}/media`, label: "Media" },
      { href: `${base}/templates`, label: "Templates" },
      { href: `${base}/menus`, label: "Menus" },
      { href: `${base}/navigation`, label: "Header and footer" },
      { href: `${base}/headers`, label: "Headers" },
      { href: `${base}/footers`, label: "Footers" },
      { href: `${base}/fonts`, label: "Fonts" },
      { href: `${base}/seo`, label: "Search" },
      { href: `${base}/cookies`, label: "Cookies" },
      { href: `${base}/google-reviews`, label: "Google reviews" },
    ],
  },
  {
    heading: "Billing",
    items: [
      { href: `${base}/discounts`, label: "Discounts" },
      { href: `${base}/plan-reminders`, label: "Plan reminders" },
      { href: `${base}/stripe`, label: "Stripe" },
    ],
  },
  {
    heading: "AI",
    items: [
      { href: `${base}/ai`, label: "AI", exact: true },
      { href: `${base}/ai/usage`, label: "AI usage" },
      { href: `${base}/chat`, label: "Chat agent" },
      { href: `${base}/search-test`, label: "Search test" },
    ],
  },
  {
    heading: "Communication",
    items: [
      { href: `${base}/emails`, label: "Emails" },
      { href: `${base}/languages`, label: "Languages" },
    ],
  },
];

/**
 * Kaizen's own admin (D107), in the same shell as a store's: the level
 * switcher and account menu in the header, the operator's daily sections as
 * tabs, everything else in the sidebar under headings.
 */
export default async function PlatformLayout({ children }: LayoutProps<"/admin/platform">) {
  const account = await requirePlatformAdmin();
  const waiting = await countPendingRequests();
  const tabs: NavItem[] = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/requests`, label: "Requests", badge: waiting },
    { href: `${base}/customers`, label: "Customers" },
    { href: `${base}/stores`, label: "Stores" },
    { href: `${base}/plans`, label: "Plans" },
    // Kaizen's AI manager (D103), from every platform page.
    { href: `${base}/assistant`, label: "AI manager" },
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
      groups={groups}
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
