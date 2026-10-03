import { describe, expect, it } from "vitest";

import {
  approveReturn,
  closeReturn,
  declineReturn,
  defaultReturnSettingsInput,
  firstProblem,
  inspectReturn,
  refundReturn,
  returnQueueFilter,
  returnRequest,
  returnSettingsInput,
  withdrawalConfirm,
  withdrawalStart,
} from "./return-input";

const id = "6f1c1b2e-3d4a-4b5c-8d9e-0a1b2c3d4e5f";
const id2 = "7f1c1b2e-3d4a-4b5c-8d9e-0a1b2c3d4e5f";
const start = { orderNumber: " 1007 ", email: " Shopper@Example.COM ", name: " A Shopper ", lines: [{ lineId: id, quantity: 2 }] };
const problem = (result: { success: boolean; error?: Parameters<typeof firstProblem>[0] }) => (result.error ? firstProblem(result.error) : null);

describe("the withdrawal statement (step 1)", () => {
  it("reads what the shopper typed: trimmed, the email lower-cased, no reason asked", () => {
    const parsed = withdrawalStart.parse(start);
    expect(parsed).toEqual({ orderNumber: "1007", email: "shopper@example.com", name: "A Shopper", lines: [{ lineId: id, quantity: 2 }], orderKey: null });
    expect(withdrawalStart.parse({ ...start, orderKey: " key " }).orderKey).toBe("key");
  });

  it("fails with a code the shopper's screen writes in their language", () => {
    expect(problem(withdrawalStart.safeParse({ ...start, orderNumber: "  " }))).toEqual({ path: "orderNumber", message: "required" });
    expect(problem(withdrawalStart.safeParse({ ...start, email: "not-an-email" }))).toEqual({ path: "email", message: "email" });
    expect(problem(withdrawalStart.safeParse({ ...start, name: "" }))).toEqual({ path: "name", message: "required" });
    expect(problem(withdrawalStart.safeParse({ ...start, name: "x".repeat(121) }))).toEqual({ path: "name", message: "too_long" });
    expect(problem(withdrawalStart.safeParse({ ...start, lines: [] }))).toEqual({ path: "lines", message: "lines" });
    expect(problem(withdrawalStart.safeParse({ ...start, lines: [{ lineId: id, quantity: 0 }] }))).toEqual({ path: "lines.0.quantity", message: "quantity" });
    expect(problem(withdrawalStart.safeParse({ ...start, lines: [{ lineId: id, quantity: 1.5 }] }))).toEqual({ path: "lines.0.quantity", message: "quantity" });
    expect(problem(withdrawalStart.safeParse({ ...start, lines: [{ lineId: "x", quantity: 1 }] }))).toEqual({ path: "lines.0.lineId", message: "unknown" });
    expect(
      problem(
        withdrawalStart.safeParse({
          ...start,
          lines: [
            { lineId: id, quantity: 1 },
            { lineId: id, quantity: 1 },
          ],
        }),
      ),
    ).toEqual({ path: "lines", message: "lines" });
  });

  it("accepts several lines", () => {
    const lines = [
      { lineId: id, quantity: 1 },
      { lineId: id2, quantity: 3 },
    ];
    expect(withdrawalStart.parse({ ...start, lines }).lines).toEqual(lines);
  });
});

describe("the confirmation (step 2)", () => {
  it("names the request and nothing else", () => {
    expect(withdrawalConfirm.parse({ requestId: id })).toEqual({ requestId: id });
    expect(withdrawalConfirm.safeParse({ requestId: "nope" }).success).toBe(false);
  });
});

describe("a return request", () => {
  it("takes a reason from the list for the whole and per line, and a note up to 500 characters", () => {
    const parsed = returnRequest.parse({ ...start, reason: "too_big", note: " It does not fit ", lines: [{ lineId: id, quantity: 1, reason: "defective" }] });
    expect(parsed).toMatchObject({ reason: "too_big", note: "It does not fit", lines: [{ lineId: id, quantity: 1, reason: "defective" }] });
    const bare = returnRequest.parse(start);
    expect(bare).toMatchObject({ reason: null, note: null });
    expect(bare.lines[0].reason).toBeNull();
    expect(problem(returnRequest.safeParse({ ...start, reason: "because" }))).toEqual({ path: "reason", message: "reason" });
    expect(problem(returnRequest.safeParse({ ...start, note: "x".repeat(501) }))).toEqual({ path: "note", message: "too_long" });
  });
});

