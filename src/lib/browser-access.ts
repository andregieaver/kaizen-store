/**
 * What a document may use of the browser, read without throwing. A frame sandboxed without `allow-same-origin` (the template preview,
 * D127) has an opaque origin: reading `navigator.serviceWorker` or `document.cookie` there throws a `SecurityError` rather than
 * answering, and one such throw in an effect took the whole preview down to the error page.
 */

/** The service worker container, or null where there is none or the document may not use one. */
export function serviceWorkerOf(nav: Navigator): ServiceWorkerContainer | null {
  try {
    return "serviceWorker" in nav ? nav.serviceWorker : null;
  } catch {
    return null;
  }
}

/** Whether the document may read its cookies (never in a sandboxed frame without `allow-same-origin`). */
export function cookiesReadable(doc: Pick<Document, "cookie">): boolean {
  try {
    void doc.cookie;
    return true;
  } catch {
    return false;
  }
}
