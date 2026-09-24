import { describe, expect, it, vi } from "vitest";

import {
  checkHealth,
  describeDatabaseUrl,
  errorCode,
  sharedPoolerHost,
} from "./health";

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
      databaseUrl:
        "postgres://postgres.ref:secret@aws-1-eu-west-1.pooler.supabase.com:6543/postgres",
      region: "dub1",
      commit: "abc",
      uploadKey: "sb_publishable_wrong",
      emailEnv: { RESEND_API_KEY: "re_secret", EMAIL_FROM: "butikk@kaizenstore.cloud" },
    });

    expect(report).toEqual({
      status: "ok",
      region: "dub1",
      commit: "abc",
      supabase: "ok",
      database: "ok",
      databaseConnection: "shared_pooler_transaction",
      databaseHost: "aws-1-eu-west-1.pooler.supabase.com",
      databaseError: null,
      activeMarkets: 4,
      uploadKey: "publishable_key",
      email: "ok",
      emailEvents: "not_set",
    });
    expect(JSON.stringify(report)).not.toContain("secret");
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

  it("reports the database unreachable, with its error code, when the query fails", async () => {
    const report = await checkHealth({
      fetch: okFetch(),
      env,
      countActiveMarkets: async () => {
        throw Object.assign(new Error("password authentication failed"), {
          code: "28P01",
        });
      },
    });
    expect(report).toMatchObject({
      status: "degraded",
      database: "unreachable",
      databaseError: "28P01",
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
      const report = await pending;
      expect(report.database).toBe("unreachable");
      expect(report.databaseError).toBe("TIMEOUT");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("describeDatabaseUrl", () => {
  it("recognises each kind of Supabase connection string", () => {
    const ref = "ybsozesfuxuitoacntfo";
    expect(
      describeDatabaseUrl(
        `postgres://postgres.${ref}:pw@aws-1-eu-west-1.pooler.supabase.com:6543/postgres`,
      ),
    ).toBe("shared_pooler_transaction");
    expect(
      describeDatabaseUrl(
        `postgres://postgres.${ref}:pw@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`,
      ),
    ).toBe("shared_pooler_session");
    expect(
      describeDatabaseUrl(`postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres`),
    ).toBe("direct");
    expect(
      describeDatabaseUrl(`postgresql://postgres:pw@db.${ref}.supabase.co:6543/postgres`),
    ).toBe("dedicated_pooler");
  });

  it("spots a password placeholder that was never filled in", () => {
    expect(
      describeDatabaseUrl(
        "postgres://postgres.ref:[YOUR-PASSWORD]@aws-1-eu-west-1.pooler.supabase.com:6543/postgres",
      ),
    ).toBe("placeholder_password");
  });

  it("flags values that are not URLs", () => {
    expect(describeDatabaseUrl("not a url")).toBe("invalid");
  });
});

describe("errorCode", () => {
  it("finds the driver's code under a wrapping error", () => {
    const driverError = Object.assign(new Error("Tenant or user not found"), {
      code: "XX000",
    });
    const wrapped = new Error("Failed query: select 1", { cause: driverError });
    expect(errorCode(wrapped)).toBe("XX000");
  });

  it("falls back to UNKNOWN for errors without a code", () => {
    expect(errorCode(new Error("boom"))).toBe("UNKNOWN");
    expect(errorCode("not an error")).toBe("UNKNOWN");
  });
});

describe("sharedPoolerHost", () => {
  it("shows a shared-pooler host, including a mistyped one", () => {
    expect(
      sharedPoolerHost(
        "postgres://postgres.ref:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
      ),
    ).toBe("aws-0-eu-west-1.pooler.supabase.com");
    // A copied "…" or "..." placeholder shows up as-is, so it can be spotted.
    expect(
      sharedPoolerHost(
        "postgres://postgres.ref:pw@aws-…-eu-west-1.pooler.supabase.com:6543/postgres",
      ),
    ).toBe("aws-%E2%80%A6-eu-west-1.pooler.supabase.com");
    expect(
      sharedPoolerHost(
        "postgres://postgres.ref:pw@aws-...-eu-west-1.pooler.supabase.com:6543/postgres",
      ),
    ).toBe("aws-...-eu-west-1.pooler.supabase.com");
  });

  it("never shows other hosts", () => {
    expect(
      sharedPoolerHost("postgresql://postgres:pw@db.ref.supabase.co:5432/postgres"),
    ).toBeNull();
    expect(sharedPoolerHost("not a url")).toBeNull();
  });
});
