import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
const resolveShop = vi.fn();
const customers = {
  getCustomer: vi.fn(),
  startFreshSignIn: vi.fn(),
  confirmFreshWithCode: vi.fn(),
  confirmFreshWithPassword: vi.fn(),
};
const shopperErase = vi.fn();
const sendSignInCode = vi.fn();
vi.mock("@/server/shop", () => ({ resolveShop: (...a: unknown[]) => resolveShop(...a) }));
vi.mock("@/server/customers", () => ({
  getCustomer: (...a: unknown[]) => customers.getCustomer(...a),
  startFreshSignIn: (...a: unknown[]) => customers.startFreshSignIn(...a),
  confirmFreshWithCode: (...a: unknown[]) => customers.confirmFreshWithCode(...a),
  confirmFreshWithPassword: (...a: unknown[]) => customers.confirmFreshWithPassword(...a),
}));
vi.mock("@/server/privacy-shopper", () => ({ shopperErase: (...a: unknown[]) => shopperErase(...a) }));
vi.mock("@/server/shopper-emails", () => ({ sendSignInCode: (...a: unknown[]) => sendSignInCode(...a) }));

import { confirmStepUpAction, deleteAccountAction, requestStepUpCodeAction } from "./actions";

const START = { step: "start", message: null, error: false } as const;
const CODE = { step: "code", message: null, error: false } as const;
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const to = async (run: Promise<unknown>) => run.then(() => null, (error: Error) => error.message);

beforeEach(() => {
  vi.clearAllMocks();
  resolveShop.mockResolvedValue({ store: { id: "s1", slug: "demo" }, market: { slug: "no", code: "NO", locale: "nb-NO", lang: "nb" } });
  customers.getCustomer.mockResolvedValue({ id: "c1", email: "kari@example.com", hasPassword: true });
  customers.startFreshSignIn.mockResolvedValue({ code: "123456", email: "kari@example.com" });
});

describe("asking for a code to confirm it is them (D162)", () => {
  it("emails the code to the address on file only, and says it was sent", async () => {
    const state = await requestStepUpCodeAction("demo", "no", START);
    expect(state).toMatchObject({ step: "code", error: false });
    expect(sendSignInCode).toHaveBeenCalledWith("s1", "NO", "nb-NO", "kari@example.com", "123456");
  });

  it("says so when too many were asked for, and sends nothing", async () => {
    customers.startFreshSignIn.mockResolvedValueOnce(null);
    const state = await requestStepUpCodeAction("demo", "no", START);
    expect(state).toMatchObject({ step: "start", error: true });
    expect(sendSignInCode).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to My account and sends nothing", async () => {
    customers.getCustomer.mockResolvedValueOnce(null);
    expect(await to(requestStepUpCodeAction("demo", "no", START))).toBe("REDIRECT /s/demo/no/account");
    expect(customers.startFreshSignIn).not.toHaveBeenCalled();
  });
});

describe("confirming with a code or the password", () => {
  it("goes on to the page they came for once the code is right", async () => {
    customers.confirmFreshWithCode.mockResolvedValueOnce(true);
    expect(await to(confirmStepUpAction("demo", "no", "privacy", CODE, form({ code: "123 456" })))).toBe("REDIRECT /s/demo/no/account/privacy");
    expect(customers.confirmFreshWithCode).toHaveBeenCalledWith("s1", "c1", "123456");
    customers.confirmFreshWithCode.mockResolvedValueOnce(true);
    expect(await to(confirmStepUpAction("demo", "no", "confirm", CODE, form({ code: "123456" })))).toBe("REDIRECT /s/demo/no/account/privacy/confirm");
  });

  it("refuses a wrong or short code and a wrong password with one plain message, and does not go on", async () => {
    customers.confirmFreshWithCode.mockResolvedValue(false);
    const wrong = await confirmStepUpAction("demo", "no", "privacy", CODE, form({ code: "000000" }));
    expect(wrong).toMatchObject({ error: true });
    expect(wrong.message).toContain("Koden eller passordet stemte ikke");
    await confirmStepUpAction("demo", "no", "privacy", CODE, form({ code: "123" }));
    expect(customers.confirmFreshWithCode).toHaveBeenCalledTimes(1);
    customers.confirmFreshWithPassword.mockResolvedValueOnce({ ok: false, locked: false });
    expect(await confirmStepUpAction("demo", "no", "privacy", START, form({ password: "feil" }))).toMatchObject({ error: true, message: wrong.message });
  });

  it("goes on after the right password, and says when too many tries have locked it", async () => {
    customers.confirmFreshWithPassword.mockResolvedValueOnce({ ok: true, customerId: "c1" });
    expect(await to(confirmStepUpAction("demo", "no", "confirm", START, form({ password: "riktig" })))).toBe("REDIRECT /s/demo/no/account/privacy/confirm");
    customers.confirmFreshWithPassword.mockResolvedValueOnce({ ok: false, locked: true });
    const locked = await confirmStepUpAction("demo", "no", "confirm", START, form({ password: "x" }));
    expect(locked).toMatchObject({ error: true });
    expect(locked.message).not.toContain("Koden eller passordet stemte ikke");
  });
});

describe("deleting the account", () => {
  const ok = (over: object = {}) => ({ ok: true, outcome: "erased", requestId: "r1", summary: { keptUntil: { first: "2031-01-01", last: "2033-01-01" } }, counts: { ordersRestricted: 2 }, confirmation: "sent", ...over });

  it("goes to the result with counts and a day only: no name, email or address in the address", async () => {
    shopperErase.mockResolvedValueOnce(ok());
    const where = await to(deleteAccountAction("demo", "no", START));
    expect(where).toBe("REDIRECT /s/demo/no/account/privacy/confirm?done=1&kept=2&until=2033-01-01&mail=1");
    expect(where).not.toContain("kari");
    expect(shopperErase).toHaveBeenCalledWith("s1");
  });

  it("says so when the confirmation email did not go, and when nothing is kept", async () => {
    shopperErase.mockResolvedValueOnce(ok({ confirmation: "failed", summary: { keptUntil: null }, counts: { ordersRestricted: 0 } }));
    expect(await to(deleteAccountAction("demo", "no", START))).toBe("REDIRECT /s/demo/no/account/privacy/confirm?done=1&kept=0&until=&mail=0");
  });

  it("sends a stale session to confirm it is them and a signed-out visitor to My account", async () => {
    shopperErase.mockResolvedValueOnce({ ok: false, problem: "stale" });
    expect(await to(deleteAccountAction("demo", "no", START))).toBe("REDIRECT /s/demo/no/account/privacy/confirm");
    shopperErase.mockResolvedValueOnce({ ok: false, problem: "signed_out" });
    expect(await to(deleteAccountAction("demo", "no", START))).toBe("REDIRECT /s/demo/no/account");
  });

  it("keeps the button and says plainly when Stripe did not answer, and when something else went wrong", async () => {
    shopperErase.mockResolvedValueOnce({ ok: false, problem: "stripe", message: "x", requestId: "r1" });
    const stripe = await deleteAccountAction("demo", "no", START);
    expect(stripe).toMatchObject({ error: true });
    expect(stripe.message).toContain("Stripe svarte ikke");
    shopperErase.mockResolvedValueOnce({ ok: false, problem: "failed", message: "x", requestId: "r1" });
    const failed = await deleteAccountAction("demo", "no", START);
    expect(failed.message).toContain("Noe gikk galt");
    expect(redirect).not.toHaveBeenCalled();
  });
});
