"use client";

import { useEffect } from "react";

import { serviceWorkerOf } from "@/lib/browser-access";

/** Registers the admin's service worker (D361) once the signed-in shell is drawn, so the admin can be installed and opens offline. */
export function AdminServiceWorker() {
  useEffect(() => {
    // None in a template's sandboxed preview frame (D127), where reading the container throws and took the page down.
    serviceWorkerOf(navigator)
      ?.register("/admin/sw.js", { scope: "/admin/" })
      .catch(() => {});
  }, []);
  return null;
}
