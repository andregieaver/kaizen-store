/**
 * The phone app (D908, `docs/mobile-app.md`): a Capacitor shell that loads the admin from Kaizena Flow's own site. These are the rules both
 * sides share, with nothing of the browser or the server in them: how a request says it comes from the app, the app's own link scheme, which
 * addresses the app opens when it is handed one, and the name a downloaded file is saved under.
 */

/** The app's identity on both stores (`appId` in `capacitor.config.ts`): it can never change once the app is published. */
export const NATIVE_APP_ID = "com.humanweb.kaizenaflow";

/** The word the app adds to its web view's user agent (`appendUserAgent` in `capacitor.config.ts`; a test holds the two together). */
export const NATIVE_APP_MARK = "KaizenaFlowApp";

/** The app's own link scheme: a sign-in begun in the app comes back from the phone's browser at `kaizenaflow://auth/callback?…`. */
export const NATIVE_SCHEME = "kaizenaflow";

/** Whether a request comes from the app: its user agent carries the mark as a word of its own. */
export function isNativeAppAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return userAgent.split(/\s+/).some((word) => word === NATIVE_APP_MARK || word.startsWith(`${NATIVE_APP_MARK}/`));
}

/**
 * Where a sign-in through another site (Kaizen Life, D95) comes back to: the site's `/auth/callback` in a browser, the app's own scheme in the
 * app, since the app opens other sites in the phone's browser and only its scheme leads back into the app (the web view, which holds the
 * sign-in's PKCE cookie, then opens `/auth/callback` itself: `nativeOpenPath()`). `query` is the callback's own query, without `?`.
 */
export function signInReturnUrl(origin: string, query: string, native: boolean): string {
  return native ? `${NATIVE_SCHEME}://auth/callback?${query}` : `${origin}/auth/callback?${query}`;
}

/** The site's paths the app opens when it is handed an address (its scheme, or an email link to the site): sign-in's two and the admin. */
const OPENS = ["/auth/callback", "/auth/confirm"];

/**
 * The path on the site the app opens for an address it was handed, or null for anything else. `kaizenaflow://auth/callback?code=…` becomes
 * `/auth/callback?code=…`; a link to the site itself (`https://kaizenaflow.com/auth/confirm?token_hash=…`, the email's sign-in link that
 * opens the app, or an admin page) keeps its path and query. Another site, another scheme, another path or a path that climbs out with
 * `..` gives null: the app never opens what it was not built to.
 */
export function nativeOpenPath(incoming: string, site: string): string | null {
  let url: URL;
  let own: URL;
  try {
    url = new URL(incoming);
    own = new URL(site);
  } catch {
    return null;
  }
  let path: string;
  if (url.protocol === `${NATIVE_SCHEME}:`) {
    // A custom scheme's first part is its host: `kaizenaflow://auth/callback` is host `auth` and path `/callback`.
    path = `/${url.host}${url.pathname}`;
  } else if (url.origin === own.origin) {
    path = url.pathname;
  } else {
    return null;
  }
  if (path.split("/").some((part) => part === ".." || part === ".")) return null;
  const known = OPENS.includes(path) || path === "/admin" || path.startsWith("/admin/");
  return known ? `${path}${url.search}` : null;
}

/**
 * The name a file downloaded in the app is saved under, for the share sheet: the name the server gave (`Content-Disposition`, its UTF-8
 * `filename*` first), else the link's own `download` name, else the address's last part, else `download`. Never a path: anything up to a
 * slash or backslash is dropped, and characters a phone's file system refuses are replaced.
 */
export function downloadName(contentDisposition: string | null, suggested: string | null, href: string): string {
  const fromHeader = contentDisposition ? headerName(contentDisposition) : null;
  let fromAddress: string | null = null;
  try {
    const last = new URL(href).pathname.split("/").filter(Boolean).pop();
    fromAddress = last ? decodeURIComponent(last) : null;
  } catch {
    fromAddress = null;
  }
  for (const candidate of [fromHeader, suggested, fromAddress]) {
    const clean = candidate ? safeName(candidate) : "";
    if (clean) return clean;
  }
  return "download";
}

function headerName(header: string): string | null {
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // A malformed escape: fall back to the plain name.
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/.exec(header);
  if (!plain) return null;
  return (plain[2] ?? plain[1]).trim();
}

function safeName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  let out = "";
  for (const ch of last) out += ch.charCodeAt(0) < 32 || '<>:"|?*'.includes(ch) ? "_" : ch;
  return out.replace(/^\.+/, "").trim().slice(0, 120);
}

/**
 * The paths on the site that open the app when a link to them is tapped elsewhere (Universal Links, App Links): only `/auth/confirm`, the
 * email's sign-in and password links (a token hash, which works wherever it is opened). Never `/auth/callback`: its PKCE code works only in
 * the browser that asked for it, so a phone that handed it to the app would break a sign-in begun on the web.
 */
export const APP_LINK_PATHS = ["/auth/confirm"] as const;

/** `/.well-known/apple-app-site-association` for Apple's team id: the app, and the paths it opens. */
export function appleAppSiteAssociation(teamId: string) {
  return {
    applinks: {
      details: [{ appIDs: [`${teamId}.${NATIVE_APP_ID}`], components: APP_LINK_PATHS.map((path) => ({ "/": path })) }],
    },
  };
}

/** `/.well-known/assetlinks.json` for the Android app's signing keys: Android checks it before it lets the app open the site's links. */
export function assetLinks(fingerprints: readonly string[]) {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: NATIVE_APP_ID, sha256_cert_fingerprints: [...fingerprints] },
    },
  ];
}
