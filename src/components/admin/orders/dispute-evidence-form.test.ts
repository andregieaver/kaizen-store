import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { orderNb } from "@/lib/admin-messages/order.nb";
import { EVIDENCE_FIELDS, type Evidence } from "@/lib/dispute-evidence";

import { DisputeEvidenceForm } from "./dispute-evidence-form";

/** The chargeback assistant's form (D417). */

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const fields = Object.fromEntries(EVIDENCE_FIELDS.map((f) => [f, f === "shipping_carrier" ? "Posten" : ""])) as Evidence;
const save = async () => ({ status: "ok" as const, messages: [] });

describe("the evidence form", () => {
  it("puts what a bank looks at first for the reason before everything else, behind one step", () => {
    const html = renderToString(h(DisputeEvidenceForm, { fields, reason: "product_not_received", action: save }));
    const first = html.indexOf("What a bank looks at first");
    const more = html.indexOf("Everything else Stripe takes");
    expect(first).toBeGreaterThan(-1);
    expect(more).toBeGreaterThan(first);
    expect(html.indexOf('name="shipping_tracking_number"')).toBeLessThan(more);
    expect(html.indexOf('name="uncategorized_text"')).toBeGreaterThan(more);
    expect(html).toContain('value="Posten"');
    expect(html).toContain('maxLength="500"');
    for (const f of EVIDENCE_FIELDS) expect(html).toContain(`name="${f}"`);
  });

  it("asks for the tick and offers Send and Save draft; shows the fields read-only with nothing to press without an action", () => {
    const html = renderToString(h(DisputeEvidenceForm, { fields, reason: "fraudulent", action: save }));
    expect(html).toContain('name="confirm"');
    expect(text(html)).toContain("I have read this evidence and it is true.");
    expect(html).toContain('value="send"');
    expect(html).toContain('value="save"');
    const read = renderToString(h(DisputeEvidenceForm, { fields, reason: "fraudulent", action: null }));
    expect(read).not.toContain('name="confirm"');
    expect(read).not.toContain("<form");
    expect(read).toContain("readOnly");
  });

  it("speaks the admin's language", () => {
    const html = text(renderToString(h(DisputeEvidenceForm, { fields, reason: "fraudulent", action: save, words: orderNb.dispute })));
    expect(html).toContain("Det en bank ser på først ved denne grunnen");
    expect(html).toContain("Send til Stripe");
  });
});
