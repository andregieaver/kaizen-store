/** Kaizen's own domain, where its pages and the admin live. */
const KAIZEN_HOST = "kaizenstore.cloud";

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
