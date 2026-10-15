import { afterEach, describe, expect, it, vi } from "vitest";

import { siteUrl } from "./site";

afterEach(() => vi.unstubAllEnvs());

describe("Kaizena Flow's own address", () => {
  it("is Kaizena Flow's domain, never a store's (P7, P8)", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(siteUrl()).toBe("http://localhost:3000");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "kaizenaflow.com");
    expect(siteUrl()).toBe("https://kaizenaflow.com");
    // Vercel picks the shortest production domain: the store domain, or a store's own once it is on the project.
    vi.stubEnv("NEXT_PUBLIC_STORE_DOMAIN", "kaizenstore.site");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "kaizenstore.site");
    expect(siteUrl()).toBe("https://kaizenaflow.com");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "kaizenaflow.com");
    expect(siteUrl()).toBe("https://kaizenaflow.com");
    // A project with no domain of its own yet.
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "kaizen-store.vercel.app");
    expect(siteUrl()).toBe("https://kaizen-store.vercel.app");
    vi.stubEnv("SITE_URL", "https://kaizen.example/");
    expect(siteUrl()).toBe("https://kaizen.example");
  });
});
