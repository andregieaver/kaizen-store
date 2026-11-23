/**
 * The navigation doc (code review step 4.3, D885): the tables of `docs/admin-navigation.md`, written from the menu's own data at all three
 * levels, so the doc cannot describe a menu the code no longer has. Each level has a table of its tabs, and under *Every page* a table
 * per section with a sidebar: each page's group, label and address, whether Basic lists it (`advancedIn()`, D454, D884) and what it
 * needs (a store's feature or extension, who sees an owner's page). The prose around the `nav:generated` markers is kept by hand.
 *
 * Pure: `scripts/admin-navigation.mjs` writes and checks the file (`pnpm nav:write`, `pnpm nav:check`) and `admin-navigation.test.ts`
 * fails in CI while the two differ. The markers and the tables are the parity report's (`src/lib/parity.ts`).
 */

import { advancedIn } from "./admin-view";
import { EXTENSION_NAMES, type ExtensionId } from "./extensions";
import { ACCOUNT_GROUPS, OWNER_BASE, OWNER_EVERY_TAB, ownerTabs, type OwnerItem, type OwnerWho } from "./owner-nav";
import { cell, markerProblems, outOfDate, table, writeSections } from "./parity";
import { PLATFORM_BASE, PLATFORM_SECTIONS, platformTabs, type PlatformSection } from "./platform-nav";
import { FEATURE_IDS, FEATURES_BY_ID, type FeatureId, type FeatureRequirement } from "./store-features";
import { STORE_SECTIONS, storeTabs, type StoreSection } from "./store-nav";

/** The file, from the repository's root. */
export const NAV_DOC = "docs/admin-navigation.md";

/** The markers' tag: `<!-- nav:generated:start store-pages -->`. */
const TAG = "nav";

/** A store's addresses as the doc writes them, after the store's own. */
const STORE_BASE = "/admin/{store}";

/** Where the owner's Account tab leads, which Basic always lists (`advancedIn()`). */
const ACCOUNT_START = "/account";

type Page = { path: string; label: string; basic?: boolean; also?: readonly string[] };
type Section<P extends Page = Page> = { label: string; start: string; hub: boolean; groups: readonly { heading: string; items: readonly P[] }[] };
type Tab = { href: string; label: string; icon: string; also?: string[]; home?: true };

/** The menus the tables are written from; a test passes a changed copy. */
export type NavData = { platform: readonly PlatformSection[]; account: readonly { heading: string; items: readonly OwnerItem[] }[]; store: readonly StoreSection[] };

const MENUS: NavData = { platform: PLATFORM_SECTIONS, account: ACCOUNT_GROUPS, store: STORE_SECTIONS };

/** Who the owner's level shows a tab or a page to, beyond everyone, by `OwnerWho`'s flags. */
const ONLY_FOR: Record<keyof OwnerWho, string> = {
  owner: "owners",
  work: "people with Work in a store",
  support: "people who may read a store's support",
  books: "people who keep a store's books",
  domains: "domain holders",
};
const NOBODY: OwnerWho = { owner: false, work: false, support: false, books: false, domains: false };

const code = (text: string) => `\`${text}\``;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pagesOf = (section: Section) => section.groups.flatMap((g) => g.items);
const basicIn = (section: Section) => pagesOf(section).filter((page) => !advancedIn(section, page)).length;

/** "13 pages, 6 in Basic", "28 pages in 6 groups, 11 in Basic", or "none" for a section without a sidebar. */
function sidebarOf(section: Section): string {
  const pages = pagesOf(section).length;
  if (pages === 0) return "none";
  return `${plural(pages, "page")}${section.groups.length > 1 ? ` in ${section.groups.length} groups` : ""}, ${basicIn(section)} in Basic`;
}

/** The address a section's tab opens; "its own page" when that is the section's page (`hub`), not one of its sidebar. */
const opens = (base: string, section: Section) => `${code(`${base}${section.start}`)}${section.hub ? ", its own page" : ""}`;

/** A level's Home: its address and the pages that are Home's besides (the AI manager, a store's setup steps); it has no sidebar. */
const homeRow = (tabs: readonly Tab[]): string[] => {
  const home = tabs.find((t) => t.home)!;
  const also = home.also?.length ? `; also ${home.also.map(code).join(", ")}` : "";
  return [cell(home.label), code(home.icon), `${code(home.href)}${also}`, "none"];
};

/** The line under a level's tabs. */
function totals(sections: readonly Section[], what: string): string {
  const withPages = sections.filter((s) => pagesOf(s).length > 0);
  const pages = withPages.reduce((sum, s) => sum + pagesOf(s).length, 0);
  const basic = withPages.reduce((sum, s) => sum + basicIn(s), 0);
  return `${plural(pages, "page")} in ${plural(withPages.length, what)}, ${basic} of them in Basic.`;
}

/** A store's page or section: the features of which one is enough (D178), its paid extension (D748), and whether only customers' stores have it. */
function needs(part: { feature?: FeatureRequirement; extension?: ExtensionId; customer?: true }): string {
  const features: readonly FeatureId[] = part.feature === undefined ? [] : typeof part.feature === "string" ? [part.feature] : part.feature;
  return [features.map((id) => FEATURES_BY_ID[id].label).join(" or "), part.extension ? `the ${EXTENSION_NAMES[part.extension]} extension` : "", part.customer ? "not Kaizena Flow's own store" : ""]
    .filter(Boolean)
    .join("; ");
}

