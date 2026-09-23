import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export type PublicEnv = z.infer<typeof publicSchema>;

/**
 * Reads the public Supabase settings. Parsed on use rather than at import, so a
 * build or test run without secrets fails only on the code path that needs them.
 */
export function publicEnv(
  source: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  },
): PublicEnv {
  const parsed = publicSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join("."));
    throw new Error(`Invalid or missing environment: ${missing.join(", ")}`);
  }
  return parsed.data;
}

const serverSchema = z.object({
  DATABASE_URL: z.string().startsWith("postgres"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

/** Reads server-only secrets. Never import this from client code. */
export function serverEnv(
  source: Record<string, string | undefined> = {
    DATABASE_URL: process.env.DATABASE_URL,
  },
): ServerEnv {
  const parsed = serverSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join("."));
    throw new Error(`Invalid or missing environment: ${missing.join(", ")}`);
  }
  return parsed.data;
}
