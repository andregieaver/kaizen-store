import { describe, expect, it } from "vitest";

import { confirmationDeliveryBlocks, openingHoursLines, outForDeliveryBlocks, pickupReadyBlocks } from "./delivery-email";
import type { LocalDelivery, PickupDelivery } from "./delivery-options";
import { deliveryEmailText } from "./email-text";

const week = {
  mon: { open: "09:00", close: "17:00" },
  tue: { open: "09:00", close: "17:00" },
  wed: { open: "09:00", close: "17:00" },
  thu: { open: "09:00", close: "17:00" },
  fri: { open: "09:00", close: "17:00" },
  sat: { open: "10:00", close: "14:00" },
  sun: null,
};
const pickup: PickupDelivery = {
  kind: "pickup",
  label: "Butikken",
  locationId: "00000000-0000-4000-8000-000000000001",
  name: "Butikken",
  street: "Storgata 1",
  postalCode: "0155",
  city: "Oslo",
  country: "NO",
  hours: { week, exceptions: [{ kind: "date", label: "Helligdag", date: "2026-10-16", hours: null }] },
  instructions: "Ring på bakdøren.",
  readyInHours: 4,
};
const local: LocalDelivery = { kind: "local", label: "Oslo", areaId: "00000000-0000-4000-8000-000000000002", name: "Oslo", postalCode: "0150", info: "Kveldslevering." };
// Wednesday 14 October 2026, at noon in Oslo.
const now = new Date("2026-10-14T10:00:00Z");

describe("the pickup email's words (D237 2.5)", () => {
  it("lists the next seven days' hours in the store's time zone, with a date's exception", () => {
    const lines = openingHoursLines(pickup.hours, { locale: "en-GB", timeZone: "Europe/Oslo", now, closed: "closed" });
    expect(lines).toHaveLength(7);
    expect(lines[0]).toEqual({ label: "Wednesday 14 October", value: "09:00–17:00" });
    expect(lines[2]).toEqual({ label: "Friday 16 October", value: "closed" });
    expect(lines[3]).toEqual({ label: "Saturday 17 October", value: "10:00–14:00" });
    expect(lines[4].value).toBe("closed");
    expect(openingHoursLines(null, { locale: "en-GB", timeZone: "Europe/Oslo", now, closed: "closed" })).toEqual([]);
    expect(openingHoursLines({ nonsense: true }, { locale: "en-GB", timeZone: "Europe/Oslo", now, closed: "closed" })).toEqual([]);
  });

  it("names the place, the hours, the instructions as kept, what to collect without prices, and what to bring", () => {
    const blocks = pickupReadyBlocks(deliveryEmailText("en"), pickup, { number: "1042", lines: [{ title: "Mug", quantity: 2 }], locale: "en-GB", timeZone: "Europe/Oslo", now });
    const text = JSON.stringify(blocks);
    expect(blocks[0]).toEqual({ type: "paragraph", text: "Collect at:\nButikken, Storgata 1, 0155 Oslo" });
    expect(text).toContain("How to collect:\\nRing på bakdøren.");
    expect(text).toContain("2 × Mug");
    expect(text).toContain("Bring your order number, 1042");
    // Without instructions, hours or lines, only what there is.
    const bare = pickupReadyBlocks(deliveryEmailText("nb"), { ...pickup, instructions: " ", hours: null }, { number: "7", lines: [], locale: "nb-NO", timeZone: "Europe/Oslo", now });
    expect(bare.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(JSON.stringify(bare)).toContain("Hentested");
  });

  it("says where the local delivery goes by postal code and city only, with the area's information", () => {
    expect(outForDeliveryBlocks(deliveryEmailText("sv"), local, { postalCode: "0150", city: "Oslo" })).toEqual([
      { type: "paragraph", text: "Om leveransen:\nKveldslevering." },
      { type: "paragraph", text: "Levereras till: 0150 Oslo" },
    ]);
  });

  it("adds the confirmation's block for a method with a transit time, pickup and local delivery, and nothing for the rest", () => {
    const da = deliveryEmailText("da");
    expect(confirmationDeliveryBlocks(da, { kind: "method", methodId: "m", label: "Express", zone: null, postalCode: null, estimate: { min: 1, max: 2 } }, null)).toEqual([
      { type: "paragraph", text: "Levering: Express\nLeveringstid: 1–2 dage" },
    ]);
    expect(confirmationDeliveryBlocks(da, { kind: "method", methodId: "m", label: "Express", zone: null, postalCode: null, estimate: null }, null)).toEqual([]);
    expect(JSON.stringify(confirmationDeliveryBlocks(da, pickup, null))).toContain("Normalt klar inden for 4 timer.");
    expect(JSON.stringify(confirmationDeliveryBlocks(da, { ...pickup, readyInHours: 0 }, null))).not.toContain("Normalt");
    expect(confirmationDeliveryBlocks(deliveryEmailText("en"), local, "By the back door")).toEqual([
      { type: "paragraph", text: "Delivery: Oslo\nKveldslevering.\nNote for the driver: By the back door" },
    ]);
    expect(confirmationDeliveryBlocks(da, { kind: "flat", label: "Frakt", postalCode: null }, null)).toEqual([]);
    expect(confirmationDeliveryBlocks(da, null, null)).toEqual([]);
  });

  it("is hand-written in four languages and English for every other", () => {
    for (const lang of ["nb", "sv", "da", "en"]) {
      const words = deliveryEmailText(lang);
      expect(words.readySubject("Shop", "1")).toContain("1");
      expect(words.readyIn(1)).toMatch(/1/);
      expect(words.readyIn(72)).toMatch(/3/);
    }
    expect(deliveryEmailText("fi")).toBe(deliveryEmailText("en"));
    expect(deliveryEmailText("nb").transit(2, 2)).toBe("Leveringstid: 2 dager");
  });
});
