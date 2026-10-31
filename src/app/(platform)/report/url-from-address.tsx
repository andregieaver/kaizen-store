"use client";

import { useEffect, useRef } from "react";

/**
 * Fills the notice's address from `?url=`, or else from the page the visitor came from. Read
 * in the browser, so the page stays the same for everyone; without JavaScript the person pastes the address themselves.
 */
export function UrlFromAddress() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // A store's footer link sends no address of its own (its footer is the same on every page): the page the visitor came from stands in,
    // which a browser gives in full only for a store on Kaizena Flow's own domain.
    const referrer = document.referrer && !new URL(document.referrer).pathname.endsWith("/report") ? document.referrer : null;
    const url = new URLSearchParams(window.location.search).get("url") ?? referrer;
    const input = marker.current?.closest("form")?.querySelector<HTMLInputElement>('input[name="url"]');
    if (url && input && input.value === "" && /^https?:\/\//.test(url)) input.value = url.slice(0, 2000);
  }, []);
  return <span ref={marker} hidden />;
}
