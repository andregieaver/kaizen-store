import Link from "next/link";
import type { ReactNode } from "react";

import { HidingHeader, MobileMenu } from "@/components/store-chrome";

import type { AdminLang } from "@/lib/admin-lang";
import type { AdminLayoutId } from "@/lib/admin-layouts";
import { navAreasIn, navItemsIn } from "@/lib/admin-nav-words";
import { adminText } from "@/lib/admin-text";

import { AdminMain } from "./admin-main";
import { ByPath } from "./by-path";
import { AdminRail } from "./admin-rail";
import { ShortcutSheet } from "./shortcut-sheet";
import { AdminTooltips } from "./tooltips";
import { AreaLinks, AreaMenu, AreaSidebar, StoreSidebar, StoreTabs, type NavArea, type NavGroup, type NavItem } from "./store-admin-nav";

/**
 * The shell every level of the admin is drawn in (D107, docs/admin-navigation.md):
 * a header that slides away while scrolling down, with the level switcher and
 * the account menu, the level's daily sections as tabs, everything else in a
 * sidebar under headings, which on phones slides out from the menu button
 * together with the tabs. A level supplies only what is its own.
 *
 * `layout` (docs/admin-style.md section 6, `src/lib/admin-layouts.ts`): `classic` is the above; `rail` puts the tabs in a dark rail
 * of icons at the left (`AdminRail`) and draws a plain top bar with the switcher, the actions and the account, no tabs: a region a
 * layout leaves out is not rendered. Phones draw both the same: the top bar and the slide-out menu.
 *
 * `lang` is the account's (D312 A2): the frame's own words are the `shell` catalogue's, and the tabs, sidebars and their headings, written
 * in English in the levels' navigation, are shown through `navWord()`.
 */
