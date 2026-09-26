import { afterEach, describe, expect, it, vi } from "vitest";

import { siteUrl } from "./site";

afterEach(() => vi.unstubAllEnvs());

describe("Kaizen's own address", () => {
  it("is the production domain, never the stores' (P7)", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(siteUrl()).toBe("http://localhost:3000");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "kaizenstore.cloud");
    expect(siteUrl()).toBe("https://kaizenstore.cloud");
    // Vercel picks the shortest production domain, which can be the store domain.
    vi.stubEnv("NEXT_PUBLIC_STORE_DOMAIN", "kaizenstore.site");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "kaizenstore.site");
    expect(siteUrl()).toBe("https://kaizenstore.cloud");
    vi.stubEnv("SITE_URL", "https://kaizen.example/");
    expect(siteUrl()).toBe("https://kaizen.example");
  });
});
