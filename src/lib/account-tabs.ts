/**
 * My account's tabs (D480): the overview a signed-in customer lands on, their orders, their own details and their settings. Which one is
 * open is in the address (`?tab=`), so Back, a reload, a shared link and a page's way back (*← My account* from the orders) open it.
 * The overview has no `?tab=` of its own: `/account` is where every earlier link goes, and it stays the first thing anyone sees.
 */
export const ACCOUNT_TABS = ["overview", "orders", "profile", "settings"] as const;

export type AccountTabId = (typeof ACCOUNT_TABS)[number];

/** The tab an address asks for; anything else, `?tab=register` from a signed-out link included, is the overview. */
export function accountTab(value: string | string[] | undefined): AccountTabId {
  const asked = Array.isArray(value) ? value[0] : value;
  return ACCOUNT_TABS.find((tab) => tab === asked) ?? "overview";
}

/** Where a tab's link goes, from My account's own address (`marketPath(…, "/account")`). */
export function accountTabHref(account: string, tab: AccountTabId): string {
  return tab === "overview" ? account : `${account}?tab=${tab}`;
}
