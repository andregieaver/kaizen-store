export type PublicEnv = { NEXT_PUBLIC_SUPABASE_URL: string; NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string };

function isUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the public Supabase settings. Parsed on use rather than at import, so a
 * build or test run without secrets fails only on the code path that needs them.
 * Its own file, without zod, because the browser's Supabase client reads it (bloat review step 0.9).
 */
export function publicEnv(
  source: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
): PublicEnv {
  const url = source.NEXT_PUBLIC_SUPABASE_URL;
  const key = source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const missing: string[] = [];
  if (!isUrl(url)) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (typeof key !== "string" || key.length === 0) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (missing.length > 0 || !isUrl(url) || typeof key !== "string") {
    throw new Error(`Invalid or missing environment: ${missing.join(", ")}`);
  }
  return { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key };
}
