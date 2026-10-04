import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { DEFAULT_A11Y_SETTINGS, ENFORCEMENT_BODIES, type A11yFacts } from "@/lib/a11y-statement";
import type { ActivityEntry } from "@/server/activity";
import type { LegalOverview } from "@/server/legal-starters";

import { AccessibilityForm, factLines } from "./a11y-statement-form";
import { ActivityFilters, ActivityList, valuesFromQuery } from "./activity-view";
import { LegalPagesPanel } from "./legal-pages-panel";
import { PageIssuesPanel, PublishWithIssuesDialog } from "./page-issues-panel";

const html = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/ /g, " ");

const action = async () => ({ status: "ok" as const, messages: [] });

describe("the activity log", () => {
  const entry = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
    id: 7,
    at: "2026-10-03T08:30:00.000Z",
    accountId: "a",
    email: "anna@example.no",
    name: "Anna",
    avatarPath: null,
    action: "product.price_changed",
    area: "products",
    target: { type: "product", id: "p1", label: "Demo: Lampe" },
    summary: "Changed the price of Demo: Lampe",
    changes: { price: { from: 1000, to: 1200 }, note: { changed: true } },
    ...over,
  });

  it("says what happened, who did it, where it belongs and when, with the changes as from and to", () => {
    const out = html(createElement(ActivityList, { entries: [entry()], zone: "Europe/Oslo" }));
    expect(out).toContain("Changed the price of Demo: Lampe");
    expect(out).toContain("Anna");
    expect(out).toContain("Products");
    expect(out).toContain("3 Oct 2026, 10:30");
    expect(out).toContain("1000 → 1200");
    // A field whose value is never recorded says only that it changed.
    expect(out).toMatch(/Note<\/dt><dd[^>]*>changed</);
  });

  it("says when there is nothing, and links to older entries when there are more", () => {
    expect(html(createElement(ActivityList, { entries: [], zone: "UTC" }))).toContain("Nothing has been logged");
    const out = html(createElement(ActivityList, { entries: [entry()], zone: "UTC", older: "/admin/kaffe/activity?before=7" }));
    expect(out).toContain('href="/admin/kaffe/activity?before=7"');
    expect(out).toContain("Older entries");
  });

  it("names the platform when an entry has no person", () => {
    const out = html(createElement(ActivityList, { entries: [entry({ email: null, name: null, accountId: null })], zone: "UTC" }));
    expect(out).toContain("The platform");
  });

  const filters = (extra: Record<string, unknown> = {}) =>
    html(
      createElement(ActivityFilters, {
        action: "/admin/kaffe/activity",
        values: { person: "", area: "", action: "", from: "", to: "" },
        people: [{ accountId: "a", label: "Anna" }, { accountId: "b", label: "Bo", current: false }],
        areas: ["orders", "products"],
        actions: ["product.price_changed"],
        zoneName: "Europe/Oslo",
        ...extra,
      }),
    );

  it("filters by person, area, action and period, with the retention said", () => {
    const out = filters();
    expect(out).toContain("Everyone");
    expect(out).toContain("Bo (past)");
    expect(out).toContain("All areas");
    expect(out).toContain("Product: price changed");
    expect(out).toContain('name="from"');
    expect(out).toContain('name="to"');
    expect(out).toContain("Entries are kept for 24 months.");
    expect(out).toContain("Days are in Europe/Oslo.");
  });

  it("offers the CSV only where an address for it is given (owners), needing both days", () => {
    expect(filters()).not.toContain("Download CSV");
    const out = filters({ exportAction: "/admin/kaffe/activity/export" });
    expect(out).toContain("Download CSV");
    expect(out).toContain('action="/admin/kaffe/activity/export"');
    // Both days are required in the CSV form, and only there.
    expect(out.match(/<input type="date"[^>]*required=""/g)).toHaveLength(2);
  });

  it("reads the filters from the address", () => {
    expect(valuesFromQuery({ person: "x", area: ["a", "b"], from: "2026-10-01" })).toEqual({ person: "x", area: "", action: "", from: "2026-10-01", to: "" });
  });
});

