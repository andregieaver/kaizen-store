/**
 * Where the Stripe SDK sends its calls: Stripe's own API (null), or a test server for the end-to-end build (bloat review step 1.7,
 * e2e/fixtures/stripe-stub.mjs). A test server is honoured only with STRIPE_ALLOW_TEST_URL=1, only on this machine's own address (plain
 * http to 127.0.0.1 or localhost) and never on Vercel, exactly as the VIES stand-in (`viesEndpoint()` in `src/lib/vies.ts`); the app has
 * no other switch for it.
 */
export function stripeEndpoint(env: {
  testUrl?: string | undefined;
  allowTest?: string | undefined;
  vercel?: string | undefined;
}): { host: string; port: number; protocol: "http" } | null {
  if (env.vercel || env.allowTest !== "1" || !env.testUrl) return null;
  let url: URL;
  try {
    url = new URL(env.testUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) return null;
  return { host: url.hostname, port: Number(url.port || 80), protocol: "http" as const };
}
