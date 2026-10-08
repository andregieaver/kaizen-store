import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeRequestAnswer = vi.fn();
const recordNotFound = vi.fn();
vi.mock("@/server/redirect-resolve", () => ({ storeRequestAnswer: (...args: unknown[]) => storeRequestAnswer(...args) }));
vi.mock("@/server/not-found", () => ({ recordNotFound: (...args: unknown[]) => recordNotFound(...args) }));
vi.mock("@/server/experiments", () => ({ runningExperiments: async () => [], storeIdOfSlug: async () => null }));

import { proxy } from "./proxy";

const event = { waitUntil: (p: Promise<unknown>) => void p } as never;
const call = (method: string, path = "/s/demo/collections/old") => proxy(new NextRequest(`http://localhost${path}?x=1`, { method }), event);

describe("the proxy's answer for a store's page", () => {
  beforeEach(() => {
    storeRequestAnswer.mockReset();
    recordNotFound.mockReset();
  });

  it.each(["GET", "HEAD"])("sends a %s request that moved there for good", async (method) => {
    storeRequestAnswer.mockResolvedValue({ location: "/s/demo/dk/category/hjem" });
    const response = await call(method);
    expect(storeRequestAnswer).toHaveBeenCalledWith("/s/demo/collections/old", "?x=1", null, true);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost/s/demo/dk/category/hjem");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("asks without moving a %s request: no redirect, no count of a missing page", async (method) => {
    storeRequestAnswer.mockResolvedValue(null);
    const response = await call(method);
    expect(storeRequestAnswer).toHaveBeenCalledWith("/s/demo/collections/old", "?x=1", null, false);
    expect(recordNotFound).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it.each(["GET", "POST"])("serves a short address (D181) from the long one for a %s, a server action's included", async (method) => {
    storeRequestAnswer.mockResolvedValue({ rewrite: "/s/kaiza/no/home" });
    const response = await call(method, "/s/kaiza/home");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBe("http://localhost/s/kaiza/no/home?x=1");
  });

  it("counts a missing page after the response", async () => {
    storeRequestAnswer.mockResolvedValue({ miss: { storeId: "s1", path: "/collections/old" } });
    const response = await call("GET");
    expect(response.status).toBe(200);
    expect(recordNotFound).toHaveBeenCalledWith("s1", "/collections/old", false);
  });

  it("leaves the request alone when the answer fails", async () => {
    storeRequestAnswer.mockRejectedValue(new Error("down"));
    const response = await call("GET");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