describe("the legal pages", () => {
  const overview = (over: Partial<LegalOverview> = {}): LegalOverview => ({
    roles: [
      { role: "terms", name: "Terms of sale", hint: "h", starter: true, page: { id: "p1", title: "Kjøpsvilkår", slug: "kjopsvilkar" }, draft: null },
      { role: "privacy", name: "Privacy statement", hint: "h", starter: true, page: null, draft: { id: "p2", title: "Personvern", slug: "personvern", published: false } },
      { role: "accessibility", name: "Accessibility statement", hint: "h", starter: false, page: null, draft: null },
    ],
    choosable: [
      { id: "p1", title: "Kjøpsvilkår", slug: "kjopsvilkar", role: "terms" },
      { id: "p3", title: "Om oss", slug: "om-oss", role: null },
      { id: "p4", title: "Frakt", slug: "frakt", role: "shipping_policy" },
    ],
    termsAtCheckout: "link",
    missing: ["The organisation number"],
    ...over,
  });
  const panel = (over: Partial<LegalOverview> = {}) =>
    html(createElement(LegalPagesPanel, { overview: overview(over), storeSlug: "kaffe", actions: { createStarter: action as never, setRole: action as never, setTerms: action } }));

  it("opens with the notice that the drafts are not legal advice and need a review", () => {
    const out = panel();
    expect(out).toContain("Draft texts need a person's review");
    expect(out).toContain("not legal advice");
    expect(out).toContain("no lawyer has checked them");
  });

  it("lists what the store has not given, with where to give it", () => {
    const out = panel();
    expect(out).toContain("The organisation number");
    expect(out).toContain("/admin/kaffe/settings/company");
    expect(panel({ missing: [] })).not.toContain("the store has not given");
  });

  it("offers a starter draft for a kind with none and a new draft where one exists, and none for the statement", () => {
    const out = panel();
    expect(out).toContain("Create a starter draft<span class=\"sr-only\"> of Terms of sale");
    expect(out).toContain("Create a new draft<span class=\"sr-only\"> of Privacy statement");
    expect(out).toContain("Made on the Accessibility page");
    expect(out).toContain("/admin/kaffe/pages/p2");
    expect(out).toContain("(a draft, not published)");
  });

  it("chooses among published pages, and a page that holds another place cannot be taken", () => {
    const out = panel();
    expect(out).toContain("None: nothing chosen");
    expect(out).toContain('value="p1" selected=""');
    expect(out).toMatch(/<option value="p4" disabled="">Frakt \(already the shipping policy\)/);
    expect(out).toMatch(/<option value="p3">Om oss<\/option>/);
  });

  it("offers link, tick box and off at checkout, with the one that is set chosen, and says when it cannot be honoured", () => {
    const out = panel();
    for (const word of ["Link", "Tick box", "Off"]) expect(out).toContain(`<span class="font-medium">${word}</span>`);
    expect(out).toMatch(/name="mode" value="link" checked=""|name="mode" checked="" value="link"/);
    expect(panel({ termsAtCheckout: "checkbox", roles: overview().roles.map((r) => ({ ...r, page: null })) })).toContain("No terms page is chosen");
    expect(panel({ termsAtCheckout: "off" })).not.toContain("No terms page is chosen");
  });
});

