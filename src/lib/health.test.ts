import { describe, expect, it, vi } from "vitest";

import { checkHealth } from "./health";

const env = () => ({
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
});

describe("checkHealth", () => {
  it("reports ok when Supabase auth answers", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const report = await checkHealth({ fetch, env, region: "dub1", commit: "abc" });

    expect(report).toEqual({
      status: "ok",
      region: "dub1",
      commit: "abc",
      supabase: "ok",
    });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://example.supabase.co/auth/v1/health");
    expect(init.headers).toEqual({ apikey: "sb_publishable_test" });
  });

  it("reports degraded when Supabase returns an error", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    const report = await checkHealth({ fetch, env, region: "dub1" });
    expect(report.status).toBe("degraded");
    expect(report.supabase).toBe("unreachable");
  });

  it("reports degraded when the request throws", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const report = await checkHealth({ fetch, env, region: "dub1" });
    expect(report.supabase).toBe("unreachable");
  });

  it("reports not_configured without making a request", async () => {
    const fetch = vi.fn();
    const report = await checkHealth({
      fetch,
      env: () => {
        throw new Error("missing");
      },
      region: "dub1",
    });
    expect(report.supabase).toBe("not_configured");
    expect(fetch).not.toHaveBeenCalled();
  });
});
