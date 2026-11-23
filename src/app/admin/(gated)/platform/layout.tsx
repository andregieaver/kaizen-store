import { after } from "next/server";
import { Suspense } from "react";

import { AdminFrame, MenuFooterLink } from "@/components/admin/admin-frame";
import { AdminAccountMenu, LevelSwitcher } from "@/components/admin/admin-shell-parts";
import { AiManagerLauncher } from "@/components/admin/ai-manager-launcher";
import { PageFinder } from "@/components/admin/page-finder";
import { PlatformRoleNotice } from "@/components/admin/platform-role-notice";
import { AdminTextScope } from "@/components/admin/admin-text";
import type { NavArea, NavItem } from "@/components/admin/store-admin-nav";
import { adminLangOf } from "@/lib/admin-lang";
import { LEVEL_LAYOUTS } from "@/lib/admin-layouts";
import { platformRoleOf } from "@/lib/platform-access";
import { PLATFORM_BASE, platformAreas, platformTabs } from "@/lib/platform-nav";
import { areaTexts } from "@/lib/admin-area";
import { ASSISTANT_BAR_WORDS } from "@/lib/admin-words/assistant-bar";
import { SHELL_WORDS } from "@/lib/admin-words/shell";
import { requirePlatformReader } from "@/server/auth";
import { noteFirstRequest } from "@/server/instance-start";
import { platformShellReads } from "@/server/admin-screens";

import {
  decidePlatformApprovalAction,
  deletePlatformConversationAction,
  loadPlatformConversationAction,
  pagePlatformHereAction,
  platformHearAction,
  ratePlatformAnswerAction,
  startPlatformAssistantAction,
  savePlatformSkillAction,
} from "./assistant/actions";
import { findPlatformPagesAction } from "./finder-actions";

/**
 * The page editor (a page's own address, or a new page, and the theme store's pages edited from Themes, D285) uses the whole width; the
 * rest of the platform admin has its sidebar.
 */
const FULL_WIDTH = String.raw`^/admin/platform/((pages|articles|headers|footers)/(new|[0-9a-f-]{36})|themes/pages/[0-9a-f-]{36}|media)$`;
/** The support inbox is drawn in the `workspace` layout with its section's pages in the top bar (D230). */
const INBOX = String.raw`^/admin/platform/support$`;

const base = PLATFORM_BASE;

/** The platform's sections (D144) and their sidebars, by address (`platformAreas()`, beside the tabs in `platform-nav.ts`). */
const areas: NavArea[] = platformAreas();

/**
 * Kaizen's own admin (D107), in the same shell as a store's: the level
 * switcher and account menu in the header, the operator's sections as tabs
 * with icons, each section's own pages in its own sidebar (D144), and the whole
 * width of the screen to work in. Drawn in the `rail` layout (D219): the sections
 * are the rail's icons, Settings at its foot.
 */
export default async function PlatformLayout({ children }: LayoutProps<"/admin/platform">) {
  const account = await requirePlatformReader();
  noteFirstRequest("platform_admin", after);
  const role = platformRoleOf(account) ?? "read_only";
  const { waiting, supportWaiting, supportRequests } = await platformShellReads();
  const tabs: NavItem[] = platformTabs({ requests: waiting, support: supportWaiting + supportRequests });
  const lang = adminLangOf(account.adminLocale);
  const w = SHELL_WORDS[lang];
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
        <>
        {/* The page finder (round 1): any platform page by name, ⌘K. */}
        <PageFinder find={findPlatformPagesAction} words={w.finder} />
        {/* The AI manager can do anything on the platform, so it is the owners' (D510). */}
        {account.platformAdmin && (
        <AdminTextScope texts={areaTexts(lang, { assistantBar: ASSISTANT_BAR_WORDS })}>
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
              pageHere: pagePlatformHereAction,
            }}
          />
        </AdminTextScope>
        )}
        </>
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
      {role !== "owner" && <PlatformRoleNotice role={role} words={w.platformRole} />}
      {children}
    </AdminFrame>
  );
}
