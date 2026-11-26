/**
 * Whether a connection may publish (D870 S3.1): the permission each channel's token must carry, read from what Meta says was granted. A
 * module of its own and without imports, as the Instagram feed's connection (`src/server/instagram.ts`), which every storefront reaches,
 * reads it.
 */

/** The permission each channel's token must carry to publish. */
export const PUBLISH_PERMISSION = { instagram: "instagram_business_content_publish", facebook: "pages_manage_posts" } as const;

/** Whether a token Instagram gave carries the publishing permission, from the permissions its exchange named. */
export function grantsPublish(permissions: unknown): boolean {
  const list = Array.isArray(permissions) ? permissions : typeof permissions === "string" ? permissions.split(",") : [];
  return list.some((p) => String(p).trim() === PUBLISH_PERMISSION.instagram);
}

/** Whether the person granted `pages_manage_posts`, from `/me/permissions`. */
export function grantsPagePublish(json: unknown): boolean {
  const data = (json as { data?: unknown })?.data;
  return Array.isArray(data) && (data as Record<string, unknown>[]).some((p) => p?.permission === PUBLISH_PERMISSION.facebook && p.status === "granted");
}
