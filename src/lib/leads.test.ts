import { describe, expect, it } from "vitest";

import { leadDealTitle, leadsFrom, type LeadSourceRow } from "./leads";

const row = (over: Partial<LeadSourceRow>): LeadSourceRow => ({
  kind: "question",
  id: "a",
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
      row({ id: "q1", kind: "quote", at: "2026-11-01T09:00:00.000Z", excerpt: " 40 totes " }),
      row({ id: "c1", kind: "chat", at: "2026-11-04T09:00:00.000Z", name: "Kari Nordmann", email: "KARI@example.com " }),
      row({ id: "s1", kind: "subscriber", at: "2026-11-03T09:00:00.000Z", email: "ola@example.com" }),
    ]);
    expect(leads).toEqual([
      {
        email: "kari@example.com",
        name: "Kari Nordmann",
        latest: "2026-11-04T09:00:00.000Z",
        items: [
          { kind: "chat", id: "c1", at: "2026-11-04T09:00:00.000Z", excerpt: null },
          { kind: "quote", id: "q1", at: "2026-11-01T09:00:00.000Z", excerpt: "40 totes" },
        ],
      },
      { email: "ola@example.com", name: null, latest: "2026-11-03T09:00:00.000Z", items: [{ kind: "subscriber", id: "s1", at: "2026-11-03T09:00:00.000Z", excerpt: null }] },
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