describe("the accessibility page", () => {
  const facts = (over: Partial<A11yFacts> = {}): A11yFacts => ({
    storeName: "Kaffe",
    siteAddresses: ["https://kaffe.example/s/kaffe/no"],
    languages: ["Norwegian"],
    countries: ["NO"],
    themeWarnings: 2,
    mediaWithoutAlt: { missing: 3, total: 10 },
    pagesWithBlockingIssues: 1,
    ...over,
  });

  it("says what the site knows, and never zero for what it cannot know", () => {
    expect(factLines(facts())).toEqual([
      "2 of the theme's colour pairs are below the 4.5 to 1 contrast the standard asks for (see Design).",
      "3 of 10 pictures in the media library have no alt text.",
      "1 published page has a problem the page checker blocks on.",
    ]);
    const unknown = factLines(facts({ themeWarnings: 0, mediaWithoutAlt: null, pagesWithBlockingIssues: null })).join(" ");
    expect(unknown).toContain("all reach the 4.5 to 1 contrast");
    expect(unknown).toContain("is not known");
    expect(factLines(facts({ mediaWithoutAlt: { missing: 0, total: 0 } }))[1]).toBe("The media library holds no pictures yet.");
  });

  const form = (settings = DEFAULT_A11Y_SETTINGS) =>
    html(createElement(AccessibilityForm, { settings, facts: facts(), body: ENFORCEMENT_BODIES.NO, contactDefault: "post@kaffe.no", actions: { save: action, createStatement: action }, legalHref: "/admin/kaffe/settings/legal" }));

  it("starts at not assessed, and says an automated check is not an assessment", () => {
    const out = form();
    expect(out).toContain("Not assessed");
    expect(out).toMatch(/name="status" value="not_assessed" checked=""|name="status" checked="" value="not_assessed"/);
    expect(out).toContain("An automated check finds only part of the problems");
    expect(out).toContain("never says the site meets the requirements on its own");
  });

  it("names the enforcement body as not verified until somebody has confirmed it", () => {
    const out = form();
    expect(out).toContain("Digitaliseringsdirektoratet");
    expect(out).toContain("not verified");
    expect(html(createElement(AccessibilityForm, { settings: DEFAULT_A11Y_SETTINGS, facts: facts(), body: null, contactDefault: null, actions: { save: action, createStatement: action }, legalHref: "/x" }))).not.toContain("the statement names");
  });

  it("has a microenterprise tick that is off by default, a draft button and a link to the legal pages", () => {
    const out = form();
    expect(out).toMatch(/name="microenterprise"(?![^>]*checked)/);
    expect(out).toContain("Create a draft statement");
    expect(out).toContain('href="/admin/kaffe/settings/legal"');
    expect(out).toContain('placeholder="post@kaffe.no"');
  });
});

describe("the page checker's panel", () => {
  const issue = { rule: "image_alt" as const, severity: "blocking" as const, blockId: "b1", rowId: "r1", columnId: "c1", where: "Picture", message: "This picture has no alt text." };
  const warning = { rule: "heading_order" as const, severity: "warning" as const, blockId: "b2", rowId: "r1", columnId: "c1", where: "Heading", message: "Heading level 4 follows level 2: a level is skipped." };
  const title = { rule: "placeholder" as const, severity: "blocking" as const, blockId: null, rowId: null, columnId: null, where: "Title", message: "The page's title has text still to fill in ([[…]])." };

  it("says there are no problems", () => {
    expect(html(createElement(PageIssuesPanel, { issues: [] }))).toContain("No problems found.");
  });

  it("counts what blocks publishing and what is worth a look, blocking first", () => {
    const out = html(createElement(PageIssuesPanel, { issues: [warning, issue] }));
    expect(out).toContain("1 to fix before publishing, 1 to look at.");
    expect(out.indexOf("blocks publishing")).toBeLessThan(out.indexOf("worth a look"));
    expect(html(createElement(PageIssuesPanel, { issues: [warning] }))).toContain("Nothing blocks publishing: 1 to look at.");
  });

  it("gives each problem a way to the component, except the title, which has none", () => {
    const out = html(createElement(PageIssuesPanel, { issues: [issue, title] }));
    expect(out.match(/Show it/g)).toHaveLength(1);
    expect(out).toContain('aria-label="Show the picture on the page:');
  });

  it("says what it cannot see", () => {
    expect(html(createElement(PageIssuesPanel, { issues: [] }))).toContain("Pictures behind text are not checked.");
  });

  it("asks before publishing with a blocking problem, and says it is written down", () => {
    const out = html(createElement(PublishWithIssuesDialog, { issues: [issue, issue], busy: false, onPublishAnyway: () => {}, onFixFirst: () => {} }));
    expect(out).toContain("This page has 2 problems to look at");
    expect(out).toContain("Publish anyway");
    expect(out).toContain("Fix first");
    expect(out).toContain("written down in the activity log");
    expect(html(createElement(PublishWithIssuesDialog, { issues: [issue], busy: true, onPublishAnyway: () => {}, onFixFirst: () => {} }))).toContain("This page has a problem to look at");
  });
});
