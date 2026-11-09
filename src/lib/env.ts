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

/**
 * Vercel's log drain for usage (D314, `docs/capacity.md` step 1.4): the secret it signs with and the sampling rate it was made with
 * (1 unless set, between 0 and 1). Null without a secret: the drain route is then off.
 */
export function usageDrainEnv(
  source: Record<string, string | undefined> = {
    USAGE_DRAIN_SECRET: process.env.USAGE_DRAIN_SECRET,
    USAGE_DRAIN_SAMPLE_RATE: process.env.USAGE_DRAIN_SAMPLE_RATE,
  },
): { secret: string; sampleRate: number } | null {
  const secret = source.USAGE_DRAIN_SECRET?.trim();
  if (!secret) return null;
  const rate = source.USAGE_DRAIN_SAMPLE_RATE?.trim() ? Number(source.USAGE_DRAIN_SAMPLE_RATE) : 1;
  if (!(rate > 0 && rate <= 1)) throw new Error("USAGE_DRAIN_SAMPLE_RATE must be a number above 0 and at most 1.");
  return { secret, sampleRate: rate };
}

/**
 * Domain Connect's signing key (D315 6): the private key (PEM, PKCS#8 or RSA), with `\n` written as two characters allowed so it fits one
 * variable. Null without it: *Connect automatically* is then not offered.
 */
export function domainConnectKey(source: Record<string, string | undefined> = { DOMAIN_CONNECT_PRIVATE_KEY: process.env.DOMAIN_CONNECT_PRIVATE_KEY }): string | null {
  const raw = source.DOMAIN_CONNECT_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const pem = raw.replace(/\\n/g, "\n");
  if (!/^-----BEGIN (RSA )?PRIVATE KEY-----/.test(pem)) throw new Error("DOMAIN_CONNECT_PRIVATE_KEY must be a PEM private key.");
  return pem;
}

/**
 * Kaizen Life's account link (docs/life-work-summary.md 3.3): Kaizena Flow's own ES256 private key (PEM, PKCS#8), which signs what it
 * asks Kaizen Life, and Kaizen Life's public key (PEM, SPKI), which checks what Kaizen Life asks here; `\n` written as two characters
 * is allowed, so each fits one variable. Null without both: nothing is linked, and the link's doors refuse everything.
 */
export function kaizenLifeLinkKeys(
  source: Record<string, string | undefined> = {
    KAIZEN_LIFE_LINK_PRIVATE_KEY: process.env.KAIZEN_LIFE_LINK_PRIVATE_KEY,
    KAIZEN_LIFE_LINK_PUBLIC_KEY: process.env.KAIZEN_LIFE_LINK_PUBLIC_KEY,
  },
): { privateKey: string; lifePublicKey: string } | null {
  const own = source.KAIZEN_LIFE_LINK_PRIVATE_KEY?.trim().replace(/\\n/g, "\n");
  const life = source.KAIZEN_LIFE_LINK_PUBLIC_KEY?.trim().replace(/\\n/g, "\n");
  if (!own || !life) return null;
  if (!/^-----BEGIN PRIVATE KEY-----/.test(own)) throw new Error("KAIZEN_LIFE_LINK_PRIVATE_KEY must be a PEM (PKCS#8) private key.");
  if (!/^-----BEGIN PUBLIC KEY-----/.test(life)) throw new Error("KAIZEN_LIFE_LINK_PUBLIC_KEY must be a PEM (SPKI) public key.");
  return { privateKey: own, lifePublicKey: life };
}

/**
 * The admin's Web Push keys (D361): the VAPID key pair (base64url, as `web-push generate-vapid-keys` prints them) and who the push services
 * may contact (`mailto:` or a web address; Kaizena Flow's site by default). Null without both keys: notifications are then not offered.
 */
export function vapidEnv(
  source: Record<string, string | undefined> = {
    VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  },
): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = source.VAPID_PUBLIC_KEY?.trim();
  const privateKey = source.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(publicKey) || !/^[A-Za-z0-9_-]{40,50}$/.test(privateKey)) throw new Error("VAPID keys must be base64url, as web-push generates them.");
  const subject = source.VAPID_SUBJECT?.trim() || "https://kaizenaflow.com";
  if (!/^(mailto:|https:\/\/)/.test(subject)) throw new Error("VAPID_SUBJECT must start with mailto: or https://.");
  return { publicKey, privateKey, subject };
}

