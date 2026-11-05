"use client";

import { useSearchParams } from "next/navigation";
import { useSyncExternalStore, type KeyboardEvent, type MouseEvent } from "react";

import { AccountTabsView, type AccountTabsProps } from "./account-tabs-view";

const noSubscription = () => () => {};

/**
 * My account's tabs at work (D461): a tab opens at once, without asking the server, and the address follows (`?tab=`), so Back, a
 * reload and a shared link open the same tab. Any link in the page marked `data-account-tab` (the overview's *See all orders*) opens
 * its tab the same way. The arrow keys, Home and End move between the tabs, as in any row of tabs.
 */
export function AccountTabs({ label, tabs, panels }: AccountTabsProps) {
  const query = useSearchParams();
  // After the page has woken up; until then each tab is an ordinary link the Tab key reaches.
  const live = useSyncExternalStore(noSubscription, () => true, () => false);
  // The address says which tab is open, as it did for the server (`accountTab()`); anything else is the first.
  const asked = query.get("tab");
  const active = tabs.find((tab) => tab.id === asked)?.id ?? tabs[0].id;

  const open = (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab || id === active) return;
    // Next follows the browser's own history (`useSearchParams()` above), so this opens the tab, and Back closes it again.
    window.history.pushState(null, "", tab.href);
  };

  const onClick = (event: MouseEvent<HTMLElement>) => {
    // A new tab or window of the browser's own, or anything else already handled, is left to the browser.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-account-tab]");
    if (!link || !event.currentTarget.contains(link)) return;
    event.preventDefault();
    const id = link.dataset.accountTab ?? "";
    open(id);
    // A link inside a tab's content leaves the reader at the top of the tab it opened.
    if (link.getAttribute("role") !== "tab") document.getElementById(`account-tab-${id}`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const i = tabs.findIndex((tab) => tab.id === active);
    const next =
      event.key === "ArrowRight"
        ? tabs[(i + 1) % tabs.length]
        : event.key === "ArrowLeft"
          ? tabs[(i + tabs.length - 1) % tabs.length]
          : event.key === "Home"
            ? tabs[0]
            : event.key === "End"
              ? tabs[tabs.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    open(next.id);
    document.getElementById(`account-tab-${next.id}`)?.focus();
  };

  return <AccountTabsView label={label} tabs={tabs} panels={panels} active={active} live={live} onClick={onClick} onKeyDown={onKeyDown} />;
}
