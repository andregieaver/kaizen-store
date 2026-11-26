import { z } from "zod";

export { publicEnv, type PublicEnv } from "./public-env";

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
 * The incident autopilot's wake (D895): the scheduled Claude Code task's API trigger id and that task's own token, made by the owner in
 * claude.ai (it can start that one task and nothing else). Null without both: the app then sends no wakes and the nightly run covers all.
 */
export function autopilotWakeEnv(
  source: Record<string, string | undefined> = {
    AUTOPILOT_FIRE_TOKEN: process.env.AUTOPILOT_FIRE_TOKEN,
    AUTOPILOT_TRIGGER_ID: process.env.AUTOPILOT_TRIGGER_ID,
  },
): { token: string; triggerId: string } | null {
  const token = source.AUTOPILOT_FIRE_TOKEN?.trim();
  const triggerId = source.AUTOPILOT_TRIGGER_ID?.trim();
  if (!token || !triggerId) return null;
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(triggerId)) throw new Error("AUTOPILOT_TRIGGER_ID must be the scheduled task's trigger id (letters, digits, _ and -).");
  return { token, triggerId };
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
 * The phone app's link files (D908, `docs/mobile-app.md`): Apple's team id (ten letters and digits, Apple Developer → Membership), for
 * `/.well-known/apple-app-site-association`, and the SHA-256 fingerprints of the keys the Android app is signed with (the upload key's and
 * Google Play's app signing key's, comma-separated, as Play Console → App integrity shows them), for `/.well-known/assetlinks.json`. Each
 * file answers 404 while its setting is empty, and email sign-in links then open in the browser as before.
 */
export function appLinksEnv(
  source: Record<string, string | undefined> = {
    APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
    ANDROID_APP_SHA256: process.env.ANDROID_APP_SHA256,
  },
): { appleTeamId: string | null; androidFingerprints: string[] } {
  const appleTeamId = source.APPLE_TEAM_ID?.trim().toUpperCase() || null;
  if (appleTeamId && !/^[A-Z0-9]{10}$/.test(appleTeamId)) throw new Error("APPLE_TEAM_ID must be the ten letters and digits of the Apple team id.");
  const androidFingerprints = (source.ANDROID_APP_SHA256 ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  for (const fingerprint of androidFingerprints) {
    if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint)) throw new Error("ANDROID_APP_SHA256 must be SHA-256 fingerprints written AA:BB:…, comma-separated.");
  }
  return { appleTeamId, androidFingerprints };
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
 * Kaizena Flow's partner app at Airwallex (D599, `docs/agent-spending.md` 5): its OAuth client id and secret from Airwallex's partner
 * program, and which Airwallex it talks to (`sandbox` until `AIRWALLEX_MODE=live`). Owners connect their own Airwallex account to it for the
 * AI's single-use cards. Null without both: the wallet says it is not available yet. Confidential client: the secret stays on the server.
 */
export function airwallexEnv(
  source: Record<string, string | undefined> = {
    AIRWALLEX_CLIENT_ID: process.env.AIRWALLEX_CLIENT_ID,
    AIRWALLEX_CLIENT_SECRET: process.env.AIRWALLEX_CLIENT_SECRET,
    AIRWALLEX_MODE: process.env.AIRWALLEX_MODE,
  },
): { clientId: string; clientSecret: string; mode: "sandbox" | "live" } | null {
  const clientId = source.AIRWALLEX_CLIENT_ID?.trim();
  const clientSecret = source.AIRWALLEX_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(clientId)) throw new Error("AIRWALLEX_CLIENT_ID must be the client id of Kaizena Flow's partner app at Airwallex.");
  if (clientSecret.length < 8 || clientSecret.length > 512 || /\s/.test(clientSecret)) throw new Error("AIRWALLEX_CLIENT_SECRET must be the client secret of Kaizena Flow's partner app at Airwallex.");
  const mode = source.AIRWALLEX_MODE?.trim() || "sandbox";
  if (mode !== "sandbox" && mode !== "live") throw new Error("AIRWALLEX_MODE must be sandbox or live.");
  return { clientId, clientSecret, mode };
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

/**
 * Kaizena Flow's own app at eBay (D555): its client id and secret from eBay's developer program, and its RuName (eBay's name for the app's
 * registered return address, `{SITE_URL}/api/integrations/ebay/callback`). Null without all three: eBay is not offered.
 */