export function AdminFrame({
  switcher,
  actions,
  account,
  tabs: tabsGiven,
  groups: groupsGiven,
  areas: areasGiven,
  wide = false,
  tabsLabel,
  menuTitle,
  menuFooter,
  fullWidth = "^$",
  workspaceLinks,
  before,
  layout = "classic",
  focus,
  home,
  lang = "en",
  children,
}: {
  /** The level switcher (`AdminSwitcher`). */
  switcher: ReactNode;
  /** The level's own actions, beside the account menu: the AI manager, "View store". */
  actions?: ReactNode;
  /** The account menu (`AccountMenu`). */
  account: ReactNode;
  tabs: NavItem[];
  /** The sidebar, the same on every page of the level. */
  groups: NavGroup[];
  /** Instead, a sidebar for each section of the level, or none for a section that has none (D144); `groups` are for pages in no area. */
  areas?: NavArea[];
  /** The header and the main area use the whole width of the screen instead of the content width (D144). */
  wide?: boolean;
  tabsLabel: string;
  /** The slide-out menu's title on phones. */
  menuTitle: ReactNode;
  /** Links at the foot of the slide-out menu. */
  menuFooter?: ReactNode;
  /**
   * Addresses (a regular expression's source) drawn in the `workspace` layout (docs/admin-style.md 6.3): a tool with columns of its own
   * (the page builder, the media library) that uses the whole width, without the sidebar, beside a rail narrowed to 64 px.
   */
  fullWidth?: string;
  /** Workspace pages that also show their section's pages in the top bar, having no sidebar for them (the support inbox). */
  workspaceLinks?: string;
  /** Something rendered before the header (scripts that only listen). */
  before?: ReactNode;
  layout?: AdminLayoutId;
  /**
   * Addresses drawn in the `focus` layout (docs/admin-style.md 6.3, a regular expression's source): no rail, sidebar, tabs or menu, a top
   * bar with a way back and what is being done, and the page in one column (the setup wizard).
   */
  focus?: { pattern: string; back: { href: string; label: string }; title: ReactNode };
  /** The rail's logo tile: where it leads and its name. */
  home?: { href: string; label: string };
  /** The account's language for the admin. */
  lang?: AdminLang;
  children: ReactNode;
}) {
  const w = adminText(lang, "shell").frame;
  // `?` lists the admin's keyboard shortcuts on every page (PSI UX-07).
  const sheet = (
    <>
      <ShortcutSheet words={adminText(lang, "shell").shortcuts} />
      <AdminTooltips />
    </>
  );
  const tabs = navItemsIn(lang, tabsGiven);
  const groups = navAreasIn(lang, [{ groups: groupsGiven }])[0].groups;
  const areas = areasGiven && navAreasIn(lang, areasGiven);
  const workspace = workspaceLinks ? `(?:${fullWidth})|(?:${workspaceLinks})` : fullWidth;
  const hasMenu = tabs.length > 0 || groups.length > 0 || (areas?.length ?? 0) > 0 || Boolean(menuFooter);
  const bar = wide ? "" : "max-w-7xl";
  // Under `lg` a section's sidebar is not drawn (beside the rail too), so its pages are in the slide-out menu.
  const menuButton = hasMenu && (
    <button
      type="button"
      data-open-menu
      aria-haspopup="dialog"
      className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-pill hover:bg-sunken lg:hidden"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{w.menu}</span>
    </button>
  );
  const sidebar = (railed: boolean) =>
    areas ? (
      <AreaSidebar areas={areas} fallback={groups} label={w.more} railed={railed} />
    ) : groups.length > 0 ? (
      <aside className={`hidden w-52 shrink-0 lg:block ${railed ? "pt-2 pb-8" : "py-8"}`}>
        <div className={`sticky ${railed ? "top-6" : "top-32"}`}>
          <StoreSidebar groups={groups} label={w.more} />
        </div>
      </aside>
    ) : null;
  const menu = hasMenu && (
    <MobileMenu title={menuTitle} labels={{ close: w.closeMenu, menu: w.menu }}>
      {areas ? (
        <AreaMenu
          tabs={tabs}
          areas={areas}
          fallback={groups}
          label={w.allPages}
          footer={menuFooter && <div className="flex flex-col gap-4 border-t border-line px-3 pt-6 text-sm">{menuFooter}</div>}
        />
      ) : (
        <>
          <StoreSidebar groups={[...(tabs.length > 0 ? [{ heading: w.sections, items: tabs }] : []), ...groups]} label={w.allPages} />
          {menuFooter && <div className="flex flex-col gap-4 border-t border-line px-3 pt-6 text-sm">{menuFooter}</div>}
        </>
      )}
    </MobileMenu>
  );

  // The first stop for a keyboard: past the rail, the bar and the sidebar to the page (PSI 2026-10-24, ACC-02).
  const skip = (
    <a
      href="#admin-main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-pill focus:bg-card focus:px-4 focus:py-2 focus:text-ink focus:shadow"
    >
      {w.skipToContent}
    </a>
  );

  // A page in the `focus` layout keeps the level's account menu and nothing of its navigation.
  const focused = (normal: ReactNode, inFocus: ReactNode) =>
    focus ? <ByPath pattern={focus.pattern} match={inFocus} otherwise={normal} /> : normal;
  const focusStart = focus && (
    <div className="flex min-w-0 items-center gap-3">
      <Link href={focus.back.href} className="inline-flex shrink-0 items-center gap-1 text-body text-ink-2 hover:text-ink">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {focus.back.label}
      </Link>
      <span aria-hidden className="h-5 w-px bg-line" />
      <span className="truncate text-body-strong text-ink">{focus.title}</span>
    </div>
  );

  if (layout === "rail") {
    // The rail (docs/admin-style.md 5.3, 5.4): the sections down the left, then a plain bar over the page, no background or line.
    return (
      <>
        {skip}
        {sheet}
        {before}
        <div data-admin-layout="rail" className="flex min-h-dvh w-full flex-1">
          {focused(<AdminRail items={tabs} home={home ?? { href: "/admin", label: "Kaizena Flow" }} label={tabsLabel} collapseOn={workspace} />, null)}
          <div className="flex min-w-0 flex-1 flex-col">
            <header data-admin-topbar className="flex h-16 shrink-0 items-center gap-2 px-4 md:px-8">
              {focused(
                <>
                  {menuButton}
                  {switcher}
                  {workspaceLinks && (
                    <ByPath pattern={workspaceLinks} match={<AreaLinks areas={areas ?? []} fallback={groups} label={w.thisSection} />} otherwise={null} />
                  )}
                </>,
                focusStart,
              )}
              <div className="ml-auto flex shrink-0 items-center gap-2 text-sm">
                {focused(actions, null)}
                {account}
              </div>
            </header>
            <AdminMain fullWidth={workspace} focus={focus?.pattern} wide={wide} railed sidebar={sidebar(true)}>
              {children}
            </AdminMain>
          </div>
        </div>
        {menu}
      </>
    );
  }

  return (
    <>
      {skip}
      {sheet}
      {before}
      <HidingHeader>
        <header className="border-b border-line bg-card">
          <div className={`mx-auto flex h-14 items-center gap-2 px-4 ${bar}`}>
            {/* The slide-out menu (below) opens on any `data-open-menu` button. */}
            {menuButton}
            {switcher}
            <div className="ml-auto flex shrink-0 items-center gap-2 text-sm">
              {actions}
              {account}
            </div>
          </div>
          {tabs.length > 0 && (
            <div className={`mx-auto px-1 sm:px-3 ${bar}`}>
              <StoreTabs items={tabs} label={tabsLabel} />
            </div>
          )}
        </header>
      </HidingHeader>

      <AdminMain
        fullWidth={fullWidth}
        wide={wide}
        sidebar={sidebar(false)}
      >
        {children}
      </AdminMain>

      {menu}
    </>
  );
}

/** A slide-out menu's plain link. */
export function MenuFooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="underline">
      {children}
    </Link>
  );
}
