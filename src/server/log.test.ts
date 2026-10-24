import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { errorFields, log, logLine } = await import("./log");

describe("structured logs", () => {
  it("writes one JSON line with level, event and time first, and leaves out what is undefined", () => {
    const line = logLine("warn", "cron.job_late", { job: "carts", storeId: undefined, count: 3 });
    expect(line).not.toContain("\n");
    const entry = JSON.parse(line);
    expect(Object.keys(entry).slice(0, 3)).toEqual(["level", "event", "at"]);
    expect(entry).toMatchObject({ level: "warn", event: "cron.job_late", job: "carts", count: 3 });
    expect("storeId" in entry).toBe(false);
  });

  it("describes an error in a few short fields", () => {
    const error = Object.assign(new Error("x".repeat(900)), { digest: "abc123" });
    const fields = errorFields(error);
    expect(fields.errorName).toBe("Error");
    expect(String(fields.errorMessage)).toHaveLength(500);
    expect(fields.errorDigest).toBe("abc123");
    expect(String(fields.errorStack).length).toBeLessThanOrEqual(800);
    expect(errorFields("plain")).toEqual({ errorMessage: "plain" });
    expect(errorFields(new Error("Failed query", { cause: new Error('violates check constraint "cron_jobs_job"') })).errorCause).toContain("cron_jobs_job");
  });

  it("sends errors to console.error and the rest to log or warn", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    log("error", "a.failed", {}, new Error("boom"));
    log("info", "a.done");
    expect(JSON.parse(error.mock.calls[0][0]).errorMessage).toBe("boom");
    expect(JSON.parse(info.mock.calls[0][0]).event).toBe("a.done");
    error.mockRestore();
    info.mockRestore();
  });
});
