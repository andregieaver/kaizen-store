/**
 * Apps for many stores (wave 14 unit D, D441, `docs/wave-14-developer-platform.md` D), the pure part: the developer terms' version, what an
 * app may ask for (unit B's scopes and the Admin API's powers), what a store's person must hold to install it, which events an
 * installation may be sent, and an app's form read and checked. The server is `src/server/developer-apps.ts` (apps) and
 * `src/server/oauth.ts` (installations, which are grants).
 */
import { API_POWERS, isApiPower } from "./admin-api";
import { EVENTS, type IntegrationEvent } from "./integrations";
import { clientNameProblem, normaliseScopes, OAUTH_SCOPES, redirectUriProblem, safeClientName, scopeHeld, STORES_READ, URI_MAX, type OAuthScope } from "./oauth";
import type { PermissionKey } from "./permission-keys";
import { SUBJECT_READ_AREA, topicOf } from "./webhook-topics";

/** The developer terms an account accepts to make apps (`/docs/developers/apps/developer-terms`): a draft until legal review (the spec's section 5). */
export const DEVELOPER_TERMS_VERSION = "2026-11-04";

/** Most apps one developer makes. */
export const APPS_MAX = 25;
/** Most redirect URIs an app has. */
export const APP_REDIRECTS_MAX = 10;
/** The longest description. */
export const APP_DESCRIPTION_MAX = 500;

export const APP_DISTRIBUTIONS = ["private", "unlisted", "listed"] as const;
export type AppDistribution = (typeof APP_DISTRIBUTIONS)[number];

/**
 * The powers an app may ask for (D440): what the AI manager asks the owner's yes for, by name. Not `webhooks:write`: its operations are
 * the owner's alone, and an app is sent its own events (D2) instead.
 */
export const APP_POWERS = API_POWERS.filter((power) => power !== "webhooks:write") as readonly Exclude<(typeof API_POWERS)[number], "webhooks:write">[];
export type AppPower = (typeof APP_POWERS)[number];
const isAppPower = (value: string): value is AppPower => (APP_POWERS as readonly string[]).includes(value);

/**
 * The permission each power rests on (D440 review): the one its operations need (`customers:email` is checked inside `customers.update`).
 * A person may give an app a power only while they hold it, and asking for a power asks for it too, since none of the power's operations
 * runs without it. At each call the operation's own permission is checked again, on the grant and on the person.
 */
export const POWER_PERMISSION: Record<AppPower, PermissionKey> = {
  "products:publish": "products:write",
  "orders:send": "orders:write",
  "orders:refund": "orders:write",
  "customers:email": "customers:write",
  "discounts:publish": "marketing:write",
  "gift_cards:write": "products:write",
  "content:publish": "website:write",
};

/** What an app may ask for: unit B's scopes, then the powers. */
export type AppScope = OAuthScope | AppPower;
export const APP_SCOPES: readonly AppScope[] = [...OAUTH_SCOPES.filter((s) => s !== "owner"), ...APP_POWERS];
export const isAppScope = (value: unknown): value is AppScope => typeof value === "string" && (APP_SCOPES as readonly string[]).includes(value);

/** The powers among an app's scopes. */
export const powersOf = (scopes: readonly string[]): AppPower[] => APP_POWERS.filter((power) => scopes.includes(power));

/**
 * Scopes in their canonical order, each power's permission with it, each `write` with its `read`, `stores:read` always, then the powers
 * asked for; nothing else.
 */
export function normaliseAppScopes(asked: readonly string[]): AppScope[] {
  const powers = powersOf(asked);
  const scopes: AppScope[] = normaliseScopes([...asked.filter((s) => !isApiPower(s) && s !== "owner"), ...powers.map((p) => POWER_PERMISSION[p])]);
  return [...scopes, ...powers];
}

/**
 * Every permission an app's scopes need a person to hold in the store it is installed on: each scope that is a permission key, and each
 * power's permission. `stores:read` needs none.
 */
