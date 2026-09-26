/** Kaizen's own domain, where its pages and the admin live. */
const KAIZEN_HOST = "kaizenstore.cloud";

/**
 * Kaizen's public origin, for canonical URLs, structured data, emails and
 * the admin: `SITE_URL` if set, else the project's production domain.
 * Vercel gives the shortest one, which can be the store domain (P7) once it
 * is on the project; that is the stores' and never Kaizen's, so Kaizen's
 * own domain stands in for it.
 */
export function siteUrl(): string {
  const explicit = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.toLowerCase();
  if (!host) return "http://localhost:3000";
  const stores = process.env.NEXT_PUBLIC_STORE_DOMAIN?.trim().toLowerCase().split(":")[0];
  const storesHost = Boolean(stores) && (host === stores || host.endsWith(`.${stores}`));
  return `https://${storesHost ? KAIZEN_HOST : host}`;
}
