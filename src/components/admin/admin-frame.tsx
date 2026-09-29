import Link from "next/link";
import type { ReactNode } from "react";

import { HidingHeader, MobileMenu } from "@/components/store-chrome";

import { AdminMain } from "./admin-main";
import { StoreSidebar, StoreTabs, type NavGroup, type NavItem } from "./store-admin-nav";

/**
 * The shell every level of the admin is drawn in (D107, docs/admin-navigation.md):
 * a header that slides away while scrolling down, with the level switcher and
 * the account menu, the level's daily sections as tabs, everything else in a
 * sidebar under headings, which on phones slides out from the menu button
 * together with the tabs. A level supplies only what is its own.
 */
export function AdminFrame({
  switcher,
  actions,
  account,
  tabs,
  groups,
  tabsLabel,
  menuTitle,
  menuFooter,
  fullWidth = "^$",
  before,
  children,
}: {
  /** The level switcher (`AdminSwitcher`). */
  switcher: ReactNode;
  /** The level's own actions, beside the account menu: the AI manager, "View store". */
  actions?: ReactNode;
  /** The account menu (`AccountMenu`). */
  account: ReactNode;
  tabs: NavItem[];
  groups: NavGroup[];
  tabsLabel: string;
  /** The slide-out menu's title on phones. */
  menuTitle: ReactNode;
  /** Links at the foot of the slide-out menu. */
  menuFooter?: ReactNode;
  /** Addresses (a regular expression's source) whose page uses the whole width, without the sidebar. */
  fullWidth?: string;
  /** Something rendered before the header (scripts that only listen). */
  before?: ReactNode;
  children: ReactNode;
}) {
  const hasMenu = tabs.length > 0 || groups.length > 0 || Boolean(menuFooter);
  return (
    <>
      {before}
      <HidingHeader>
        <header className="border-b border-border bg-background">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
            {/* The slide-out menu (below) opens on any `data-open-menu` button. */}
            {hasMenu && (
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
            )}
            {switcher}
            <div className="ml-auto flex shrink-0 items-center gap-2 text-sm">
              {actions}
              {account}
            </div>
          </div>
          {tabs.length > 0 && (
            <div className="mx-auto max-w-7xl px-1 sm:px-3">
              <StoreTabs items={tabs} label={tabsLabel} />
            </div>
          )}
        </header>
      </HidingHeader>

      <AdminMain
        fullWidth={fullWidth}
        sidebar={
          groups.length > 0 ? (
            <aside className="hidden w-52 shrink-0 py-8 lg:block">
              <div className="sticky top-32">
                <StoreSidebar groups={groups} label="More" />
              </div>
            </aside>
          ) : null
        }
      >
        {children}
      </AdminMain>

      {hasMenu && (
      <MobileMenu title={menuTitle} labels={{ close: "Close menu", menu: "Menu" }}>
        <StoreSidebar groups={[...(tabs.length > 0 ? [{ heading: "Sections", items: tabs }] : []), ...groups]} label="All pages" />
        {menuFooter && <div className="flex flex-col gap-4 border-t border-border px-3 pt-6 text-sm">{menuFooter}</div>}
      </MobileMenu>
      )}
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
