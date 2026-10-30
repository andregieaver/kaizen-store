import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The database is down: every count throws.
vi.mock("@/db/client", () => ({ db: () => ({ execute: async () => Promise.reject(new Error("connection refused")) }) }));

const { takeBudget } = await import("./request-budget");
const { signInLocked } = await import("./sign-in-limit");

describe("counts when the database fails (PSI SEC-10)", () => {
  it("refuses a private store's password and an admin's password sign-in", async () => {
    expect(await takeBudget("00000000-0000-0000-0000-000000000001", "unlock", "v")).toBe(false);
    expect(await signInLocked("someone@example.com")).toBe(true);
  });

  it("still lets other endpoints answer", async () => {
    expect(await takeBudget(null, "consent", "v")).toBe(true);
  });
});
