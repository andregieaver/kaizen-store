import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  READINESS_MESSAGES,
  WORK_ERROR_MESSAGES,
  notReadyCodes,
  readinessMessage,
  workErrorCode,
  workErrorMessage,
  workGuard,
  workProblems,
  zodProblems,
} from "./work-errors";

/** A database error as Drizzle raises it: the driver's error is the `cause` of a "Failed query" error. */
const wrapped = (message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`Failed query: select 1\nparams: `), {
    cause: Object.assign(new Error(message), { code: "23514", ...extra }),
  });

describe("work error codes", () => {
  it("finds the code in the driver's error under Drizzle's", () => {
    expect(workErrorCode(wrapped("work_time.immutable: time on an issued invoice cannot be changed or deleted"))).toBe(
      "work_time.immutable",
    );
    expect(workErrorCode(wrapped("work_credit_note.nothing_to_credit: there is nothing left to credit"))).toBe(
      "work_credit_note.nothing_to_credit",
    );
    expect(workErrorCode(new Error("work_series.lower: numbers already issued in work_invoice are not reused"))).toBe(
      "work_series.lower",
    );
  });

  it("is not fooled by other errors or by table names", () => {
    expect(workErrorCode(new Error("relation commerce.work_time_entries does not exist"))).toBeNull();
    expect(workErrorCode(wrapped('new row violates check constraint "work_time_entries_minutes"'))).toBeNull();
    expect(workErrorCode("work_time.immutable")).toBeNull();
    expect(workErrorCode(null)).toBeNull();
  });

  it("words every code the database raises, once", () => {
    for (const [code, message] of Object.entries(WORK_ERROR_MESSAGES)) {
      expect(code).toMatch(/^work_[a-z_]+\.[a-z_]+$/);
      expect(message.length).toBeGreaterThan(10);
      expect(workErrorMessage(wrapped(`${code}: whatever the database said`))).toContain(message.split(".")[0]);
    }
  });

  it("covers the invoice and credit note codes of docs/work.md 4.2a", () => {
    const codes = [
      "work_invoice.not_found",
      "work_invoice.not_draft",
      "work_invoice.not_ready",
      "work_invoice.total_changed",
      "work_invoice.date_in_future",
      "work_invoice.date_before_previous",
      "work_invoice.fx_rate_required",
      "work_credit_note.not_found",
      "work_credit_note.status",
      "work_credit_note.lines",
      "work_credit_note.quantity",
      "work_credit_note.nothing_to_credit",
      "work_credit_note.date_in_future",
      "work_credit_note.date_before_invoice",
      "work_credit_note.date_before_previous",
      "work_credit_note.currency",
      "work_credit_note.too_much",
      "work_payment.currency",
      "work_payment.reversal",
      "work_time.immutable",
    ];
    for (const code of codes) expect(WORK_ERROR_MESSAGES[code], code).toBeTruthy();
  });

  it("lists what an invoice still needs, in words", () => {
    const error = wrapped("work_invoice.not_ready: no_lines,seller_bank_account,buyer_address");
    expect(notReadyCodes(error)).toEqual(["no_lines", "seller_bank_account", "buyer_address"]);
    const message = workErrorMessage(error) ?? "";
    expect(message).toContain(READINESS_MESSAGES.no_lines);
    expect(message).toContain(READINESS_MESSAGES.seller_bank_account);
    expect(message).toContain(READINESS_MESSAGES.buyer_address);
    expect(notReadyCodes(wrapped("work_time.immutable: x"))).toEqual([]);
    expect(readinessMessage("something_new")).toBe("Not ready: something new.");
  });

  it("says which day the previous document is dated", () => {
    const message = workErrorMessage(
      wrapped("work_invoice.date_before_previous: the previous invoice is dated 2026-09-01"),
    );
    expect(message).toContain("2026-09-01");
  });

  it("falls back on the database's own words for a code it has no message for", () => {
    expect(workErrorMessage(wrapped("work_payment.newrule: money must be kept in a box"))).toBe(
      "money must be kept in a box",
    );
  });
});

describe("workProblems", () => {
  it("knows the constraints a person can run into", () => {
    expect(
      workProblems(wrapped("duplicate key", { code: "23505", constraint: "work_invoices_one_draft_idx" })),
    ).toEqual(["This assignment already has a draft invoice."]);
  });

  it("turns a row of another store into a plain message", () => {
    expect(
      workProblems(
        wrapped('insert violates foreign key constraint "work_time_entries_assignment_fk"', { code: "23503" }),
      ),
    ).toEqual(["That record no longer exists."]);
    expect(
      workProblems(wrapped('update or delete on table "work_clients" violates foreign key', { code: "23503" })),
    ).toEqual(["This cannot be removed because other records depend on it."]);
  });

  it("asks for another try when two writers clash", () => {
    expect(workProblems(wrapped("could not serialize access", { code: "40001" }))).toEqual([
      "Someone changed this at the same time. Try again.",
    ]);
  });

  it("does not disguise a bug as a mistake", () => {
    expect(workProblems(new Error("Cannot read properties of undefined"))).toBeNull();
    expect(workProblems(wrapped("syntax error", { code: "42601" }))).toBeNull();
  });

  it("gives a failed result for a refusal and lets anything else through", async () => {
    await expect(
      workGuard(async () => {
        throw wrapped("work_time.immutable: no");
      }),
    ).resolves.toEqual({ ok: false, problems: [WORK_ERROR_MESSAGES["work_time.immutable"]] });
    await expect(
      workGuard(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(workGuard(async () => ({ ok: true as const, id: "x" }))).resolves.toEqual({ ok: true, id: "x" });
  });
});

describe("zodProblems", () => {
  it("lists each message once", () => {
    const result = z.object({ a: z.string("Say a."), b: z.string("Say a.") }).safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) expect(zodProblems(result.error)).toEqual(["Say a."]);
  });
});
