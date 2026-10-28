import { adminServiceWorker } from "@/lib/admin-sw";

/** The admin's service worker (D361), scoped to `/admin/`, never cached long so a new version reaches people. */
export function GET() {
  return new Response(adminServiceWorker(), {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/admin/" },
  });
}
