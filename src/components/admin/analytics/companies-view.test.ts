import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { companiesEn } from "@/lib/admin-messages/companies.en";
import type { CompanySummary } from "@/lib/company-lookup";
import type { VisitCompany } from "@/server/company-visits";

import { CompaniesSection, type CompaniesSettings } from "./companies-settings";
import { CompaniesView, type CompaniesViewProps } from "./companies-view";

/** Which companies visited (D890): the Companies page and its switch on Analytics → Settings, as the owner reads them. */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const action = async () => ({ status: "ok" as const, messages: [] });

const company: VisitCompany = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Nordfjord Energi AS",
  legalForm: "AS",
  domain: "nordfjord-energi.no",
  countryCode: "NO",
  city: "Oslo",
  industry: "Production of electricity",
  employees: "101-500",
  registerId: "923609016",
  doNotContact: false,
};

const summary: CompanySummary = {
  companyId: company.id,
  visits: 3,
  days: 2,
  pageViews: 7,
  lastSeen: "2026-11-22T09:00:00.000Z",
  series: [2, 0, 1],
  pages: [
    { page: "/no/pricing", views: 4 },
    { page: "/no", views: 2 },
    { page: "/no/features", views: 1 },
    { page: "/no/about", views: 1 },
    { page: "/no/blog", views: 1 },
    { page: "(other)", views: 1 },
  ],
};

const props = (over: Partial<CompaniesViewProps> = {}): CompaniesViewProps => ({
  base: "/admin/kaizenaflow",
  lang: "en",
  timeZone: "Europe/Oslo",
  state: "on",
  owner: true,
  marketless: true,
  days: ["2026-11-20", "2026-11-21", "2026-11-22"],
  summaries: [summary],
  companies: new Map([[company.id, company]]),
  words: companiesEn,
  ...over,
});

describe("the Companies page (D890)", () => {
  it("shows a company with its facts, visits, days and pages, without the country a marketless store's addresses lack", () => {
    const markup = html(h(CompaniesView, props()));
    expect(markup).toContain("Nordfjord Energi AS");
    expect(markup).toContain("Production of electricity · 101-500 employees · Oslo, NO");
    expect(markup).toContain('href="https://nordfjord-energi.no"');
    expect(markup).toContain("3 visits");
    expect(markup).toContain("on 2 days");
    expect(markup).toContain("/pricing");
    expect(markup).not.toContain("/no/pricing");
    expect(markup).toContain(companiesEn.frontPage);
    expect(markup).toContain("and 2 more");
    expect(markup).toContain(companiesEn.note);
  });

  it("draws a bar for each day with visits, and none for a day without", () => {
    const markup = html(h(CompaniesView, props()));
    expect(markup.match(/<rect /g) ?? []).toHaveLength(2);
    expect(markup).toContain('aria-hidden="true"');
  });

  it("says so when the company asks not to be contacted for advertising", () => {
    const markup = html(h(CompaniesView, props({ companies: new Map([[company.id, { ...company, doNotContact: true }]]) })));
    expect(markup).toContain(companiesEn.doNotContact);
  });

  it("off with nothing counted: one button to the switch, for the owner only", () => {
    const off = html(h(CompaniesView, props({ state: "off", summaries: [] })));
    expect(off).toContain(companiesEn.off);
    expect(off).toContain('href="/admin/kaizenaflow/analytics/settings#companies"');
    expect(html(h(CompaniesView, props({ state: "off", summaries: [], owner: false })))).not.toContain("analytics/settings");
  });

  it("says what is missing: the connection, or a first company", () => {
    expect(html(h(CompaniesView, props({ state: "not_connected", summaries: [] })))).toContain(companiesEn.notConnected);
    expect(html(h(CompaniesView, props({ state: "waiting", summaries: [] })))).toContain(companiesEn.waiting);
    expect(html(h(CompaniesView, props({ state: "on", summaries: [] })))).toContain(companiesEn.emptyPeriod);
  });

  it("writes a company's name as text, never as markup", () => {
    const markup = html(h(CompaniesView, props({ companies: new Map([[company.id, { ...company, name: "<img src=x onerror=alert(1)>" }]]) })));
    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img");
  });
});

const settings = (over: Partial<CompaniesSettings> = {}): CompaniesSettings => ({
  on: false,
  available: true,
  visitCounting: true,
  connection: null,
  platformAdmin: false,
  pageHref: "/admin/kaizenaflow/analytics/companies",
  ...over,
});
const actions = { set: action, saveConnection: action, removeConnection: action };

describe("the switch on Analytics → Settings (D890)", () => {
  it("off: says what it does and does not see, and offers to switch it on", () => {
    const markup = html(h(CompaniesSection, { companies: settings(), actions, words: companiesEn }));
    expect(markup).toContain('id="companies"');
    for (const line of [...companiesEn.settings.what, ...companiesEn.settings.not]) expect(markup).toContain(line);
    expect(markup).toMatch(/<button[^>]*value="on"[^>]*name="enabled"/);
    expect(markup).not.toContain("api_key");
  });

  it("needs visit counting first, and is not offered where it is not available", () => {
    const noVisits = html(h(CompaniesSection, { companies: settings({ visitCounting: false }), actions, words: companiesEn }));
    expect(noVisits).toContain(companiesEn.settings.needsVisits);
    expect(noVisits).not.toContain('value="on"');
    const elsewhere = html(h(CompaniesSection, { companies: settings({ available: false }), actions, words: companiesEn }));
    expect(elsewhere).toContain(companiesEn.settings.notAvailable);
    expect(elsewhere).not.toContain("<button");
  });

  it("on: links to the page and offers to switch it off", () => {
    const markup = html(h(CompaniesSection, { companies: settings({ on: true }), actions, words: companiesEn }));
    expect(markup).toContain('href="/admin/kaizenaflow/analytics/companies"');
    expect(markup).toMatch(/<button[^>]*value="off"[^>]*name="enabled"/);
  });

  it("shows the Leadfeeder connection to a platform admin only, by its key's hint, never the key", () => {
    const admin = html(h(CompaniesSection, { companies: settings({ platformAdmin: true, connection: { keyHint: "…abcd", accountId: "123456" } }), actions, words: companiesEn }));
    expect(admin).toContain('name="api_key"');
    expect(admin).toContain('type="password"');
    expect(admin).toContain("The saved key ends in …abcd");
    expect(admin).toContain('value="123456"');
    expect(admin).toContain(companiesEn.settings.connection.remove);
    const owner = html(h(CompaniesSection, { companies: settings({ connection: { keyHint: "…abcd", accountId: "123456" } }), actions, words: companiesEn }));
    expect(owner).not.toContain("api_key");
    expect(owner).not.toContain("…abcd");
  });
});
