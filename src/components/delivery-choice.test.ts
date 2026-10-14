import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The server actions are not called while drawing.
vi.mock("@/app/s/[store]/[market]/checkout/actions", () => ({
  chooseDeliveryAction: async () => ({ problem: null }),
  lookUpDeliveryAction: async () => ({ options: null, problem: null }),
}));

import type { DeliveryOption } from "@/lib/delivery-options";
import type { ShownDeliveryOption, ShownDeliveryOptions } from "@/lib/delivery-words";
import { t } from "@/lib/i18n";

import { DeliveryChoice, type DeliveryChoiceLabels } from "./delivery-choice";

const m = t("en");
const labels: DeliveryChoiceLabels = {
  heading: m.deliveryChoice.heading,
  postalCode: m.deliveryChoice.postalCode,
  lookUp: m.deliveryChoice.lookUp,
  looking: m.deliveryChoice.looking,
  intro: m.deliveryChoice.intro,
  problems: m.deliveryChoice.problems,
  free: m.freeShipping,
  workingDays: m.deliveryChoice.workingDays("{range}"),
  pickupHeading: m.deliveryChoice.pickupHeading,
  choose: m.deliveryChoice.choose,
  choosing: m.deliveryChoice.choosing,
  shipGroup: m.deliveryOptions.shipGroup,
  localGroup: m.deliveryOptions.localGroup,
  collectGroup: m.deliveryOptions.collectGroup,
  noteLabel: m.deliveryOptions.noteLabel,
  noteHint: m.deliveryOptions.noteHint,
  instructions: m.deliveryOptions.instructions,
  localFrom: m.deliveryOptions.localFrom("{minimum}"),
  noShipping: m.deliveryOptions.noShipping("{code}"),
  noShippingAnywhere: m.deliveryOptions.noShippingAnywhere,
  needCode: m.deliveryOptions.priceInfo.needCode,
  changed: m.deliveryOptions.priceInfo.changed,
  noteProblem: m.deliveryOptions.problems.note,
};

const option = (over: Partial<DeliveryOption>): ShownDeliveryOption => ({
  id: "flat",
  kind: "flat",
  carrier: "flat",
  label: "Shipping",
  priceMinor: 9900,
  freeOverMinor: null,
  estimate: null,
  needsPickupPoint: false,
  window: null,
  pickupPoints: [],
  pickupPointId: null,
  selected: false,
  ...over,
});

const draw = (initial: ShownDeliveryOptions, business = false) =>
  renderToString(
    createElement(DeliveryChoice, {
      store: "demo",
      market: "no",
      initial,
      currency: "EUR",
      locale: "en-IE",
      business,
      vatRate: 0.25,
      timeZone: "Europe/Oslo",
      labels,
    }),
  );

describe("DeliveryChoice (D237 2.4)", () => {
  const methods = [
    option({ id: "method:m1", kind: "method", label: "Standard", priceMinor: 4900, selected: true, estimate: { min: 1, max: 3 } }),
    option({ id: "method:m2", kind: "method", label: "Express", priceMinor: 12900 }),
  ];
  const pickup = {
    ...option({
      id: "pickup:p1",
      kind: "pickup",
      label: "Shop Oslo",
      priceMinor: 0,
      place: { name: "Shop Oslo", street: "Gate 1", postalCode: "0150", city: "Oslo", country: "NO", hours: null, readyInHours: 2, instructions: "Back door" },
    }),
    words: { ready: "Usually ready in 2 hours.", today: "Open today 09:00–17:00" },
  };
  const local = option({ id: "local:a1", kind: "local", label: "Oslo centre", priceMinor: 7900, info: "Evenings 16–20" });

  it("groups the methods, local delivery and pickup, each with its price for this basket", () => {
    const html = draw({ postalCode: "0150", options: [...methods, local, pickup] });
    for (const group of ["Delivery", "Local delivery", "Collect"]) expect(html).toContain(`>${group}</h3>`);
    expect(html).toContain('data-delivery-group="ship"');
    expect(html).toContain('data-delivery-group="local"');
    expect(html).toContain('data-delivery-group="collect"');
    expect(html).toContain("Working days: 1–3");
    expect(html).toContain("Evenings 16–20");
    expect(html).toContain("Gate 1, 0150 Oslo");
    expect(html).toContain("Open today 09:00–17:00");
    expect(html).toContain("Usually ready in 2 hours.");
    // A pickup place at no charge says Free.
    expect(html).toContain(m.freeShipping);
    // The prices as shown (the currency the order is in).
    expect(html).toContain("€49.00");
    expect(html).toContain("€129.00");
  });

  it("shows business buyers the price without VAT", () => {
    expect(draw({ postalCode: "0150", options: methods }, true)).toContain("€39.20");
  });

  it("keeps the old look (no group headings) for the flat rate and carriers alone", () => {
    const html = draw({ postalCode: null, options: [option({ selected: true })] });
    expect(html).not.toContain("</h3>");
    expect(html).toContain(labels.intro);
  });

  it("says the price waits for a postal code, the choice changed, or nothing delivers the basket to the code", () => {
    expect(draw({ postalCode: null, options: [...methods, pickup], needsPostalCode: true })).toContain(labels.needCode);
    expect(draw({ postalCode: "0150", options: methods, changed: true })).toContain(labels.changed);
    expect(draw({ postalCode: "9990", options: [pickup], noShipping: true })).toContain(
      "We cannot deliver this basket to 9990. Collect it, or contact the store.",
    );
  });

  it("shows an area the basket is below the minimum of, greyed and never as a choice", () => {
    const html = draw({ postalCode: "0150", options: methods, localBelowMinimum: { label: "Oslo centre", minimumMinor: 50000 } });
    expect(html).toContain("Local delivery from €500.00");
    expect(html).toContain("data-local-below-minimum");
    expect(html).not.toContain('data-delivery-option="local"');
  });

  it("asks for the note for the driver when local delivery is the choice, with the note kept", () => {
    const html = draw({ postalCode: "0150", options: [methods[0], { ...local, selected: true }].map((o) => ({ ...o, selected: o.id === local.id })), note: "Door code 12" });
    expect(html).toContain('id="delivery-note"');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain("Door code 12");
    expect(html).toContain(labels.noteLabel);
  });
});
