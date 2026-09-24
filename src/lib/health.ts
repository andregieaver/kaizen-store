import { publicEnv, type PublicEnv } from "@/lib/env";
import { supabaseKeyKind } from "@/lib/supabase-key";

type CheckResult = "ok" | "unreachable" | "not_configured";

export type HealthReport = {
  status: "ok" | "degraded";
  region: string;
  commit: string | null;
  /** Supabase's API, which browser code and auth talk to. */
  supabase: CheckResult;
  /** The direct database connection the store's server code uses. */
  database: CheckResult;
  /** Which kind of connection string is configured (never the string itself). */
  databaseConnection: DatabaseConnectionKind | null;
  /**
   * The host, shown only for Supabase's shared pooler, whose host names are
   * public and regional. It carries no password or project id.
   */
  databaseHost: string | null;
  /** A short error code when the database check fails, e.g. `28P01`. */
  databaseError: string | null;
  activeMarkets: number | null;
  /**
   * Whether picture and file uploads have Supabase's secret key (never the
   * key itself): `publishable_key` means the wrong one, which Storage refuses.
   */
  uploadKey: "ok" | "publishable_key" | "unrecognised" | "not_set";
};

export type DatabaseConnectionKind =
  | "shared_pooler_transaction"
  | "shared_pooler_session"
  | "dedicated_pooler"
  | "direct"
  | "placeholder_password"
  | "other"
  | "invalid";

/**
 * Classifies a Postgres connection string without exposing it. Vercel can
 * reach Supabase only over IPv4, which the shared pooler provides; the direct
 * connection and dedicated pooler are IPv6 unless the IPv4 add-on is enabled.
 */
export function describeDatabaseUrl(value: string): DatabaseConnectionKind {
  if (value.includes("[YOUR-PASSWORD]")) return "placeholder_password";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "invalid";
  }
  if (url.hostname.endsWith(".pooler.supabase.com")) {
    return url.port === "6543"
      ? "shared_pooler_transaction"
      : "shared_pooler_session";
  }
  if (/^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname)) {
    return url.port === "6543" ? "dedicated_pooler" : "direct";
  }
  return "other";
}

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
    databaseUrl?: string;
    uploadKey?: string;
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

  const databaseUrl = deps.databaseUrl ?? process.env.DATABASE_URL;

  return {
    status: supabase === "ok" && database.result === "ok" ? "ok" : "degraded",
    region,
    commit,
    supabase,
    database: database.result,
    databaseConnection: databaseUrl ? describeDatabaseUrl(databaseUrl) : null,
    databaseHost: databaseUrl ? sharedPoolerHost(databaseUrl) : null,
    databaseError: database.error,
    activeMarkets: database.activeMarkets,
    uploadKey: uploadKeyKind(deps.uploadKey ?? process.env.SUPABASE_SECRET_KEY),
  };
}

function uploadKeyKind(key: string | undefined): HealthReport["uploadKey"] {
  if (!key?.trim()) return "not_set";
  const kind = supabaseKeyKind(key);
  return kind === "secret" ? "ok" : kind === "publishable" ? "publishable_key" : "unrecognised";
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
): Promise<{
  result: CheckResult;
  activeMarkets: number | null;
  error: string | null;
}> {
  if (!countActiveMarkets) {
    return { result: "not_configured", activeMarkets: null, error: null };
  }
  try {
    const activeMarkets = await Promise.race([
      countActiveMarkets(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS),
      ),
    ]);
    return { result: "ok", activeMarkets, error: null };
  } catch (error) {
    return { result: "unreachable", activeMarkets: null, error: errorCode(error) };
  }
}

/** The host of a shared-pooler connection string, or null for anything else. */
export function sharedPoolerHost(value: string): string | null {
  try {
    const { hostname } = new URL(value);
    return hostname.endsWith(".pooler.supabase.com") ? hostname : null;
  } catch {
    return null;
  }
}

/**
 * A short, non-secret code for a failed connection: a Postgres SQLSTATE
 * (`28P01` is a wrong password) or a network code (`ENETUNREACH`, `ENOTFOUND`).
 * Drizzle wraps driver errors, so the code may sit on a `cause`.
 */
export function errorCode(error: unknown): string {
  for (let e = error, depth = 0; e instanceof Error && depth < 5; depth++) {
    const code = (e as Error & { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,32}$/.test(code)) {
      return code;
    }
    if (e.message === "timeout") return "TIMEOUT";
    e = e.cause;
  }
  return "UNKNOWN";
}
