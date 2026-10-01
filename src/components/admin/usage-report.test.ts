import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { costWords, type UsageRow } from "@/lib/ai-usage";

import { UsageReport } from "./usage-report";

const row = (over: Partial<UsageRow>): UsageRow => ({
  ownerId: null,
  ownerEmail: null,
  ownerName: null,
  storeId: null,
  storeSlug: null,
  storeName: null,
  source: "platform",
  provider: "acme",
  model: "model-a",
  kind: "text",
  feature: "search",
  requests: 4,
  failed: 0,
  inputTokens: 2_000_000,
  outputTokens: 1_000_000,
  characters: 0,
  audioSeconds: 0,
  images: 0,
  estimatedRequests: 0,
  costMicros: 3_500_000,
  unpricedRequests: 0,
  ...over,
});
const days = [{ day: "2026-10-01", requests: 4, tokens: 3_000_000, costMicros: 3_500_000 }];
const render = (rows: UsageRow[], scope: "platform" | "owner" = "platform") => renderToStaticMarkup(createElement(UsageReport, { rows, days, scope }));

describe("cost in the usage report (D145)", () => {
  it("shows the cost beside the tokens: in the totals, each provider and model, each group and the daily chart", () => {
    const out = render([row({}), row({ model: "model-b", costMicros: 500_000, source: "store", storeId: "s", storeName: "Shop" })]);
    expect(out).toContain("Estimated cost");
    expect(out).toContain("$4.00");
    expect(out).toContain(">Cost<");
    expect(out).toContain("$3.50");
    expect(out).toContain("$0.50");
    // Beside each group's tokens, and in the chart's bar and caption.
    expect(out).toContain("3,000,000 tokens · $3.50");
    expect(out).toContain("2026-10-01: 3,000,000 tokens, $3.50, 4 requests");
    expect(out).toContain("$3.50 in all");
    expect(out).toContain("$3.50 on Kaizen&#x27;s key, $0.50 on stores&#x27; own");
  });

  it("says where a model has no price, marks a total that is more than shown, and sends the platform to set one", () => {
    const out = render([row({}), row({ model: "model-c", costMicros: 0, unpricedRequests: 2 })]);
    expect(out).toContain("No price");
    expect(out).toContain("2 requests have no price yet");
    expect(out).toContain("$3.50+");
    expect(out).toContain("/admin/platform/ai/prices");
    // An owner has no prices page to go to.
    expect(render([row({ costMicros: 0, unpricedRequests: 1 })], "owner")).not.toContain("/admin/platform/ai/prices");
  });

  it("writes a cost with a plus only where some usage has no price", () => {
    expect(costWords({ costMicros: 12_300, unpricedRequests: 0 })).toBe("$0.0123");
    expect(costWords({ costMicros: 12_300, unpricedRequests: 3 })).toBe("$0.0123+");
  });
});
