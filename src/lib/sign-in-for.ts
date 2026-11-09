/**
 * Kept apart from `sign-in-redirect.ts` for the browser: `SessionRecovery` runs on every admin page, and that module's `two-step`
 * import brings every admin word (`admin-text`) into the page's first scripts (`e2e/signed-in/admin-scripts.spec.ts`).
 */
import { safeNext } from "./password";

/**
 * The sign-in page for someone whose session is gone, keeping the page they asked for (docs/life-work-summary.md 3.5): a link from an
 * email, a push or Kaizen Life lands there after signing in, not on the admin's front page. Only an admin page is kept (`safeNext()`);
 * the front page and the sign-in pages (the second step is one) are not worth carrying.
 */
export function signInFor(path: string | null | undefined): string {
  const target = safeNext(path, "");
  const plain = target === "" || target === "/admin" || target.startsWith("/admin/sign-in");
  return plain ? "/admin/sign-in" : `/admin/sign-in?next=${encodeURIComponent(target)}`;
}
