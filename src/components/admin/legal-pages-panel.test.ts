import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/" }));

import { legalEn } from "@/lib/admin-messages/legal.en";
import { legalNb } from "@/lib/admin-messages/legal.nb";
import { LEGAL_ROLES, LEGAL_ROLE_COPY } from "@/lib/legal-roles";
import type { LegalOverview } from "@/server/legal-starters";
import type { LegalWriteState } from "@/server/legal-writer";

import { LegalPagesPanel, type LegalAiState } from "./legal-pages-panel";

/** The Legal page's AI part (D311, unit L2): what the AI does or why it cannot, a button per kind, and where each write stands. */

const overview: LegalOverview = {
  roles: LEGAL_ROLES.map((role) => ({ role, name: LEGAL_ROLE_COPY[role].name, hint: LEGAL_ROLE_COPY[role].hint, starter: role !== "accessibility", page: null, draft: null, needed: true })),
  choosable: [],
  termsAtCheckout: "link",
  shopOn: true,
  missing: [],
};
const noop = async () => ({ status: "ok" as const, messages: [] });
const actions = { createStarter: noop, setRole: noop, setTerms: noop, writeWithAi: noop, turnOn: noop, turnOff: noop, setPublish: noop, stop: noop, handBack: noop };
const OFF: LegalAiState["settings"] = { enabled: false, publish: "auto", turnedOnAt: null, stoppedRoles: [] };
const ON: LegalAiState["settings"] = { enabled: true, publish: "auto", turnedOnAt: "2026-10-25T12:00:00Z", stoppedRoles: [] };
const write = (over: Partial<LegalWriteState>): LegalWriteState => ({ id: "w1", role: "returns_policy", why: "asked", status: "written", createdAt: new Date(), finishedAt: null, page: null, languages: [], problems: [], ...over });
/** The markup with its escaped quotes read back, so the catalogue's words compare as written. */
const render = (ai: LegalAiState, words = legalEn) =>
  renderToStaticMarkup(createElement(LegalPagesPanel, { overview, ai, storeSlug: "shop", actions, words })).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const count = (html: string, text: string) => html.split(text).length - 1;

describe("the Legal page's AI part", () => {
  it("says what the AI does and offers to write each kind that has a starter", () => {
    const html = render({ available: true, reason: null, writes: {}, settings: OFF });
    expect(html).toContain(legalEn.ai.intro.slice(0, 40));
    expect(count(html, `>${legalEn.ai.write}<`)).toBe(6);
  });

  it("says why it cannot, and offers nothing", () => {
    const html = render({ available: false, reason: "country", writes: {}, settings: OFF });
    expect(html).toContain(legalEn.ai.unavailable.country);
    expect(html).not.toContain(`>${legalEn.ai.write}<`);
  });

  it("shows a write that runs, keeps refreshing, and offers no second press for that kind", () => {
    const html = render({ available: true, reason: null, writes: { returns_policy: write({ status: "running" }) }, settings: OFF });
    expect(html).toContain(legalEn.ai.writing);
    expect(count(html, `>${legalEn.ai.write}<`)).toBe(5);
  });

  it("links a draft that is ready, with its languages, and says what a language could not do", () => {
    const html = render({
      available: true,
      reason: null,
      writes: { returns_policy: write({ page: { id: "p1", title: "Returpolitikk" }, languages: ["nb", "sv-SE"], problems: ["da: The AI could not be reached."] }) },
      settings: OFF,
    });
    expect(html).toContain('href="/admin/shop/pages/p1"');
    expect(html).toContain("Returpolitikk");
    expect(html).toContain(legalEn.ai.partly);
    expect(html).toContain(`>${legalEn.ai.writeAgain}<`);
  });

  it("says why a write failed, in the account's language", () => {
    const html = render({ available: true, reason: null, writes: { imprint: write({ role: "imprint", status: "failed", problems: ["No official source could be read for this page yet."] }) }, settings: OFF }, legalNb);
    expect(html).toContain(legalNb.ai.failed);
    expect(html).toContain(legalNb.ai.title);
  });

  it("offers to turn it on with the sentence the owner agrees to, publishing at once chosen", () => {
    const html = render({ available: true, reason: null, writes: {}, settings: OFF });
    expect(html).toContain(legalEn.ai.on.sentence);
    expect(html).toContain(`>${legalEn.ai.on.turnOn}<`);
    expect(html).toContain('name="publish" checked="" value="auto"');
    // The starters' review notice is shown while the AI does not keep the pages.
    expect(html).toContain(legalEn.pages.reviewLead);
  });

  it("once on, says since when and how pages are published, and offers to turn it off and to stop each page", () => {
    const html = render({ available: true, reason: null, writes: {}, settings: ON });
    expect(html).toContain("On since 25 October 2026.");
    expect(html).toContain(legalEn.ai.on.autoLine);
    expect(html).toContain(`>${legalEn.ai.on.turnOff}<`);
    expect(count(html, `>${legalEn.ai.stop}<`)).toBe(6);
    expect(html).not.toContain(legalEn.pages.reviewLead);
  });

  it("offers a stopped page back, and a page kept beside a person's", () => {
    const stopped = render({ available: true, reason: null, writes: {}, settings: { ...ON, stoppedRoles: ["terms"] } });
    expect(stopped).toContain(legalEn.ai.stoppedLine);
    expect(count(stopped, `>${legalEn.ai.handBack}<`)).toBe(1);
    const kept = render({ available: true, reason: null, writes: { privacy: write({ role: "privacy", status: "kept", why: "facts_changed", page: { id: "p2", title: "Personvern" } }) }, settings: ON });
    expect(kept).toContain(legalEn.ai.kept);
    expect(kept).toContain(legalEn.ai.because.facts_changed);
    expect(count(kept, `>${legalEn.ai.handBack}<`)).toBe(1);
  });

  it("says a page was published by the AI, and why it was written", () => {
    const html = render({ available: true, reason: null, writes: { imprint: write({ role: "imprint", status: "published", why: "source_changed", page: { id: "p3", title: "Imprint" } }) }, settings: ON });
    expect(html).toContain(legalEn.ai.published);
    expect(html).toContain(legalEn.ai.because.source_changed);
  });
});

