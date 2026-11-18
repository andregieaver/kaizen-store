import { emailEventsSetup, emailSetup } from "@/lib/email-settings";
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
  /** A short error code when the database check fails, e.g. `28P01`. */
  databaseError: string | null;
  activeMarkets: number | null;
  /**
   * Whether picture and file uploads have Supabase's secret key (never the
   * key itself): `publishable_key` means the wrong one, which Storage refuses.
   */
  uploadKey: "ok" | "publishable_key" | "unrecognised" | "not_set";
  /** Whether Resend is set up to send (never the key), and to report deliveries back. */
  email: "ok" | "not_set" | "unrecognised";
  emailEvents: "ok" | "not_set" | "unrecognised";
  /**
   * The build that made this deployment: its seconds, its peak memory and the machine's, and the peaks of the ten builds before it
   * (numbers only, no secret; `scripts/next-build.mjs` writes them, `scripts/await-deploy.mjs` judges them). Left out when the build left none
   * (the report's other cases stay as they were; the wait reads a missing `build` as "no figures").
   */
  build?: { seconds: number; peakKb: number; machineKb: number; history: number[] } | null;
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
    uploadKey?: string;
    emailEnv?: Record<string, string | undefined>;
    region?: string;
    commit?: string;
    build?: HealthReport["build"] | null;
    buildCommit?: string | null;
  } = {},
): Promise<HealthReport> {
  const region = deps.region ?? process.env.VERCEL_REGION ?? "local";
  // A prebuilt deployment has no VERCEL_GIT_COMMIT_SHA: the build wrote the commit itself.
  const commit = deps.commit ?? process.env.VERCEL_GIT_COMMIT_SHA ?? deps.buildCommit ?? null;

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
    databaseError: database.error,
    activeMarkets: database.activeMarkets,
    uploadKey: uploadKeyKind(deps.uploadKey ?? process.env.SUPABASE_SECRET_KEY),
    email: emailSetup(deps.emailEnv ?? process.env),
    emailEvents: emailEventsSetup(deps.emailEnv ?? process.env),
    ...(deps.build ? { build: deps.build } : {}),
  };
}

/** What `build-stats.json` says: the build's figures and its commit; nothing when the text is not an object with seconds above 0 and a peak. */
export function readBuildStats(text: string): { build: NonNullable<HealthReport["build"]> | null; commit: string | null } {
  const none = { build: null, commit: null };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return none;
  }
  if (!data || typeof data !== "object") return none;
  const d = data as Record<string, unknown>;
  if (typeof d.seconds !== "number" || !(d.seconds > 0) || typeof d.peakKb !== "number") return none;
  const history = (Array.isArray(d.history) ? d.history : []).filter((n): n is number => typeof n === "number" && Number.isFinite(n)).slice(-10);
  return {
    build: { seconds: d.seconds, peakKb: d.peakKb, machineKb: typeof d.machineKb === "number" ? d.machineKb : 0, history },
    commit: typeof d.commit === "string" && /^[0-9a-f]{7,64}$/i.test(d.commit) ? d.commit : null,
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
