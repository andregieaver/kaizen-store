import { describe, expect, it } from "vitest";

import { cleanContact, contactAsked, CONTACT_OFF, isContactMode } from "./checkout-contact";

describe("what one order's checkout asks (contactAsked, D357)", () => {
  it("follows the store's choice, asks nothing by default", () => {
    expect(contactAsked(CONTACT_OFF, { ships: false, deliveryMethod: "ship" })).toEqual({ phone: "off", name: "off" });
    expect(contactAsked({ phone: "optional", name: "required" }, { ships: false, deliveryMethod: "ship" })).toEqual({ phone: "optional", name: "required" });
  });

  it("always asks the phone, required, for a local delivery: the driver calls (D237)", () => {
    expect(contactAsked(CONTACT_OFF, { ships: true, deliveryMethod: "local" }).phone).toBe("required");
    expect(contactAsked({ phone: "optional", name: "off" }, { ships: true, deliveryMethod: "local" }).phone).toBe("required");
  });

  it("asks the name only when nothing is sent to an address: the delivery address holds one", () => {
    const required = { phone: "off", name: "required" } as const;
    expect(contactAsked(required, { ships: true, deliveryMethod: "ship" }).name).toBe("off");
    expect(contactAsked(required, { ships: true, deliveryMethod: "local" }).name).toBe("off");
    expect(contactAsked(required, { ships: true, deliveryMethod: "pickup" }).name).toBe("required");
    expect(contactAsked(required, { ships: false, deliveryMethod: "ship" }).name).toBe("required");
  });
});

describe("what was typed, checked against what was asked (cleanContact)", () => {
  it("keeps a name tidied and a phone in E.164, read in the market's country", () => {
    expect(cleanContact({ name: "  Kari   Nordmann ", phone: "912 34 567" }, { phone: "optional", name: "optional" }, "NO")).toEqual({
      ok: true,
      name: "Kari Nordmann",
      phone: "+4791234567",
    });
  });

  it("refuses a required field left empty, and a phone that is not one even when optional", () => {
    expect(cleanContact({ name: " ", phone: "" }, { phone: "off", name: "required" }, "NO")).toEqual({ ok: false, problem: "name" });
    expect(cleanContact({ name: "Kari", phone: "" }, { phone: "required", name: "optional" }, "NO")).toEqual({ ok: false, problem: "phone" });
    expect(cleanContact({ phone: "call me" }, { phone: "optional", name: "off" }, "NO")).toEqual({ ok: false, problem: "phone" });
  });

  it("lets an optional field be empty, and drops a field that was not asked", () => {
    expect(cleanContact({}, { phone: "optional", name: "optional" }, "SE")).toEqual({ ok: true, name: null, phone: null });
    expect(cleanContact({ name: "Kari", phone: "912 34 567" }, CONTACT_OFF, "NO")).toEqual({ ok: true, name: null, phone: null });
  });

  it("knows its modes", () => {
    expect(["off", "optional", "required"].every(isContactMode)).toBe(true);
    expect(isContactMode("always")).toBe(false);
  });
});
