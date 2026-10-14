import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AnyOrderDelivery } from "@/lib/delivery-options";
import { t } from "@/lib/i18n";
import { defaultHours } from "@/lib/opening-hours";

import { DeliveryBlock } from "./delivery-block";

const pickup: AnyOrderDelivery = {
  kind: "pickup",
  label: "Butikken på Grünerløkka",
  locationId: "l1",
  name: "Butikken på Grünerløkka",
  street: "Thorvald Meyers gate 1",
  postalCode: "0555",
  city: "Oslo",
  country: "NO",
  hours: defaultHours(),
  instructions: "Ring på <b>bakdøra</b>.",
  readyInHours: 3,
};

const order = (over: Partial<Parameters<typeof DeliveryBlock>[0]["order"]> = {}) => ({
  deliveryKept: pickup,
  readyForPickupAt: null,
  deliveredAt: null,
  deliveryNote: null,
  status: "paid",
  ...over,
});

const draw = (o: ReturnType<typeof order>, lang = "en") =>
  renderToString(createElement(DeliveryBlock, { order: o, m: t(lang), locale: lang, timeZone: "Europe/Oslo", now: new Date("2026-10-14T10:00:00Z") }));

describe("DeliveryBlock (D237 2.4)", () => {
  it("a paid pickup order: the place, the snapshot address, seven days of hours, the instructions as text, the ready time and what to bring", () => {
    const html = draw(order());
    expect(html).toContain("Collect at Butikken på Grünerløkka");
    expect(html).toContain("Thorvald Meyers gate 1, 0555 Oslo");
    expect(html).toContain("Usually ready in 3 hours.");
    expect(html).toContain("Opening hours");
    expect((html.match(/<dt>/g) ?? []).length).toBe(7);
    // The owner's instructions are text, never markup.
    expect(html).toContain("Ring på &lt;b&gt;bakdøra&lt;/b&gt;.");
    expect(html).toContain("Bring your order number.");
  });

  it("says when it was marked ready, and when it was collected (then no hours or instructions)", () => {
    expect(draw(order({ readyForPickupAt: "2026-10-13T10:00:00Z" }))).toMatch(/Ready for pickup since October 13, 2026/);
    const collected = draw(order({ status: "fulfilled", readyForPickupAt: "2026-10-13T10:00:00Z", deliveredAt: "2026-10-14T10:00:00Z" }), "nb");
    expect(collected).toContain("Hentet 14. oktober 2026");
    expect(collected).not.toContain("Åpningstider");
    expect(collected).not.toContain("bakdøra");
  });

  it("promises no ready time before the order is paid", () => {
    expect(draw(order({ status: "pending_payment" }))).not.toContain("Usually ready");
  });

  it("a local delivery: the area, its information and the buyer's note for the driver", () => {
    const html = draw(
      order({
        deliveryKept: { kind: "local", label: "Oslo sentrum", areaId: "a1", name: "Oslo sentrum", postalCode: "0150", info: "We deliver 16–20." },
        deliveryNote: "Code 1234",
      }),
      "sv",
    );
    expect(html).toContain("Lokal leverans: Oslo sentrum");
    expect(html).toContain("We deliver 16–20.");
    expect(html).toContain("Ditt meddelande till föraren");
    expect(html).toContain("Code 1234");
  });

  it("a method's transit time; nothing for a carrier's service, the flat rate or no delivery", () => {
    expect(draw(order({ deliveryKept: { kind: "method", methodId: "m1", label: "Express", zone: null, postalCode: null, estimate: { min: 1, max: 2 } } }))).toContain(
      "Working days: 1–2",
    );
    expect(draw(order({ deliveryKept: { kind: "flat", label: "Shipping", postalCode: null } }))).toBe("");
    expect(draw(order({ deliveryKept: null }))).toBe("");
  });
});
