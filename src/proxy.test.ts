import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const legacyAnswer = vi.fn();
const recordNotFound = vi.fn();
vi.mock("@/server/redirect-resolve", () => ({ legacyAnswer: (...args: unknown[]) => legacyAnswer(...args) }));
vi.mock("@/server/not-found", () => ({ recordNotFound: (...args: unknown[]) => recordNotFound(...args) }));
vi.mock("@/server/experiments", () => ({ runningExperiments: async () => [], storeIdOfSlug: async () => null }));

import { proxy } from "./proxy";

const event = { waitUntil: (p: Promise<unknown>) => void p } as never;
const call = (method: string) => proxy(new NextRequest("http://localhost/s/demo/collections/old", { method }), event);

describe("the proxy's lookup of an address with no country", () => {
  beforeEach(() => {
    legacyAnswer.mockReset();
    recordNotFound.mockReset();
    legacyAnswer.mockResolvedValue({ location: "/s/demo/dk/category/hjem" });
  });

  it.each(["GET", "HEAD"])("sends a %s request to the target for good", async (method) => {
    const response = await call(method);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost/s/demo/dk/category/hjem");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("leaves a %s request alone: no lookup, no redirect, no count of a missing page", async (method) => {
    const response = await call(method);
    expect(legacyAnswer).not.toHaveBeenCalled();
    expect(recordNotFound).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});