/**
 * Kaizena Flow's own Google OAuth client for customers' *Sign in with Google* (D375): its id and secret, from Google Cloud's console, with
 * `{SITE_URL}/api/auth/google/callback` as its one redirect address. Null without both: the button is not shown anywhere.
 */
export function googleEnv(
  source: Record<string, string | undefined> = { GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET },
): { clientId: string; clientSecret: string } | null {
  const clientId = source.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = source.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  if (!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error("GOOGLE_CLIENT_ID must be a Google OAuth client id (….apps.googleusercontent.com).");
  return { clientId, clientSecret };
}

/**
 * Kaizena Flow's consumer token from Tripletex for one environment (D453): what Tripletex gives an approved integration, used with
 * an owner's employee token to open a session. Null when not set: then only a company's own API token connects.
 */
export function tripletexConsumerToken(
  mode: "test" | "live",
  source: Record<string, string | undefined> = {
    TRIPLETEX_CONSUMER_TOKEN: process.env.TRIPLETEX_CONSUMER_TOKEN,
    TRIPLETEX_TEST_CONSUMER_TOKEN: process.env.TRIPLETEX_TEST_CONSUMER_TOKEN,
  },
): string | null {
  const value = (mode === "live" ? source.TRIPLETEX_CONSUMER_TOKEN : source.TRIPLETEX_TEST_CONSUMER_TOKEN)?.trim();
  if (!value) return null;
  if (!/^[A-Za-z0-9._~+/=-]{16,2000}$/.test(value)) throw new Error("TRIPLETEX_CONSUMER_TOKEN must be the consumer token Tripletex gave Kaizena Flow.");
  return value;
}

/**
 * Kaizena Flow's app at Fiken (D460): its OAuth2 client id and secret, from the app made under Fiken's user settings → API (a developer's
 * account). Without them the Fiken page says it is not available yet. Confidential client: the secret stays on the server.
 */
export function fikenEnv(
  source: Record<string, string | undefined> = {
    FIKEN_CLIENT_ID: process.env.FIKEN_CLIENT_ID,
    FIKEN_CLIENT_SECRET: process.env.FIKEN_CLIENT_SECRET,
  },
): { clientId: string; clientSecret: string } | null {
  const clientId = source.FIKEN_CLIENT_ID?.trim();
  const clientSecret = source.FIKEN_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(clientId)) throw new Error("FIKEN_CLIENT_ID must be the client id of Kaizena Flow's app at Fiken.");
  if (clientSecret.length < 8 || clientSecret.length > 256 || /\s/.test(clientSecret)) throw new Error("FIKEN_CLIENT_SECRET must be the client secret of Kaizena Flow's app at Fiken.");
  return { clientId, clientSecret };
}

/**
 * Kaizena Flow's own Shopify app for moving a shop in (D445 step 2, `docs/moving-from-shopify.md` 4.2, `shopify/shopify.app.toml`): its
 * client id and secret from Shopify's Dev Dashboard, with `{SITE_URL}/api/shopify/callback` as its redirect address. `SHOPIFY_ALL_ORDERS=1`
 * once Shopify has approved `read_all_orders` for the app. Null without both: *Connect Shopify* is not offered and the files stay the way in.
 */
export function shopifyEnv(
  source: Record<string, string | undefined> = {
    SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
    SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
    SHOPIFY_ALL_ORDERS: process.env.SHOPIFY_ALL_ORDERS,
  },
): { clientId: string; clientSecret: string; allOrders: boolean } | null {
  const clientId = source.SHOPIFY_CLIENT_ID?.trim();
  const clientSecret = source.SHOPIFY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(clientId)) throw new Error("SHOPIFY_CLIENT_ID must be the app's client id from Shopify's Dev Dashboard.");
  return { clientId, clientSecret, allOrders: source.SHOPIFY_ALL_ORDERS?.trim() === "1" };
}

/**
 * Kaizena Flow's Sendcloud Tech Partner id (D483, `docs/sendcloud-labels.md`), sent as `Sendcloud-Partner-Id` on every call once
 * Sendcloud has approved the integration; Sendcloud refuses an id it does not know, so it stays unset until then. Null without it.
 */
export function sendcloudPartnerId(source: Record<string, string | undefined> = { SENDCLOUD_PARTNER_ID: process.env.SENDCLOUD_PARTNER_ID }): string | null {
  const id = source.SENDCLOUD_PARTNER_ID?.trim();
  if (!id) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("SENDCLOUD_PARTNER_ID must be the partner UUID Sendcloud gave.");
  return id;
}
