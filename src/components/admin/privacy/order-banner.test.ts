import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrderPrivacyBanner } from "./order-banner";
import { plain } from "./test-fixtures";

const draw = (privacy: Parameters<typeof OrderPrivacyBanner>[0]["privacy"]) => plain(renderToString(h(OrderPrivacyBanner, { privacy })));

describe("the privacy banner on an order", () => {
  it("says when the data was restricted and until when it is kept", () => {
    expect(draw({ restrictedOn: "2026-10-04", keptUntil: "2032-01-01", anonymisedOn: null })).toBe(
      "Personal data restricted since 4 Oct 2026. Kept until 1 Jan 2032 because of the bookkeeping rules. Use it only for the accounts.",
    );
  });

  it("says when the data was made anonymous, and that the sale is kept", () => {
    const text = draw({ restrictedOn: "2026-10-04", keptUntil: null, anonymisedOn: "2032-01-02" });
    expect(text).toBe("Personal data removed on 2 Jan 2032. The sale, amounts and VAT are kept.");
  });

  it("shows nothing for an order nothing has happened to", () => {
    expect(draw(null)).toBe("");
    expect(draw({ restrictedOn: null, keptUntil: null, anonymisedOn: null })).toBe("");
  });
});
