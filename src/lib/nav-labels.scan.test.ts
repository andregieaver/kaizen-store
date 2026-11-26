import { describe, expect, it } from "vitest";

import { ADMIN_LANGS } from "./admin-lang";
import { navWord } from "./admin-nav-words";
import { levelClashes, storeClashes, type NavEntry, type SameThing } from "./nav-labels";
import { ACCOUNT_ITEMS, OWNER_BASE, ownerTabs } from "./owner-nav";
import { HOUSE_STORE_CARD } from "./house-store";
import { PLATFORM_BASE, PLATFORM_SECTIONS, platformItemsOf, platformTabs } from "./platform-nav";
import { STORE_SECTIONS } from "./store-nav";

/**
 * One word per thing in the admin's menus (ecosystem plan E3.7, D718; the rules in `nav-labels.ts`): a store's menu names each place
 * once, in English and in Norwegian, and a name the owner's or the platform's menu shares with it means the same thing there. Before
 * E3.7, Requests were the chat's hand-overs in a store and access requests on the platform, Reports three things, and a store had four
 * pages called Products, Customers or Orders.
 */

/** Every place of a store's menu, with every feature on: Home, each section's tab and each page of its sidebar. */
const STORE: NavEntry[] = [
  { label: "Home", level: "store", page: "" },
  ...STORE_SECTIONS.flatMap((s) => [
    { label: s.label, level: "store" as const, page: s.start },
    ...s.groups.flatMap((g) => g.items.map((i) => ({ label: i.label, level: "store" as const, page: i.path }))),
  ]),
];

const after = (base: string, href: string) => href.slice(base.length);

/** Every place of the owner's menu (an owner who also has Work, support, books and domains) and of the platform's. */
const OTHERS: NavEntry[] = [
  ...ownerTabs({ owner: true, work: true, support: true, books: true, domains: true }).map((t) => ({ label: t.label, level: "owner" as const, page: after(OWNER_BASE, t.href) })),
  ...ACCOUNT_ITEMS.map((i) => ({ label: i.label, level: "owner" as const, page: i.path })),
  ...platformTabs().map((t) => ({ label: t.label, level: "platform" as const, page: after(PLATFORM_BASE, t.href) })),
  ...PLATFORM_SECTIONS.flatMap(platformItemsOf).map((i) => ({ label: i.label, level: "platform" as const, page: i.path })),
  { label: HOUSE_STORE_CARD.label, level: "platform", page: HOUSE_STORE_CARD.href },
];

/**
 * Names the owner's or the platform's menu shares with a store's on purpose: the same thing at that level (Kaizena Flow's own site, its
 * own customers, its own support desk), as the platform is built with every store feature (CLAUDE.md). A pair is two English names one
 * language says alike. Every entry must still be needed: one no menu shares is a stale reason.
 */
const SAME_THING: SameThing[] = [
  { labels: ["Home"], why: "each level's first page" },
  { labels: ["Website"], why: "the level's own site: Kaizena Flow's, or the store's" },
  { labels: ["Customers"], why: "the level's own customers: the platform's are the owners who pay a plan" },
  { labels: ["Support"], why: "the level's own support desk; the owner's tab is every store's inbox together" },
  { labels: ["Settings"], why: "the level's own settings" },
  { labels: ["Books"], why: "the store's own books; the owner's tab is the books an accountant keeps for many stores" },
  { labels: ["Billing"], why: "a store's plan; the owner's page is every store's plan together" },
  { labels: ["Pages"], why: "the level's own pages" },
  { labels: ["Blog"], why: "the level's own blog" },
  { labels: ["Content"], why: "the level's own kinds of content" },
  { labels: ["Media"], why: "the level's own pictures and videos" },
  { labels: ["Menus"], why: "the level's own menus" },
  { labels: ["Forms"], why: "the level's own forms" },
  { labels: ["Design"], why: "the look of the level's own site" },
  { labels: ["Inbox"], why: "the level's own support inbox" },
  { labels: ["Support reports"], why: "the level's own support desk in figures" },
  { labels: ["Saved replies"], why: "the level's own support desk's saved replies" },
  { labels: ["Chat assistant"], why: "the level's own chat assistant" },
  { labels: ["Website chat"], why: "the level's own chat on other websites" },
  { labels: ["Support settings"], why: "the level's own support desk's settings" },
  { labels: ["Header and footer"], why: "the level's own standard header and footer" },
  { labels: ["Headers"], why: "the level's own headers built from components" },
  { labels: ["Footers"], why: "the level's own footers built from components" },
  { labels: ["A/B tests"], why: "A/B tests: the platform's page reads every store's" },
  { labels: ["AI"], why: "the AI provider and models: the platform's default, a store's own" },
  { labels: ["Integrations"], why: "the level's own connected services" },
  { labels: ["Workflows"], why: "the level's own workflows" },
  { labels: ["Domains"], why: "domains: a store's addresses, the ones stores buy through Kaizena Flow" },
  { labels: ["Emails"], why: "the emails the level sent" },
  { labels: ["Team"], why: "the people who run the level" },
  { labels: ["Projects"], why: "the level's own projects: Kaizena Flow's live in its store, and the platform's link opens them there (D904 P7.1)" },
  { labels: ["Change log"], why: "the level's own change log (the audit log)" },
  { labels: ["Discounts"], why: "money off what the level sells: a store's goods, Kaizena Flow's plans" },
  { labels: ["Plans", "Subscriptions"], why: "what the level's customers subscribe to; Norwegian says both «Abonnementer»" },
  { labels: ["Plan analytics", "Subscription analytics"], why: "the recurring revenue of those subscriptions; Norwegian says both «Abonnementsanalyse»" },
];

describe("one word per thing in the admin's menus (ecosystem plan E3.7, D718)", () => {
  for (const lang of ADMIN_LANGS) {
    it(`names each place of a store's menu once (${lang})`, () => {
      expect(storeClashes(STORE, (label) => navWord(lang, label))).toEqual([]);
    });

    it(`shares a name with the owner's and the platform's menus only for the same thing (${lang})`, () => {
      expect(levelClashes(STORE, OTHERS, SAME_THING, (label) => navWord(lang, label)).clashes).toEqual([]);
    });
  }

  it("keeps no same-thing reason a menu no longer needs, and each says why", () => {
    const used = new Set(ADMIN_LANGS.flatMap((lang) => [...levelClashes(STORE, OTHERS, SAME_THING, (label) => navWord(lang, label)).used]));
    expect(SAME_THING.filter((_, i) => !used.has(i)).map((s) => s.labels.join(" / "))).toEqual([]);
    for (const s of SAME_THING) expect(s.why.length, s.labels.join(" / ")).toBeGreaterThan(10);
  });

  it("holds the names E3.7 chose apart", () => {
    const labels = new Set(STORE.map((e) => e.label));
    for (const gone of ["Campaigns", "Coupons", "Referral program", "Activity log"]) expect(labels.has(gone), gone).toBe(false);
    expect(OTHERS.find((e) => e.page === "/requests")?.label).toBe("Access requests");
    expect(OTHERS.find((e) => e.page === "/reports")?.label).toBe("Content notices");
  });
});
