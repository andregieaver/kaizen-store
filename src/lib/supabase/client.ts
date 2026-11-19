import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/public-env";

/**
 * Supabase client for Client Components: the full client (auth, realtime, storage, database). It is for uploads and imports only and must be
 * loaded on the press with `import()`; the admin's session is kept by `auth-client.ts` (bloat review step 2.31).
 */
export function createClient() {
  const env = publicEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
