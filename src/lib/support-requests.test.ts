import { describe, expect, it } from "vitest";

import { readActionArgs, requestAddress } from "./support-actions";
import { SUPPORT_TOOLS } from "./support-tools";

describe("an address change asked for in support (B3, D640)", () => {
  const address = { name: "Ana Berg", line1: "Nygata 5", postalCode: "0150", city: "Oslo" };

  it("keeps the new address as fields with the request, and nothing but an address change takes one", () => {
    expect(readActionArgs("change_address", { orderNumber: "1042", address })).toEqual({ orderNumber: "1042", address });
    expect(readActionArgs("change_address", { orderNumber: "1042" })).toEqual({ orderNumber: "1042" });
    // Another kind's schema has no address: it is dropped, never kept.
    expect(readActionArgs("cancel_order", { orderNumber: "1042", address })).toEqual({ orderNumber: "1042" });
  });

  it("needs a name, a street, a postal code and a city", () => {
    expect(requestAddress.safeParse(address).success).toBe(true);
    expect(requestAddress.safeParse({ ...address, city: "" }).success).toBe(false);
    expect(requestAddress.safeParse({ name: "Ana" }).success).toBe(false);
  });

  it("is offered to the chat on request_staff_action, said to be carried out only for a signed-in customer's unsent order", () => {
    const tool = SUPPORT_TOOLS.find((t) => t.name === "request_staff_action")!;
    expect(tool.description).toContain("signed-in customer's order that has not been sent");
  });
});
