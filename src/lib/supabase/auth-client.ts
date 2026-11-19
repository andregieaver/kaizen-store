import { AuthClient } from "@supabase/auth-js";
import { createStorageFromOptions } from "@supabase/ssr/dist/module/cookies";

import { publicEnv } from "@/lib/public-env";

type Auth = InstanceType<typeof AuthClient>;

let client: Auth | undefined;

/**
 * Supabase's auth client alone, for keeping the admin's session fresh in the browser (bloat review step 2.31). The full client
 * (`createClient()` in `client.ts`) carries the realtime, storage and database clients too: 259 KB against about 117 KB for this one,
 * and none of the three is used to keep a session.
 *
 * It is built the way @supabase/ssr 0.12.7's `createBrowserClient` builds it through supabase-js 2.118.0: the same cookie storage
 * (`base64url`), the same storage key (`sb-{first part of the host}-auth-token`, which `createServerClient` in `server.ts` reads), the
 * same headers and the same flow. `lock`, `fetch` and the other options stay unset, as supabase-js passes them. Re-read
 * `createBrowserClient.js` and supabase-js's `_initSupabaseAuthClient` on an upgrade of either (`auth-client.test.ts` fails until the
 * versions here are changed). One per tab. Reads `public-env` and never `env`, which would bring zod into every admin screen.
 */
export function createAuthClient(): Auth {
  if (client) return client;
  const env = publicEnv();
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const url = env.NEXT_PUBLIC_SUPABASE_URL.trim();
  const { storage } = createStorageFromOptions({ cookieEncoding: "base64url" }, false);
  const base = new URL(url.endsWith("/") ? url : url + "/");
  client = new AuthClient({
    url: new URL("auth/v1", base).href,
    headers: { Authorization: "Bearer " + key, apikey: key, "X-Client-Info": "supabase-ssr/0.12.7 createBrowserClient" },
    storageKey: "sb-" + base.hostname.split(".")[0] + "-auth-token",
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage,
    flowType: "pkce",
    hasCustomAuthorizationHeader: false,
  });
  return client;
}
