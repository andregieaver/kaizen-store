/** Kaizen's own domain, where its pages and the admin live. */
const KAIZEN_HOST = "kaizenaflow.com";

/**
 * Kaizen's public origin, for canonical URLs, structured data, emails and
 * the admin: `SITE_URL` if set, else Kaizen's own domain on Vercel. The
 * project's production domain (`VERCEL_PROJECT_PRODUCTION_URL`) is not
 * Kaizen's to trust: Vercel gives the shortest custom domain on the
 * project, which can be the store domain (P7) or any store's own domain
 * (P8) once it is added. It stands only while the project has none, as a
 * `vercel.app` address.
 */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim().toLowerCase();
  if (!host) return "http://localhost:3000";
  return `https://${host.endsWith(".vercel.app") ? host : KAIZEN_HOST}`;
}

/**
 * Kaizena Flow's own host as the world reaches it (`kaizenaflow.com`), for the domain watch (ecosystem plan E5.2, D757): null where the site
 * is not public on a domain of its own, on plain http, with a port, at an address or a local name, or on a `vercel.app` address (Vercel's).
 */
export function publicSiteHost(origin: string = siteUrl()): string | null {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.port || !host.includes(".") || /^[\d.]+$/.test(host) || host.startsWith("[")) return null;
  return host.endsWith(".vercel.app") || host.endsWith(".localhost") ? null : host;
}