/** One section's pages: a heading, where its tab leads and what it holds, and a row a page with its group on the group's first row. */
function pagesTable<P extends Page>(level: string, base: string, section: Section<P>, line?: string, column?: { head: string; of: (page: P) => string }): string {
  const rows = section.groups.flatMap((group) =>
    group.items.map((page, i) => [
      i === 0 ? cell(group.heading) : "",
      cell(page.label),
      [page.path, ...(page.also ?? [])].map((path) => code(`${base}${path}`)).join(", also "),
      advancedIn(section, page) ? "Advanced" : "Basic",
      ...(column ? [cell(column.of(page))] : []),
    ]),
  );
  const head = ["Group", "Page", "Address", "View", ...(column ? [column.head] : [])];
  return [`### ${level} › ${section.label}`, "", [`Opens ${opens(base, section)}.`, line, `${sidebarOf(section)}.`].filter(Boolean).join(" "), "", table(head, rows)].join("\n");
}

function platformTabsTable(sections: readonly PlatformSection[]): string {
  const rows = [homeRow(platformTabs()), ...sections.map((s) => [cell(s.label), code(s.icon), opens(PLATFORM_BASE, s), sidebarOf(s)])];
  return [table(["Tab", "Icon", "Opens", "Sidebar"], rows), "", totals(sections, "sidebar")].join("\n");
}

function platformPages(sections: readonly PlatformSection[]): string {
  const also = (s: PlatformSection) => (s.also?.length ? `Also inside it: ${s.also.map((path) => code(`${PLATFORM_BASE}${path}`)).join(", ")}.` : undefined);
  return sections
    .filter((s) => pagesOf(s).length > 0)
    .map((s) => pagesTable("Platform", PLATFORM_BASE, s, also(s)))
    .join("\n\n");
}

/** Who sees a tab of the owner's level: everyone (""), or those whom one of `OwnerWho`'s flags shows it to. */
function tabOnlyFor(href: string): string {
  const shows = (who: OwnerWho) => ownerTabs(who).some((t) => t.href === href);
  if (shows(NOBODY)) return "";
  return (Object.keys(ONLY_FOR) as (keyof OwnerWho)[])
    .filter((flag) => shows({ ...NOBODY, [flag]: true }))
    .map((flag) => ONLY_FOR[flag])
    .join(" or ");
}

/** Who Account's sidebar shows a page to (`OwnerItem`): the owners' pages to owners, Your domains to a domain's holder too. */
const pageOnlyFor = (page: OwnerItem) => (page.holder ? `${ONLY_FOR.owner} or ${ONLY_FOR.domains}` : page.owner ? ONLY_FOR.owner : "");

/** The Account tab as a section: the owner's level's only sidebar. */
function accountSection(groups: NavData["account"]): Section<OwnerItem> {
  const tab = ownerTabs(OWNER_EVERY_TAB).find((t) => t.href === `${OWNER_BASE}${ACCOUNT_START}`)!;
  return { label: tab.label, start: ACCOUNT_START, hub: false, groups };
}

function ownerTabsTable(groups: NavData["account"]): string {
  const account = accountSection(groups);
  const rows = ownerTabs(OWNER_EVERY_TAB).map((t) => [
    cell(t.label),
    code(t.icon),
    code(t.href),
    t.href === `${OWNER_BASE}${ACCOUNT_START}` ? sidebarOf(account) : "none",
    tabOnlyFor(t.href),
  ]);
  return table(["Tab", "Icon", "Opens", "Sidebar", "Only for"], rows);
}

const ownerPages = (groups: NavData["account"]) => pagesTable("Owner", OWNER_BASE, accountSection(groups), undefined, { head: "Only for", of: pageOnlyFor });

function storeTabsTable(sections: readonly StoreSection[]): string {
  const rows = [[...homeRow(storeTabs(STORE_BASE, { features: [...FEATURE_IDS] })), ""], ...sections.map((s) => [cell(s.label), code(s.icon), opens(STORE_BASE, s), sidebarOf(s), needs(s)])];
  return [table(["Tab", "Icon", "Opens", "Sidebar", "Needs"], rows), "", totals(sections, "section")].join("\n");
}

function storePages(sections: readonly StoreSection[]): string {
  return sections.map((s) => pagesTable("Store", STORE_BASE, s, needs(s) ? `Needs: ${needs(s)}.` : undefined, { head: "Needs", of: needs })).join("\n\n");
}

/** Every generated table of the doc, by its marker's name. */
export function navSections(data: Partial<NavData> = {}): Record<string, string> {
  const { platform, account, store } = { ...MENUS, ...data };
  return {
    "platform-tabs": platformTabsTable(platform),
    "owner-tabs": ownerTabsTable(account),
    "store-tabs": storeTabsTable(store),
    "platform-pages": platformPages(platform),
    "owner-pages": ownerPages(account),
    "store-pages": storePages(store),
  };
}

/** What stands between the doc and the menu: broken or missing markers (fixed by hand), and tables that differ (`pnpm nav:write`). */
export function navDocProblems(doc: string, sections: Record<string, string> = navSections()): { markers: string[]; stale: string[] } {
  const markers = markerProblems(doc, sections, TAG);
  return { markers, stale: markers.length > 0 ? [] : outOfDate(doc, sections, TAG) };
}

/** The doc with its tables written from the menu; the prose outside the markers is kept. */
export const writeNavDoc = (doc: string, sections: Record<string, string> = navSections()): string => writeSections(doc, sections, TAG);
