import { describe, expect, it } from "vitest";

import { assessmentFileName, assessmentHtml, type AssessmentFacts } from "./recording-assessment";

/** A store's own assessment for recordings (D656, Q3): its facts filled in, nothing a store typed drawn as HTML, both languages alike. */

const facts = (over: Partial<AssessmentFacts> = {}): AssessmentFacts => ({
  storeName: "Krus & Kopp",
  legalName: "Krus AS",
  organisationNumber: "912 345 678",
  postalAddress: "Storgata 1, 0155 Oslo",
  contactEmail: "post@krus.example",
  share: 25,
  mask: "balanced",
  today: "2026-11-18",
  ...over,
});

describe("a store's own recordings assessment (D656)", () => {
  it("fills in the store, its share and what recordings hide", () => {
    const html = assessmentHtml(facts(), "en");
    expect(html).toContain("Krus AS, organisation number 912 345 678, Storgata 1, 0155 Oslo, post@krus.example");
    expect(html).toContain("25 % of browser tabs");
    expect(html).toContain("the store's own text and catalogue pictures stay visible");
    expect(assessmentHtml(facts({ mask: "strict" }), "en")).toContain("all text on the page, and everything typed");
    expect(html).toContain("<h2>7. Sign-off</h2>");
  });

  it("asks for what is missing instead of leaving it blank", () => {
    expect(assessmentHtml(facts({ legalName: null, organisationNumber: "  " }), "en")).toContain("Controller: [fill in], organisation number [fill in]");
    expect(assessmentHtml(facts({ legalName: null }), "nb")).toContain("Behandlingsansvarlig: [fyll ut]");
  });

  it("escapes everything a store typed", () => {
    const html = assessmentHtml(facts({ storeName: '<script>alert(1)</script>"', legalName: "<img src=x onerror=alert(1)>" }), "en");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(assessmentHtml(facts(), "en")).toContain("Krus &amp; Kopp");
  });

  it("has the same sections in Norwegian, and a file name safe in a header", () => {
    const count = (html: string) => (html.match(/<h2>/g) ?? []).length;
    expect(count(assessmentHtml(facts(), "nb"))).toBe(count(assessmentHtml(facts(), "en")));
    expect(assessmentHtml(facts(), "nb")).toContain('<html lang="nb">');
    expect(assessmentFileName('shop"\r\nx')).toBe("recordings-assessment-shopx.html");
  });

  it("names the store's data protection officer, and puts them in the sign-off", () => {
    const html = assessmentHtml(facts({ officer: { name: "Ola <Ombud>", email: "dpo@krus.example" } }), "en");
    expect(html).toContain("<p>Data protection officer: Ola &lt;Ombud&gt;, dpo@krus.example.</p>");
    expect(html).toContain("<td>Data protection officer, if any</td><td>Ola &lt;Ombud&gt;</td>");
    expect(assessmentHtml(facts({ officer: { name: null, email: "dpo@krus.example" } }), "nb")).toContain("<p>Personvernombud: dpo@krus.example.</p>");
    expect(assessmentHtml(facts(), "en")).not.toContain("Data protection officer:");
  });
});
