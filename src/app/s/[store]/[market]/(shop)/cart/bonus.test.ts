import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CartBonus } from "@/lib/bonus";

// The server pieces are replaced: what is tested is what the form asks of them and what the shopper is told.
vi.mock("server-only", () => ({}));
const cartBonus = vi.fn();
const setCartCredits = vi.fn();
vi.mock("@/server/bonus", () => ({
  cartBonus: (...a: unknown[]) => cartBonus(...a),
  setCartCredits: (...a: unknown[]) => setCartCredits(...a),
}));
const readCartId = vi.fn();
vi.mock("@/server/cart", () => ({ readCartId: (...a: unknown[]) => readCartId(...a) }));
const getCustomer = vi.fn();
vi.mock("@/server/customers", () => ({ getCustomer: (...a: unknown[]) => getCustomer(...a) }));
const resolveShop = vi.fn();
vi.mock("@/server/shop", () => ({ resolveShop: (...a: unknown[]) => resolveShop(...a) }));

import { applyCreditsForm, readCartBonus } from "./bonus";

const market = { slug: "ie", code: "IE", currency: "EUR", locale: "en-IE", lang: "en" };
const store = { id: "store-1", slug: "demo" };
const info = (over: Partial<CartBonus> = {}): CartBonus => ({
  enabled: true,
  signedIn: true,
  availableMinor: 5000,
  pendingMinor: 0,
  pendingAvailableAt: null,
  maxUsableMinor: 3000,
  usingMinor: 0,
  willEarnMinor: 250,
  earnPercent: 5,
  pendingDays: 14,
  ...over,
});
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveShop.mockResolvedValue({ store, market });
  readCartId.mockResolvedValue("cart-1");
  getCustomer.mockResolvedValue({ id: "customer-1" });
  cartBonus.mockResolvedValue(info());
  setCartCredits.mockImplementation(async (_shop, _cart, _customer, amount: number) => ({
    ok: true,
    usingMinor: amount,
  }));
});

describe("reading the cart's credits", () => {
  it("asks for the signed-in customer's, and a guest's without an id", async () => {
    await readCartBonus(store as never, market as never);
    expect(cartBonus).toHaveBeenCalledWith({ storeId: "store-1", market }, "cart-1", "customer-1");
    getCustomer.mockResolvedValue(null);
    await readCartBonus(store as never, market as never);
    expect(cartBonus).toHaveBeenLastCalledWith({ storeId: "store-1", market }, "cart-1", null);
  });

  it("is nothing without a cart", async () => {
    readCartId.mockResolvedValue(null);
    expect(await readCartBonus(store as never, market as never)).toBeNull();
    expect(cartBonus).not.toHaveBeenCalled();
  });
});

describe("the credits form", () => {
  it("sets the amount typed, in minor units, and says what is used", async () => {
    const outcome = await applyCreditsForm("demo", "ie", form({ use: "on", amount: "10.50", intent: "apply" }));
    expect(setCartCredits).toHaveBeenCalledWith({ storeId: "store-1", market }, "cart-1", "customer-1", 1050);
    expect(outcome.state).toEqual({ status: "done", message: "Using €10.50 in bonus credits." });
    expect(outcome.changed).toBe(true);
  });

  it("uses all that can be used for the button, whatever is typed", async () => {
    const outcome = await applyCreditsForm("demo", "ie", form({ use: "on", amount: "1", intent: "all" }));
    expect(setCartCredits).toHaveBeenCalledWith(expect.anything(), "cart-1", "customer-1", 3000);
    expect(outcome.state.status).toBe("done");
  });

  it("brings a larger amount down to the most that can be used, and says so", async () => {
    const outcome = await applyCreditsForm("demo", "ie", form({ use: "on", amount: "99", intent: "apply" }));
    expect(setCartCredits).toHaveBeenCalledWith(expect.anything(), "cart-1", "customer-1", 3000);
    expect(outcome.state.message).toBe("You can use up to €30.00 on this order, so that is what we used.");
  });

  it("takes the credits off when the box is not ticked", async () => {
    cartBonus.mockResolvedValue(info({ usingMinor: 1000 }));
    const outcome = await applyCreditsForm("demo", "ie", form({ amount: "10", intent: "apply" }));
    expect(setCartCredits).toHaveBeenCalledWith(expect.anything(), "cart-1", "customer-1", 0);
    expect(outcome.state).toEqual({ status: "done", message: "Not using bonus credits." });
    expect(outcome.changed).toBe(true);
  });

  it("does not call the change unchanged", async () => {
    cartBonus.mockResolvedValue(info({ usingMinor: 1000 }));
    const outcome = await applyCreditsForm("demo", "ie", form({ use: "on", amount: "10", intent: "apply" }));
    expect(outcome.changed).toBe(false);
  });

  it("tells the shopper, in their language, when the amount is not one or nothing can be used", async () => {
    let outcome = await applyCreditsForm("demo", "ie", form({ use: "on", amount: "ten", intent: "apply" }));
    expect(outcome.state).toEqual({ status: "problem", message: "Enter an amount, for example 10 or 10.50." });
    cartBonus.mockResolvedValue(info({ maxUsableMinor: 0 }));
    outcome = await applyCreditsForm("demo", "ie", form({ use: "on", amount: "5", intent: "apply" }));
    expect(outcome.state).toEqual({ status: "problem", message: "You have no bonus credits to use on this order." });
    expect(setCartCredits).not.toHaveBeenCalled();
  });

  it("uses the store's language for the texts", async () => {
    resolveShop.mockResolvedValue({ store, market: { ...market, lang: "nb", locale: "nb-NO" } });
    const outcome = await applyCreditsForm("demo", "ie", form({ use: "on", amount: "x", intent: "apply" }));
    expect(outcome.state.message).toBe("Skriv et beløp, for eksempel 10 eller 10,50.");
  });

  it("refuses a guest, a missing cart and a store without the program, and changes nothing", async () => {
    getCustomer.mockResolvedValue(null);
    expect((await applyCreditsForm("demo", "ie", form({ use: "on", amount: "5" }))).state.message).toBe(
      "Sign in to use bonus credits.",
    );
    getCustomer.mockResolvedValue({ id: "customer-1" });
    readCartId.mockResolvedValue(null);
    expect((await applyCreditsForm("demo", "ie", form({ use: "on", amount: "5" }))).state.status).toBe("problem");
    readCartId.mockResolvedValue("cart-1");
    cartBonus.mockResolvedValue(info({ enabled: false }));
    expect((await applyCreditsForm("demo", "ie", form({ use: "on", amount: "5" }))).state.status).toBe("problem");
    expect(setCartCredits).not.toHaveBeenCalled();
  });

  it("tells the shopper plainly when the server refuses, and does not claim a change", async () => {
    setCartCredits.mockResolvedValue({ ok: false, problems: ["Credits changed meanwhile."] });
    const outcome = await applyCreditsForm("demo", "ie", form({ use: "on", amount: "5", intent: "apply" }));
    expect(outcome.state.status).toBe("problem");
    expect(outcome.state.message).toMatch(/could not be used/);
    expect(outcome.changed).toBe(false);
  });

  it("does nothing for a store or market that does not exist", async () => {
    resolveShop.mockResolvedValue(null);
    const outcome = await applyCreditsForm("nope", "xx", form({}));
    expect(outcome).toMatchObject({ changed: false, shop: null, state: { status: "idle" } });
  });
});