describe("staff inputs", () => {
  it("approves with instructions, an https label and an address", () => {
    const parsed = approveReturn.parse({
      returnId: id,
      instructions: "Pack it well",
      labelUrl: "https://label.example/1",
      returnAddress: { name: "Returns", street: "Lager 1", postalCode: "0150", city: "Oslo", country: "no" },
    });
    expect(parsed.returnAddress?.country).toBe("NO");
    expect(parsed.labelUrl).toBe("https://label.example/1");
    expect(approveReturn.parse({ returnId: id })).toMatchObject({ instructions: null, labelUrl: null, returnAddress: null, note: null });
    expect(problem(approveReturn.safeParse({ returnId: id, labelUrl: "http://label.example" }))).toEqual({ path: "labelUrl", message: "A return label address starts with https://." });
    expect(approveReturn.safeParse({ returnId: id, instructions: "x".repeat(2001) }).success).toBe(false);
  });

  it("declines only with a reason", () => {
    expect(problem(declineReturn.safeParse({ returnId: id, reason: "  " }))).toEqual({ path: "reason", message: "Say why the return is declined." });
    expect(declineReturn.parse({ returnId: id, reason: " Outside our window " }).reason).toBe("Outside our window");
  });

  it("inspects per line, with a note for any deduction, in whole minor units", () => {
    const line = { lineId: id, condition: "opened", restock: true, deductionMinor: 0 };
    expect(inspectReturn.parse({ returnId: id, lines: [line] }).lines[0]).toMatchObject({ condition: "opened", restock: true, deductionMinor: 0, deductionNote: null });
    expect(problem(inspectReturn.safeParse({ returnId: id, lines: [{ ...line, deductionMinor: 300 }] }))).toEqual({ path: "lines.0.deductionNote", message: "Say what the deduction is for." });
    expect(inspectReturn.parse({ returnId: id, lines: [{ ...line, deductionMinor: 300, deductionNote: "Used twice" }] }).lines[0].deductionMinor).toBe(300);
    expect(inspectReturn.safeParse({ returnId: id, lines: [{ ...line, condition: "broken" }] }).success).toBe(false);
    expect(inspectReturn.safeParse({ returnId: id, lines: [{ ...line, deductionMinor: -1 }] }).success).toBe(false);
    expect(inspectReturn.safeParse({ returnId: id, lines: [{ ...line, deductionMinor: 1.5 }] }).success).toBe(false);
    expect(inspectReturn.safeParse({ returnId: id, lines: [] }).success).toBe(false);
  });

  it("refunds a whole number of minor units, with defaults for shipping and restock", () => {
    expect(refundReturn.parse({ returnId: id, amountMinor: 1490 })).toEqual({ returnId: id, amountMinor: 1490, reason: null, returnShippingMinor: 0, restock: [] });
    expect(refundReturn.parse({ returnId: id, amountMinor: 0, restock: [{ lineId: id, quantity: 1 }] }).restock).toHaveLength(1);
    expect(refundReturn.safeParse({ returnId: id, amountMinor: 14.9 }).success).toBe(false);
    expect(refundReturn.safeParse({ returnId: id, amountMinor: -1 }).success).toBe(false);
  });

  it("closes with an optional note", () => {
    expect(closeReturn.parse({ returnId: id })).toEqual({ returnId: id, note: null });
  });

  it("reads the queue's filters, falling back to the open ones", () => {
    expect(returnQueueFilter.parse({})).toEqual({ status: "open", kind: "all", q: "", overdue: false });
    expect(returnQueueFilter.parse({ status: "received", kind: "withdrawal", q: " 1007 ", overdue: "true" })).toEqual({ status: "received", kind: "withdrawal", q: "1007", overdue: true });
    expect(returnQueueFilter.parse({ status: "nonsense", kind: "x" })).toMatchObject({ status: "open", kind: "all" });
  });
});

describe("the settings", () => {
  const ok = { ...defaultReturnSettingsInput };

  it("start as the legal defaults, and those are valid", () => {
    expect(defaultReturnSettingsInput).toEqual({
      windowDays: 14,
      transitDays: 3,
      whoPaysReturn: "shopper",
      refundWhen: "received",
      acceptExcluded: false,
      instructions: "",
      returnAddress: null,
      b2bReturns: false,
    });
    expect(returnSettingsInput.safeParse(ok).success).toBe(true);
  });

  it("holds the ranges: the window from 14 to 100, transit from 0 to 14", () => {
    expect(returnSettingsInput.safeParse({ ...ok, windowDays: 13 }).success).toBe(false);
    expect(problem(returnSettingsInput.safeParse({ ...ok, windowDays: 13 }))?.message).toMatch(/never shortened/);
    expect(returnSettingsInput.safeParse({ ...ok, windowDays: 14 }).success).toBe(true);
    expect(returnSettingsInput.safeParse({ ...ok, windowDays: 100 }).success).toBe(true);
    expect(returnSettingsInput.safeParse({ ...ok, windowDays: 101 }).success).toBe(false);
    expect(returnSettingsInput.safeParse({ ...ok, windowDays: 30.5 }).success).toBe(false);
    expect(returnSettingsInput.safeParse({ ...ok, transitDays: -1 }).success).toBe(false);
    expect(returnSettingsInput.safeParse({ ...ok, transitDays: 0 }).success).toBe(true);
    expect(returnSettingsInput.safeParse({ ...ok, transitDays: 14 }).success).toBe(true);
    expect(returnSettingsInput.safeParse({ ...ok, transitDays: 15 }).success).toBe(false);
  });

  it("holds the choices, the instructions' length and a whole address", () => {
    expect(returnSettingsInput.safeParse({ ...ok, whoPaysReturn: "carrier" }).success).toBe(false);
    expect(returnSettingsInput.safeParse({ ...ok, refundWhen: "later" }).success).toBe(false);
    expect(returnSettingsInput.safeParse({ ...ok, instructions: "x".repeat(2001) }).success).toBe(false);
    expect(returnSettingsInput.safeParse({ ...ok, instructions: "x".repeat(2000) }).success).toBe(true);
    const address = { name: "Returns", street: "Lager 1", postalCode: "0150", city: "Oslo", country: "NO" };
    expect(returnSettingsInput.safeParse({ ...ok, returnAddress: address }).success).toBe(true);
    expect(returnSettingsInput.safeParse({ ...ok, returnAddress: { ...address, city: "" } }).success).toBe(false);
    expect(returnSettingsInput.safeParse({ ...ok, returnAddress: { ...address, country: "Norway" } }).success).toBe(false);
  });
});
