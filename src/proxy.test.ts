import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storeRequestAnswer = vi.fn();
const recordNotFound = vi.fn();
vi.mock("@/server/redirect-resolve", () => ({ storeRequestAnswer: (...args: unknown[]) => storeRequestAnswer(...args), privateGate: async () => null }));
vi.mock("@/server/not-found", () => ({ recordNotFound: (...args: unknown[]) => recordNotFound(...args) }));
vi.mock("@/server/holding", () => ({ holdingFor: async () => null }));
vi.mock("@/server/experiments", () => ({ runningExperiments: async () => [], storeIdOfSlug: async () => null }));
const siteStore = vi.fn(async (): Promise<string | null> => null);
vi.mock("@/server/house-switch", () => ({ siteStore: () => siteStore() }));

import { proxy } from "./proxy";

const event = { waitUntil: (p: Promise<unknown>) => void p } as never;
const call = (method: string, path = "/s/demo/collections/old") => proxy(new NextRequest(`http://localhost${path}?x=1`, { method }), event);

describe("the proxy's answer for a store's page", () => {
  beforeEach(() => {
    storeRequestAnswer.mockReset();
    recordNotFound.mockReset();
    siteStore.mockReset();
    siteStore.mockResolvedValue(null);
  });

  it.each(["GET", "HEAD"])("sends a %s request that moved there for good", async (method) => {
    storeRequestAnswer.mockResolvedValue({ location: "/s/demo/dk/category/hjem" });
    const response = await call(method);
    expect(storeRequestAnswer).toHaveBeenCalledWith("/s/demo/collections/old", "?x=1", null, true, expect.any(String), expect.objectContaining({ bot: false }));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost/s/demo/dk/category/hjem");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("asks without moving a %s request: no redirect, no count of a missing page", async (method) => {
    storeRequestAnswer.mockResolvedValue(null);
    const response = await call(method);
    expect(storeRequestAnswer).toHaveBeenCalledWith("/s/demo/collections/old", "?x=1", null, false, expect.any(String), expect.objectContaining({ bot: false }));
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

  it("sends a visitor at the front door to their language for now, never cached (D479)", async () => {
    storeRequestAnswer.mockResolvedValue({ language: "/s/kaiza/en?x=1" });
    const request = new NextRequest("http://localhost/s/kaiza?x=1", {
      headers: { "accept-language": "en-GB,en;q=0.9", "x-vercel-ip-country": "GB", cookie: "kaizen_lang_s1=en" },
    });
    const response = await proxy(request, event);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/s/kaiza/en?x=1");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const visitor = storeRequestAnswer.mock.calls[0][5] as { country: string; acceptLanguage: string; cookie: (name: string) => string | undefined };
    expect(visitor).toMatchObject({ bot: false, country: "GB", acceptLanguage: "en-GB,en;q=0.9" });
    expect(visitor.cookie("kaizen_lang_s1")).toBe("en");
  });

  it("tells the answer a crawler is one", async () => {
    storeRequestAnswer.mockResolvedValue(null);
    await proxy(new NextRequest("http://localhost/s/kaiza", { headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" } }), event);
    expect(storeRequestAnswer.mock.calls[0][5]).toMatchObject({ bot: true });
  });

  it("leaves the request alone when the answer fails", async () => {
    storeRequestAnswer.mockRejectedValue(new Error("down"));
    const response = await call("GET");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("Kaizena Flow's site served from its own store (D484, job 6)", () => {
  beforeEach(() => {
    storeRequestAnswer.mockReset();
    recordNotFound.mockReset();
    siteStore.mockReset();
    vi.unstubAllEnvs();
  });

  const site = (method: string, path: string) => proxy(new NextRequest(`http://localhost${path}`, { method, headers: { host: "localhost" } }), event);

  it("answers the site's pages with the store's, under /s/{store}, as the store's own host would", async () => {
    siteStore.mockResolvedValue("kaizenaflow");
    storeRequestAnswer.mockResolvedValue({ rewrite: "/no-nb/about-us" });
    const response = await site("GET", "/no/about-us");
    expect(storeRequestAnswer).toHaveBeenCalledWith("/no/about-us", "", "kaizenaflow", true, "localhost", expect.objectContaining({ bot: false }));
    expect(response.headers.get("x-middleware-rewrite")).toBe("http://localhost/s/kaizenaflow/no-nb/about-us");
  });

  it("serves a path the decision leaves alone from the store too, the front page included", async () => {
    siteStore.mockResolvedValue("kaizenaflow");
    storeRequestAnswer.mockResolvedValue(null);
    expect((await site("GET", "/agents.md")).headers.get("x-middleware-rewrite")).toBe("http://localhost/s/kaizenaflow/agents.md");
    expect((await site("GET", "/")).headers.get("x-middleware-rewrite")).toBe("http://localhost/s/kaizenaflow");
  });

  it("moves an address on the site's own host, never to the store's", async () => {
    siteStore.mockResolvedValue("kaizenaflow");
    storeRequestAnswer.mockResolvedValue({ location: "/no/about-us" });
    const response = await site("GET", "/nb/about-us");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("http://localhost/no/about-us");
  });

  it("leaves the platform's own routes to the platform", async () => {
    siteStore.mockResolvedValue("kaizenaflow");
    storeRequestAnswer.mockResolvedValue(null);
    for (const path of ["/sign-up", "/themes/atelier", "/no/sign-up", "/status"]) {
      const response = await site("GET", path);
      expect(storeRequestAnswer).toHaveBeenLastCalledWith(path, "", null, true, "localhost", expect.objectContaining({ bot: false }));
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
  });

  it("changes nothing while the switch is off, or cannot be read", async () => {
    storeRequestAnswer.mockResolvedValue(null);
    siteStore.mockResolvedValue(null);
    expect((await site("GET", "/about-us")).headers.get("x-middleware-rewrite")).toBeNull();
    expect(storeRequestAnswer).toHaveBeenLastCalledWith("/about-us", "", null, true, "localhost", expect.objectContaining({ bot: false }));
    siteStore.mockRejectedValue(new Error("down"));
    expect((await site("GET", "/about-us")).headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("sends the store's own host to the site while it is on (307), and leaves it be while it is off", async () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_DOMAIN", "localhost:3000");
    storeRequestAnswer.mockResolvedValue(null);
    const own = (path: string) => proxy(new NextRequest(`http://kaizenaflow.localhost:3000${path}`, { method: "GET", headers: { host: "kaizenaflow.localhost:3000" } }), event);
    siteStore.mockResolvedValue("kaizenaflow");
    const response = await own("/about-us?a=1");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/about-us?a=1");
    siteStore.mockResolvedValue(null);
    expect((await own("/about-us")).status).toBe(200);
  });
});