export function ebayApp(
  source: Record<string, string | undefined> = { EBAY_CLIENT_ID: process.env.EBAY_CLIENT_ID, EBAY_CLIENT_SECRET: process.env.EBAY_CLIENT_SECRET, EBAY_RU_NAME: process.env.EBAY_RU_NAME },
): { clientId: string; clientSecret: string; ruName: string } | null {
  const clientId = source.EBAY_CLIENT_ID?.trim();
  const clientSecret = source.EBAY_CLIENT_SECRET?.trim();
  const ruName = source.EBAY_RU_NAME?.trim();
  if (!clientId || !clientSecret || !ruName) return null;
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(clientId)) throw new Error("EBAY_CLIENT_ID must be the App ID of Kaizena Flow's app at eBay.");
  if (clientSecret.length < 8 || clientSecret.length > 256 || /\s/.test(clientSecret)) throw new Error("EBAY_CLIENT_SECRET must be the Cert ID of Kaizena Flow's app at eBay.");
  if (!/^[A-Za-z0-9._-]{4,200}$/.test(ruName)) throw new Error("EBAY_RU_NAME must be the RuName eBay gave the app's return address.");
  return { clientId, clientSecret, ruName };
}

/**
 * Kaizena Flow's public integration at Canva (D898, `docs/design-tools.md`): its client id and secret from Canva's Developer Portal, with
 * `{SITE_URL}/api/integrations/canva/callback` as its redirect URL and `{SITE_URL}/api/integrations/canva/return` as its return URL. Null
 * without both: nothing Canva is offered.
 */
export function canvaApp(
  source: Record<string, string | undefined> = { CANVA_CLIENT_ID: process.env.CANVA_CLIENT_ID, CANVA_CLIENT_SECRET: process.env.CANVA_CLIENT_SECRET },
): { clientId: string; clientSecret: string } | null {
  const clientId = source.CANVA_CLIENT_ID?.trim();
  const clientSecret = source.CANVA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(clientId)) throw new Error("CANVA_CLIENT_ID must be the client ID of Kaizena Flow's integration at Canva.");
  if (clientSecret.length < 8 || clientSecret.length > 512 || /\s/.test(clientSecret)) throw new Error("CANVA_CLIENT_SECRET must be the client secret of Kaizena Flow's integration at Canva.");
  return { clientId, clientSecret };
}

export type SesEnv = { accessKeyId: string; secretAccessKey: string; region: string; configurationSet: string | null; topicArn: string | null };

/**
 * Amazon SES for bulk marketing email (D748 section 10, D872): an IAM user's access key with SES's sending and identity rights, the region
 * (Ireland unless told otherwise, and always inside the EU), the configuration set whose events go to SNS, and the SNS topic those events
 * come from (`/api/ses/events` takes no other). Null without both keys: marketing email goes through Resend, as before.
 */
export function sesEnv(
  source: Record<string, string | undefined> = {
    AWS_SES_ACCESS_KEY_ID: process.env.AWS_SES_ACCESS_KEY_ID,
    AWS_SES_SECRET_ACCESS_KEY: process.env.AWS_SES_SECRET_ACCESS_KEY,
    AWS_SES_REGION: process.env.AWS_SES_REGION,
    AWS_SES_CONFIGURATION_SET: process.env.AWS_SES_CONFIGURATION_SET,
    AWS_SES_EVENTS_TOPIC_ARN: process.env.AWS_SES_EVENTS_TOPIC_ARN,
  },
): SesEnv | null {
  const accessKeyId = source.AWS_SES_ACCESS_KEY_ID?.trim();
  const secretAccessKey = source.AWS_SES_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return null;
  if (!/^(AKIA|ASIA)[A-Z0-9]{12,124}$/.test(accessKeyId)) throw new Error("AWS_SES_ACCESS_KEY_ID must be an AWS access key id (AKIA…).");
  if (secretAccessKey.length < 20 || secretAccessKey.length > 128 || /\s/.test(secretAccessKey)) throw new Error("AWS_SES_SECRET_ACCESS_KEY must be the secret of that access key.");
  const region = source.AWS_SES_REGION?.trim() || "eu-west-1";
  // Mail is made and sent inside the EU (CLAUDE.md): an SES region outside it is refused.
  if (!/^eu-(west|central|north|south)-[1-9]$/.test(region)) throw new Error("AWS_SES_REGION must be an SES region inside the EU, such as eu-west-1.");
  const configurationSet = source.AWS_SES_CONFIGURATION_SET?.trim() || null;
  if (configurationSet && !/^[A-Za-z0-9_-]{1,64}$/.test(configurationSet)) throw new Error("AWS_SES_CONFIGURATION_SET must be the name of an SES configuration set.");
  const topicArn = source.AWS_SES_EVENTS_TOPIC_ARN?.trim() || null;
  if (topicArn && !/^arn:aws:sns:eu-[a-z]+-\d:\d{12}:[A-Za-z0-9_-]{1,256}$/.test(topicArn)) throw new Error("AWS_SES_EVENTS_TOPIC_ARN must be the ARN of an SNS topic inside the EU.");
  return { accessKeyId, secretAccessKey, region, configurationSet, topicArn };
}
