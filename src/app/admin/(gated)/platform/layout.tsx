import { Suspense } from "react";

import { AdminFrame, MenuFooterLink } from "@/components/admin/admin-frame";
import { AdminAccountMenu, LevelSwitcher } from "@/components/admin/admin-shell-parts";
import { AiManagerLauncher } from "@/components/admin/ai-manager-launcher";
import { AdminTextScope } from "@/components/admin/admin-text";
import type { NavArea, NavItem } from "@/components/admin/store-admin-nav";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { LEVEL_LAYOUTS } from "@/lib/admin-layouts";
import { PLAN_ITEMS, PLATFORM_BASE, SETTINGS_ITEMS, SUPPORT_ITEMS, WEBSITE_ITEMS, platformTabs, sectionPrefixes, withBase } from "@/lib/platform-nav";
import { requirePlatformAdmin } from "@/server/auth";
import { countPendingRequests } from "@/server/platform";
import { waitingCount } from "@/server/support";
import { kaizenDesk } from "@/server/support-desk";

import {
  decidePlatformApprovalAction,
  deletePlatformConversationAction,
  loadPlatformConversationAction,
  platformHearAction,
  ratePlatformAnswerAction,
  startPlatformAssistantAction,
  savePlatformSkillAction,
} from "./assistant/actions";

/**
 * The page editor (a page's own address, or a new page, and the theme store's pages edited from Themes, D285) uses the whole width; the
 * rest of the platform admin has its sidebar.
 */
const FULL_WIDTH = String.raw`^/admin/platform/((pages|articles|headers|footers)/(new|[0-9a-f-]{36})|themes/pages/[0-9a-f-]{36}|media)$`;
/** The support inbox is drawn in the `workspace` layout with its section's pages in the top bar (D230). */
const INBOX = String.raw`^/admin/platform/support$`;

const base = PLATFORM_BASE;

/**
 * The platform's sections (D144), each with its own sidebar or none: Home, Stores, Themes (D285), Customers and Requests need none.
 * Every page of the level is in exactly one area, by its address, which also marks the section's tab.
 */
const website = sectionPrefixes("/website", WEBSITE_ITEMS);
const planPages = sectionPrefixes(null, PLAN_ITEMS);
const settings = sectionPrefixes("/settings", SETTINGS_ITEMS);
const supportPages = sectionPrefixes(null, SUPPORT_ITEMS);

const areas: NavArea[] = [
  { prefixes: [], exact: [base], groups: [] },
  { prefixes: website, groups: [{ heading: "Website", items: withBase(WEBSITE_ITEMS) }] },
  { prefixes: [`${base}/themes`, `${base}/stores`, `${base}/customers`, `${base}/requests`, `${base}/assistant`], groups: [] },
  { prefixes: planPages, groups: [{ heading: "Plans", items: withBase(PLAN_ITEMS) }] },
  { prefixes: supportPages, groups: [{ heading: "Support", items: withBase(SUPPORT_ITEMS) }] },
  { prefixes: settings, groups: [{ heading: "Settings", items: withBase(SETTINGS_ITEMS) }] },
];

/**
 * Kaizen's own admin (D107), in the same shell as a store's: the level
 * switcher and account menu in the header, the operator's sections as tabs
 * with icons, each section's own pages in its own sidebar (D144), and the whole
 * width of the screen to work in. Drawn in the `rail` layout (D219): the sections
 * are the rail's icons, Settings at its foot.
 */
export default async function PlatformLayout({ children }: LayoutProps<"/admin/platform">) {
  const account = await requirePlatformAdmin();
  const [waiting, supportWaiting] = await Promise.all([countPendingRequests(), waitingCount([(await kaizenDesk()).desk])]);
  const tabs: NavItem[] = platformTabs({ requests: waiting, support: supportWaiting });
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "shell");
  return (
    <AdminFrame
      layout={LEVEL_LAYOUTS.platform}
      lang={lang}
      switcher={
        <Suspense fallback={<span className="px-2 font-medium">{w.levels.platform}</span>}>
          <LevelSwitcher account={account} level="platform" label={w.levels.platform} />
        </Suspense>
      }
      actions={
        <AdminTextScope texts={adminTexts(lang, ["assistant"])}>
          <AiManagerLauncher
            area="platform"
            base={`${base}/assistant`}
            siteName="Kaizena Flow"
            settingsHref={`${base}/ai`}
            start={startPlatformAssistantAction}
            actions={{
              decide: decidePlatformApprovalAction,
              remove: deletePlatformConversationAction,
              load: loadPlatformConversationAction,
              rate: ratePlatformAnswerAction,
              hear: platformHearAction,
              saveSkill: savePlatformSkillAction,
            }}
          />
        </AdminTextScope>
      }
      account={<AdminAccountMenu account={account} role={w.levels.platform} />}
      tabs={tabs}
      groups={[]}
      areas={areas}
      wide
      tabsLabel={w.levels.platformSections}
      menuTitle={<span className="font-medium">{w.levels.platform}</span>}
      menuFooter={
        <>
          <MenuFooterLink href="/admin">{w.levels.controlCenter}</MenuFooterLink>
          <MenuFooterLink href="/admin/account">{w.store.yourAccount}</MenuFooterLink>
        </>
      }
      fullWidth={FULL_WIDTH}
      workspaceLinks={INBOX}
    >
      {children}
    </AdminFrame>
  );
}
