import { publicEnv, type PublicEnv } from "@/lib/env";

export type HealthReport = {
  status: "ok" | "degraded";
  region: string;
  commit: string | null;
  supabase: "ok" | "unreachable" | "not_configured";
};

type Fetch = typeof fetch;

/**
 * Checks that the app can reach Supabase, using the auth service's health
 * endpoint so the check needs no tables.
 */
export async function checkHealth(
  deps: {
    fetch?: Fetch;
    env?: () => PublicEnv;
    region?: string;
    commit?: string;
  } = {},
): Promise<HealthReport> {
  const doFetch = deps.fetch ?? fetch;
  const readEnv = deps.env ?? publicEnv;
  const region = deps.region ?? process.env.VERCEL_REGION ?? "local";
  const commit = deps.commit ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null;

  let env: PublicEnv;
  try {
    env = readEnv();
  } catch {
    return { status: "degraded", region, commit, supabase: "not_configured" };
  }

  try {
    const response = await doFetch(
      new URL("/auth/v1/health", env.NEXT_PUBLIC_SUPABASE_URL),
      {
        headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
        signal: AbortSignal.timeout(3000),
      },
    );
    const supabase = response.ok ? "ok" : "unreachable";
    return {
      status: supabase === "ok" ? "ok" : "degraded",
      region,
      commit,
      supabase,
    };
  } catch {
    return { status: "degraded", region, commit, supabase: "unreachable" };
  }
}
