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
const actions = { createStarter: noop, setRole: noop, setTerms: noop, writeWithAi: noop };
const write = (over: Partial<LegalWriteState>): LegalWriteState => ({ id: "w1", role: "returns_policy", status: "written", createdAt: new Date(), page: null, languages: [], problems: [], ...over });
const render = (ai: LegalAiState, words = legalEn) => renderToStaticMarkup(createElement(LegalPagesPanel, { overview, ai, storeSlug: "shop", actions, words }));
const count = (html: string, text: string) => html.split(text).length - 1;

describe("the Legal page's AI part", () => {
  it("says what the AI does and offers to write each kind that has a starter", () => {
    const html = render({ available: true, reason: null, writes: {} });
    expect(html).toContain(legalEn.ai.intro.slice(0, 40));
    expect(count(html, `>${legalEn.ai.write}<`)).toBe(6);
  });

  it("says why it cannot, and offers nothing", () => {
    const html = render({ available: false, reason: "country", writes: {} });
    expect(html).toContain(legalEn.ai.unavailable.country);
    expect(html).not.toContain(`>${legalEn.ai.write}<`);
  });

  it("shows a write that runs, keeps refreshing, and offers no second press for that kind", () => {
    const html = render({ available: true, reason: null, writes: { returns_policy: write({ status: "running" }) } });
    expect(html).toContain(legalEn.ai.writing);
    expect(count(html, `>${legalEn.ai.write}<`)).toBe(5);
  });

  it("links a draft that is ready, with its languages, and says what a language could not do", () => {
    const html = render({
      available: true,
      reason: null,
      writes: { returns_policy: write({ page: { id: "p1", title: "Returpolitikk" }, languages: ["nb", "sv-SE"], problems: ["da: The AI could not be reached."] }) },
    });
    expect(html).toContain('href="/admin/shop/pages/p1"');
    expect(html).toContain("Returpolitikk");
    expect(html).toContain(legalEn.ai.partly);
    expect(html).toContain(`>${legalEn.ai.writeAgain}<`);
  });

  it("says why a write failed, in the account's language", () => {
    const html = render({ available: true, reason: null, writes: { imprint: write({ role: "imprint", status: "failed", problems: ["No official source could be read for this page yet."] }) } }, legalNb);
    expect(html).toContain(legalNb.ai.failed);
    expect(html).toContain(legalNb.ai.title);
  });
});
