import { describe, expect, it, vi } from "vitest";

import { checkHealth } from "./health";

const env = () => ({
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
});

const okFetch = () =>
  vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

describe("checkHealth", () => {
  it("reports ok when Supabase and the database both answer", async () => {
    const fetch = okFetch();
    const report = await checkHealth({
      fetch,
      env,
      countActiveMarkets: async () => 4,
      region: "dub1",
      commit: "abc",
    });

    expect(report).toEqual({
      status: "ok",
      region: "dub1",
      commit: "abc",
      supabase: "ok",
      database: "ok",
      activeMarkets: 4,
    });
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://example.supabase.co/auth/v1/health");
    expect(init.headers).toEqual({ apikey: "sb_publishable_test" });
  });

  it("reports degraded when Supabase returns an error", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 500 }));
    const report = await checkHealth({
      fetch,
      env,
      countActiveMarkets: async () => 4,
    });
    expect(report.status).toBe("degraded");
    expect(report.supabase).toBe("unreachable");
  });

  it("reports degraded when the Supabase request throws", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const report = await checkHealth({
      fetch,
      env,
      countActiveMarkets: async () => 4,
    });
    expect(report.supabase).toBe("unreachable");
  });

  it("reports Supabase not_configured without making a request", async () => {
    const fetch = vi.fn();
    const report = await checkHealth({
      fetch,
      env: () => {
        throw new Error("missing");
      },
      countActiveMarkets: async () => 4,
    });
    expect(report.supabase).toBe("not_configured");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports the database not_configured without a connection", async () => {
    const report = await checkHealth({
      fetch: okFetch(),
      env,
      countActiveMarkets: null,
    });
    expect(report).toMatchObject({
      status: "degraded",
      database: "not_configured",
      activeMarkets: null,
    });
  });

  it("reports the database unreachable when the query fails", async () => {
    const report = await checkHealth({
      fetch: okFetch(),
      env,
      countActiveMarkets: async () => {
        throw new Error("password authentication failed");
      },
    });
    expect(report).toMatchObject({
      status: "degraded",
      database: "unreachable",
      activeMarkets: null,
    });
  });

  it("gives up on a database that does not answer", async () => {
    vi.useFakeTimers();
    try {
      const pending = checkHealth({
        fetch: okFetch(),
        env,
        countActiveMarkets: () => new Promise<number>(() => {}),
      });
      await vi.advanceTimersByTimeAsync(3000);
      expect((await pending).database).toBe("unreachable");
    } finally {
      vi.useRealTimers();
    }
  });
});
