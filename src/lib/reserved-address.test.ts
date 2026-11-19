import { describe, expect, it } from "vitest";
import { isReservedAddress } from "./reserved-address";

describe("isReservedAddress (D792)", () => {
  it("knows example.org and example.net and everything under them", () => {
    expect(isReservedAddress("ingrid.berg@example.org")).toBe(true);
    expect(isReservedAddress("a@EXAMPLE.org")).toBe(true);
    expect(isReservedAddress("a@mail.example.net")).toBe(true);
    expect(isReservedAddress("a@example.org.")).toBe(true);
  });

  it("leaves the domains the tests deliver to through a stubbed Resend alone", () => {
    expect(isReservedAddress("owner@example.com")).toBe(false);
    expect(isReservedAddress("shop@demo.test")).toBe(false);
    expect(isReservedAddress("a@fjord.example")).toBe(false);
    expect(isReservedAddress("a@kaizenaflow.invalid")).toBe(false);
  });

  it("leaves real domains alone, look-alikes included", () => {
    expect(isReservedAddress("customer@email.com")).toBe(false);
    expect(isReservedAddress("a@myexample.org")).toBe(false);
    expect(isReservedAddress("a@example.org.au")).toBe(false);
  });

  it("is false for what is not an address", () => {
    expect(isReservedAddress("")).toBe(false);
    expect(isReservedAddress("[removed]")).toBe(false);
    expect(isReservedAddress("@example.org")).toBe(false);
    expect(isReservedAddress("a@")).toBe(false);
  });
});
