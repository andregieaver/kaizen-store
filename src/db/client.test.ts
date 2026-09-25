import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { isTransientDbError, retryTransient } = await import("./client");

/** As Drizzle throws it: its own error, caused by the driver's. */
const failed = (code: string) => Object.assign(new Error("Failed query: select 1"), { cause: Object.assign(new Error("pg"), { code }) });

describe("reads that meet a passing hiccup", () => {
  it("tell a timed-out, cancelled or lost query from a real error", () => {
    expect(isTransientDbError(failed("57014"))).toBe(true); // statement timeout
    expect(isTransientDbError(failed("08006"))).toBe(true); // connection failure
    expect(isTransientDbError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransientDbError(failed("42P01"))).toBe(false); // no such table
    expect(isTransientDbError(failed("23505"))).toBe(false); // unique violation
    expect(isTransientDbError(new Error("plain"))).toBe(false);
  });

  it("are tried once more, and only once", async () => {
    const flaky = vi.fn().mockRejectedValueOnce(failed("57014")).mockResolvedValueOnce(["row"]);
    await expect(retryTransient(flaky)).resolves.toEqual(["row"]);
    expect(flaky).toHaveBeenCalledTimes(2);

    const down = vi.fn().mockRejectedValue(failed("57014"));
    await expect(retryTransient(down)).rejects.toThrow("Failed query");
    expect(down).toHaveBeenCalledTimes(2);

    const wrong = vi.fn().mockRejectedValue(failed("42P01"));
    await expect(retryTransient(wrong)).rejects.toThrow("Failed query");
    expect(wrong).toHaveBeenCalledTimes(1);
  });
});
