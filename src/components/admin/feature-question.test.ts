import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { FormState } from "./action-form";
import { FeatureQuestion, type QuestionWarning } from "./feature-question";

const action = async (state: FormState) => state;
const draw = (sells: string[], extras: string[], warnings: QuestionWarning[] = [], note: string | null = null) =>
  renderToString(createElement(FeatureQuestion, { action, answers: { sells, extras } as never, warnings, note }));

/** Whether the checkbox sending `name=value` is ticked. */
const ticked = (html: string, name: string, value: string) => {
  const input = (html.match(/<input[^>]*>/g) ?? []).find((tag) => tag.includes(`name="${name}"`) && tag.includes(`value="${value}"`));
  if (!input) throw new Error(`no ${name}=${value}`);
  return input.includes('checked=""');
};

describe("the setup wizard's question (D178 step 6)", () => {
  it("offers every kind of thing sold, a website and the extras, pre-filled from the features", () => {
    const html = draw(["appointments"], ["countries"]);
    for (const label of ["Products to ship", "Downloads", "Appointments", "Stays or rentals", "Subscriptions", "Subscription boxes", "Just a website, no online shop", "Sell in several countries", "Several languages", "Sell to businesses"]) {
      expect(html).toContain(label);
    }
    expect(ticked(html, "sells", "appointments")).toBe(true);
    expect(ticked(html, "sells", "goods")).toBe(false);
    expect(ticked(html, "extras", "countries")).toBe(true);
    expect(ticked(html, "extras", "business")).toBe(false);
    expect(html).toContain("Settings, Features");
  });

  it("asks for a tick only when leaving something out has something to warn of, and says what", () => {
    expect(draw(["goods"], [])).not.toContain('name="confirm"');
    const html = draw(["appointments"], [], [{ label: "Appointments", lines: ["2 appointment products can no longer be booked."] }], "Your store was made from the store template Spa.");
    expect(html).toContain('name="confirm"');
    expect(html).toContain("2 appointment products can no longer be booked.");
    expect(html).toContain("Your store was made from the store template Spa.");
  });
});
