import { describe, expect, it } from "vitest";

import { ADMIN_PAGES, matchPath } from "./admin-map";
import { LEAD_SOURCE_PAGES, LEAD_SOURCES, leadDealTitle, leadKindLinks, leadSourcePath, leadsFrom, type LeadSourceRow } from "./leads";

const row = (over: Partial<LeadSourceRow>): LeadSourceRow => ({
  kind: "question",
  id: "a",
  source: "form",
  sourceId: "f",
  at: "2026-11-05T10:00:00.000Z",
  excerpt: null,
  email: "kari@example.com",
  name: null,
  customer: false,
  inDeal: false,
  decidedAt: null,
  ...over,
});

describe("the leads inbox", () => {
  it("is one row a person, the newest first, each with their requests newest first", () => {
    const leads = leadsFrom([
      row({ id: "q1", kind: "quote", source: "draft", sourceId: "q1", at: "2026-11-01T09:00:00.000Z", excerpt: " 40 totes " }),
      row({ id: "c1", kind: "chat", source: "conversation", sourceId: "c1", at: "2026-11-04T09:00:00.000Z", name: "Kari Nordmann", email: "KARI@example.com " }),
      row({ id: "s1", kind: "subscriber", source: "subscriber", sourceId: "s1", at: "2026-11-03T09:00:00.000Z", email: "ola@example.com" }),
    ]);
    expect(leads).toEqual([
      {
        email: "kari@example.com",
        name: "Kari Nordmann",
        latest: "2026-11-04T09:00:00.000Z",
        items: [
          { kind: "chat", id: "c1", source: "conversation", sourceId: "c1", at: "2026-11-04T09:00:00.000Z", excerpt: null },
          { kind: "quote", id: "q1", source: "draft", sourceId: "q1", at: "2026-11-01T09:00:00.000Z", excerpt: "40 totes" },
        ],
      },
      {
        email: "ola@example.com",
        name: null,
        latest: "2026-11-03T09:00:00.000Z",
        items: [{ kind: "subscriber", id: "s1", source: "subscriber", sourceId: "s1", at: "2026-11-03T09:00:00.000Z", excerpt: null }],
      },
    ]);
  });

  it("leaves out customers, people in an open deal, and what was asked before the last decision", () => {
    expect(leadsFrom([row({ customer: true }), row({ email: "ola@example.com", inDeal: true })])).toEqual([]);
    const decided = "2026-11-05T12:00:00.000Z";
    expect(leadsFrom([row({ decidedAt: decided })])).toEqual([]);
    // Asked again after being dismissed: back in the inbox, with only the new request.
    const again = leadsFrom([row({ decidedAt: decided }), row({ id: "b", at: "2026-11-06T08:00:00.000Z", decidedAt: decided })]);
    expect(again.map((l) => l.items.map((i) => i.id))).toEqual([["b"]]);
  });

  it("names the deal a lead becomes after the person and what they asked for last", () => {
    const [lead] = leadsFrom([row({ kind: "quote", name: "Kari Nordmann" })]);
    const kinds = { quote: "quote request", question: "question", chat: "chat", subscriber: "new subscriber" };
    expect(leadDealTitle(lead, kinds)).toBe("Kari Nordmann: quote request");
    expect(leadDealTitle({ ...lead, name: null }, kinds)).toBe("kari@example.com: quote request");
  });
});

describe("a lead's links to where its requests are (ecosystem plan E2.8, D713)", () => {
  const ID = "0b9d2c1e-5a4f-4c3b-9e8d-7f6a5b4c3d2e";

  it("opens a quote request's draft, a form's responses, a conversation in the inbox and a subscriber", () => {
    expect(leadSourcePath({ source: "draft", sourceId: ID })).toBe(`/orders/drafts/${ID}`);
    expect(leadSourcePath({ source: "form", sourceId: ID })).toBe(`/forms/responses/${ID}`);
    expect(leadSourcePath({ source: "conversation", sourceId: ID })).toBe(`/support?c=${ID}`);
    expect(leadSourcePath({ source: "subscriber", sourceId: ID })).toBe(`/subscribers/${ID}`);
    // An id is never more than a path's part.
    expect(leadSourcePath({ source: "draft", sourceId: "../x?y" })).toBe("/orders/drafts/..%2Fx%3Fy");
  });

  it("goes only to pages the admin map knows, each the page its source names", () => {
    for (const source of LEAD_SOURCES) {
      const page = LEAD_SOURCE_PAGES[source];
      expect(ADMIN_PAGES.some((p) => p.area === "store" && p.path === page), page).toBe(true);
      const path = leadSourcePath({ source, sourceId: ID }).split("?")[0];
      expect(matchPath(`/admin/kaffe${path}`)?.page.path, source).toBe(page);
    }
  });

  it("is one link a kind, to its newest request, and none where the viewer may not open the page", () => {
    const [lead] = leadsFrom([
      row({ id: "c2", kind: "chat", source: "conversation", sourceId: "c2", at: "2026-11-06T09:00:00.000Z" }),
      row({ id: "c1", kind: "chat", source: "conversation", sourceId: "c1", at: "2026-11-04T09:00:00.000Z" }),
      row({ id: "r1", kind: "question", source: "form", sourceId: "f1", at: "2026-11-05T09:00:00.000Z" }),
      // A form's message the inbox took is a question too, in its conversation: the newest question is the link.
      row({ id: "c3", kind: "question", source: "conversation", sourceId: "c3", at: "2026-11-05T12:00:00.000Z" }),
      row({ id: "s1", kind: "subscriber", source: "subscriber", sourceId: "s1", at: "2026-11-01T09:00:00.000Z" }),
    ]);
    expect(leadKindLinks(lead, "/admin/kaffe", { conversation: true, form: true, subscriber: true })).toEqual([
      { kind: "chat", href: "/admin/kaffe/support?c=c2" },
      { kind: "question", href: "/admin/kaffe/support?c=c3" },
      { kind: "subscriber", href: "/admin/kaffe/subscribers/s1" },
    ]);
    // A member who may read customers but not support or marketing: the kinds, each linked to the newest they can open, or not linked.
    expect(leadKindLinks(lead, "/admin/kaffe", { form: true })).toEqual([
      { kind: "chat", href: null },
      { kind: "question", href: "/admin/kaffe/forms/responses/f1" },
      { kind: "subscriber", href: null },
    ]);
  });
});