export function appPermissions(scopes: readonly string[]): PermissionKey[] {
  const keys = new Set<PermissionKey>();
  for (const scope of normaliseAppScopes(scopes)) {
    if (scope === STORES_READ) continue;
    keys.add(isAppPower(scope) ? POWER_PERMISSION[scope] : (scope as PermissionKey));
  }
  return [...keys];
}

/** What an app asks for that a person who holds `held` cannot give: empty when they may install it. */
export const missingPermissions = (scopes: readonly string[], held: readonly PermissionKey[]): PermissionKey[] =>
  appPermissions(scopes).filter((key) => !held.includes(key) && !(key.endsWith(":read") && held.includes(key.replace(/:read$/, ":write") as PermissionKey)));

/**
 * Whether an app's call may do what an Admin API operation asks (D441): the grant holds the operation's permission (a write holds its
 * read), and, when the operation's scope is a power, that power. Whether the person may do it now is the route's `memberCan()`.
 */
export function appMayCall(grantScopes: readonly string[], operation: { scope: string; permission: string }): boolean {
  if (!scopeHeld(grantScopes, operation.permission as OAuthScope)) return false;
  return !isApiPower(operation.scope) || grantScopes.includes(operation.scope);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Events (D2)
// ---------------------------------------------------------------------------------------------------------------------------------

/** The scope a topic needs (`orders:read`, …), or null for one no app may be sent. */
export function topicScope(topic: string): OAuthScope | null {
  const subject = topicOf(topic)?.subject;
  const area = subject ? SUBJECT_READ_AREA[subject] : undefined;
  return area ? (`${area}:read` as OAuthScope) : null;
}

/** The topics an app may choose: every topic with an area an app can read. */
export const APP_TOPICS: readonly IntegrationEvent[] = EVENTS.map((e) => e.id).filter((id) => topicScope(id) !== null);

/**
 * The topics an installation is sent: the app's that its scopes read, and `customer.erased` always (an app must forget a person Kaizena
 * Flow erased, whatever it chose).
 */
export function installationTopics(appTopics: readonly string[], grantScopes: readonly string[]): IntegrationEvent[] {
  const chosen = new Set(appTopics);
  chosen.add("customer.erased");
  return APP_TOPICS.filter((topic) => {
    if (!chosen.has(topic)) return false;
    if (topic === "customer.erased") return true;
    const scope = topicScope(topic);
    return scope !== null && scopeHeld(grantScopes, scope);
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// An app's form
// ---------------------------------------------------------------------------------------------------------------------------------

export type AppInput = {
  name: string;
  description: string;
  logoUrl: string | null;
  homepageUrl: string | null;
  privacyUrl: string | null;
  supportEmail: string | null;
  redirectUris: string[];
  scopes: AppScope[];
  distribution: Exclude<AppDistribution, "listed"> | "listed";
  /** The events address typed; null keeps the one the app has (`webhookClear` takes it away). */
  webhookUrl: string | null;
  webhookClear: boolean;
  webhookTopics: IntegrationEvent[];
};

/** The form's fields as `FormData` gives them: one value each, and the lists as their repeated values (a file is read as nothing). */
export type AppForm = Pick<FormData, "get" | "getAll">;

const EMAIL = /^[^\s@<>()"',;:]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** An HTTPS address or null; the problem when it is neither empty nor one. */
function httpsUrl(raw: string | null, what: string): { value: string | null; problem: string | null } {
  const value = (raw ?? "").trim();
  if (value === "") return { value: null, problem: null };
  if (value.length > URI_MAX) return { value: null, problem: `${what} is too long.` };
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return { value: null, problem: `${what} must be an https:// address.` };
    return { value: url.toString(), problem: null };
  } catch {
    return { value: null, problem: `${what} must be an https:// address.` };
  }
}

/**
 * An app's form read and checked: a name (B's rules: no platform word, cleaned), a description, https addresses, a support email, one to
 * ten redirect URIs (HTTPS only: an app is a web server), the scopes (at least one besides `stores:read`), its distribution (`listed` is
 * asked for, and only granted by review) and its events address with the topics it wants (both, or neither).
 */
export function readAppForm(fields: AppForm): { ok: true; app: AppInput } | { ok: false; problems: Record<string, string> } {
  const form = {
    get: (name: string): string | null => {
      const value = fields.get(name);
      return typeof value === "string" ? value : null;
    },
    getAll: (name: string): string[] => fields.getAll(name).filter((value): value is string => typeof value === "string"),
  };
  const problems: Record<string, string> = {};
  const rawName = (form.get("name") ?? "").trim();
  const name = safeClientName(rawName);
  if (!name) problems.name = "Give the app a name.";
  else if (clientNameProblem(rawName)) problems.name = clientNameProblem(rawName) ?? "";
  const description = (form.get("description") ?? "").trim();
  if (description.length > APP_DESCRIPTION_MAX) problems.description = `At most ${APP_DESCRIPTION_MAX} characters.`;
  const logo = httpsUrl(form.get("logo_url"), "The logo's address");
  if (logo.problem) problems.logo_url = logo.problem;
  const homepage = httpsUrl(form.get("homepage_url"), "The homepage");
  if (homepage.problem) problems.homepage_url = homepage.problem;
  const privacy = httpsUrl(form.get("privacy_url"), "The privacy policy");
  if (privacy.problem) problems.privacy_url = privacy.problem;
  const email = (form.get("support_email") ?? "").trim();
  if (email && (email.length > 254 || !EMAIL.test(email))) problems.support_email = "Give an email address, such as support@example.com.";
  const redirectUris = [
    ...new Set(
      form
        .getAll("redirect_uris")
        .flatMap((v) => v.split(/\s+/))
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  if (redirectUris.length === 0) problems.redirect_uris = "Give at least one redirect URI.";
  else if (redirectUris.length > APP_REDIRECTS_MAX) problems.redirect_uris = `At most ${APP_REDIRECTS_MAX} redirect URIs.`;
  else {
    for (const uri of redirectUris) {
      const problem = redirectUriProblem(uri, "web");
      if (problem) {
        problems.redirect_uris = problem;
        break;
      }
    }
  }
  const scopes = normaliseAppScopes(form.getAll("scopes"));
  if (scopes.filter((s) => s !== STORES_READ).length === 0) problems.scopes = "Choose at least one thing the app needs.";
  const distribution = form.get("distribution") ?? "private";
  if (!(APP_DISTRIBUTIONS as readonly string[]).includes(distribution)) problems.distribution = "Choose who can install it.";
  const webhook = httpsUrl(form.get("webhook_url"), "The events address");
  if (webhook.problem) problems.webhook_url = webhook.problem;
  const topics = APP_TOPICS.filter((t) => form.getAll("webhook_topics").includes(t));
  const webhookClear = form.get("webhook_clear") === "on";
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return {
    ok: true,
    app: {
      name,
      description,
      logoUrl: logo.value,
      homepageUrl: homepage.value,
      privacyUrl: privacy.value,
      supportEmail: email || null,
      redirectUris,
      scopes,
      distribution: distribution as AppDistribution,
      webhookUrl: webhookClear ? null : webhook.value,
      webhookClear,
      webhookTopics: topics,
    },
  };
}

/** An app's client id as made: `kfapp_` and 22 characters of base64url (16 bytes), never a URL (so it is never taken for a metadata document). */
export const APP_CLIENT_ID = /^kfapp_[A-Za-z0-9_-]{22}$/;
/** An app's client secret as shown once: `kfas_` and 43 characters of base64url (32 bytes). */
export const APP_SECRET = /^kfas_[A-Za-z0-9_-]{43}$/;
/** An app's events secret as shown once: `kfws_` and 43 characters of base64url. */
export const APP_WEBHOOK_SECRET = /^kfws_[A-Za-z0-9_-]{43}$/;
