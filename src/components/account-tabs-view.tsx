import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import { Icon, type IconName } from "./icons";

/** One of My account's tabs: its name in the address (`?tab=`), its words, its picture and where its link goes. */
export type AccountTab = { id: string; label: string; icon: IconName; href: string };

export type AccountTabsProps = {
  /** What the row of tabs is called for a screen reader: the store's words for My account. */
  label: string;
  tabs: AccountTab[];
  /** The tab the server drew open, from the address. */
  initial: string;
  /** Each tab's content, drawn by the server, by the tab's id. */
  panels: Record<string, ReactNode>;
};

/**
 * My account's tabs as they are drawn (D480): a row of links, each a tab with a picture over its words on a phone and beside them on a
 * wider screen, and every tab's content, all but the open one hidden (so what was typed in one is still there on coming back). Each
 * tab is a real link (`?tab=`), so a tab opens without the page's script too; with it, `AccountTabs` opens them at once.
 */
export function AccountTabsView({
  label,
  tabs,
  panels,
  active,
  live = false,
  onKeyDown,
  onClick,
}: Omit<AccountTabsProps, "initial"> & {
  active: string;
  /** Whether the script runs: only then do the arrow keys move between the tabs, so only then does one tab take the Tab key. */
  live?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
}) {
  return (
    <div className="flex flex-col gap-8" onClick={onClick}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="grid gap-1 rounded-button bg-surface p-1"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => {
          const on = tab.id === active;
          return (
            <a
              key={tab.id}
              id={`account-tab-${tab.id}`}
              href={tab.href}
              role="tab"
              aria-selected={on}
              aria-controls={`account-panel-${tab.id}`}
              data-account-tab={tab.id}
              tabIndex={live ? (on ? 0 : -1) : undefined}
              className={`flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-button px-1 py-2 text-xs font-medium transition-colors sm:flex-row sm:gap-2 sm:px-3 sm:text-sm ${
                on ? "bg-background text-foreground shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              <Icon name={tab.icon} className="size-5 shrink-0" />
              <span className="max-w-full truncate">{tab.label}</span>
            </a>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`account-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`account-tab-${tab.id}`}
          hidden={tab.id !== active}
          className="flex flex-col gap-8"
        >
          {panels[tab.id]}
        </div>
      ))}
    </div>
  );
}
