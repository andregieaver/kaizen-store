import { publicEnv, type PublicEnv } from "@/lib/env";

type CheckResult = "ok" | "unreachable" | "not_configured";

export type HealthReport = {
  status: "ok" | "degraded";
  region: string;
  commit: string | null;
  /** Supabase's API, which browser code and auth talk to. */
  supabase: CheckResult;
  /** The direct database connection the store's server code uses. */
  database: CheckResult;
  activeMarkets: number | null;
};

type Fetch = typeof fetch;

const TIMEOUT_MS = 3000;

/**
 * Checks that the app can reach Supabase's API (through the auth service's
 * health endpoint) and the commerce database (by counting active markets).
 * `countActiveMarkets` is null when no database connection is configured.
 */
export async function checkHealth(
  deps: {
    fetch?: Fetch;
    env?: () => PublicEnv;
    countActiveMarkets?: (() => Promise<number>) | null;
    region?: string;
    commit?: string;
  } = {},
): Promise<HealthReport> {
  const region = deps.region ?? process.env.VERCEL_REGION ?? "local";
  const commit = deps.commit ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null;

  const [supabase, database] = await Promise.all([
    checkSupabase(deps.fetch ?? fetch, deps.env ?? publicEnv),
    checkDatabase(deps.countActiveMarkets ?? null),
  ]);

  return {
    status: supabase === "ok" && database.result === "ok" ? "ok" : "degraded",
    region,
    commit,
    supabase,
    database: database.result,
    activeMarkets: database.activeMarkets,
  };
}

async function checkSupabase(
  doFetch: Fetch,
  readEnv: () => PublicEnv,
): Promise<CheckResult> {
  let env: PublicEnv;
  try {
    env = readEnv();
  } catch {
    return "not_configured";
  }
  try {
    const response = await doFetch(
      new URL("/auth/v1/health", env.NEXT_PUBLIC_SUPABASE_URL),
      {
        headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    return response.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function checkDatabase(
  countActiveMarkets: (() => Promise<number>) | null,
): Promise<{ result: CheckResult; activeMarkets: number | null }> {
  if (!countActiveMarkets) {
    return { result: "not_configured", activeMarkets: null };
  }
  try {
    const activeMarkets = await Promise.race([
      countActiveMarkets(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS),
      ),
    ]);
    return { result: "ok", activeMarkets };
  } catch {
    return { result: "unreachable", activeMarkets: null };
  }
}
