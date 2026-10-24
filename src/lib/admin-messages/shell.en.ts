import type { Widen } from "./common.en";

/**
 * The words of the admin's shell (D312 A2): the frame and its slide-out menu, the rail, the level switcher, and what each level's layout
 * says around its pages. The navigation's own words (sections, sidebars, cards) are `nav.nb.ts`, read by `navWord()`. `{name}`, `{count}`
 * and `{email}` are filled in by `fillWords()`.
 */
export const shellEn = {
  frame: {
    more: "More",
    menu: "Menu",
    closeMenu: "Close menu",
    allPages: "All pages",
    sections: "Sections",
    thisSection: "This section",
    loading: "Loading …",
    skipToContent: "Skip to content",
  },
  rail: {
    narrowSidebar: "Narrow the sidebar",
    widenSidebar: "Widen the sidebar",
    narrow: "Narrow",
  },
  switcher: {
    goTo: "Go to",
    controlCenter: "Control center",
    allYourStoresShort: "all your stores",
    stores: "Stores",
    suspended: "Suspended",
    staff: "Staff",
    allStores: "All {count} stores",
    platform: "Platform",
    waiting: "{count} waiting",
    you: "You",
    yourAccount: "Your account",
    billing: "Billing",
    aiUsage: "AI usage",
    accountMenu: "Account menu, {email}",
  },
  levels: {
    controlCenter: "Control center",
    yourStores: "Your stores",
    platform: "Platform",
    hosting: "Hosting",
    host: "Host",
    platformSections: "Platform sections",
    controlCenterSections: "Control center sections",
    storeSections: "Main sections",
  },
  store: {
    homeLabel: "Kaizena Flow: all your stores",
    viewStore: "View store",
    allYourStores: "All your stores",
    yourAccount: "Your account",
    leaveSetup: "Leave setup",
    settingUp: "Setting up {name}",
    demoLive: "This store is a demo store, live.",
    demoNotPublished: "This store is a demo store, not published yet.",
    demoLiveText: "Every change here shows on it at once, and the theme's page lists it under See it live.",
    demoDraftText: "Publish it from its page to put it live; the theme's page then lists it under See it live.",
    demoRules: "It takes no orders, sends no emails to shoppers and is never shown to search engines.",
    itsPage: "Its page",
    startingContent: "This store is starting content.",
    startingContentText:
      "A theme shown on it is previewed with its products, services, staff, pages, menus, settings and page drafts, and new stores that start from that theme begin with them, as they were when it was last published: changes made here reach new stores when it is published again. It takes no orders and is never shown to search engines.",
    suspended: "This store is suspended.",
    closed: "This store is closed.",
    suspendedText: "Kaizena Flow has paused it: it takes no orders and cannot be changed. You can still see and handle what was already sold.",
    closedText: "It takes no orders. Its orders, invoices, returns and customer data stay here to read and download.",
    reopen: "Reopen the store",
    aboutReopening: "About reopening",
  },
};

export type ShellMessages = Widen<typeof shellEn>;
