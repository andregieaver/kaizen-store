"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * A link with a written prefetch policy (bloat review step 0.13): view (Next's default, when it scrolls into view), intent (when the pointer, a touch or focus
 * reaches it: Next's hover pattern), none (never; for a link that leaves its root layout or opens a file). Step 2.6 uses it on the storefront.
 */
export type LinkPolicy = "view" | "intent" | "none";

export function PolicyLink({
  policy,
  onPointerEnter,
  onTouchStart,
  onFocus,
  ...rest
}: Omit<ComponentProps<typeof Link>, "prefetch"> & { policy: LinkPolicy }) {
  const [asked, setAsked] = useState(false);
  return (
    <Link
      {...rest}
      prefetch={policy === "view" || (policy === "intent" && asked) ? null : false}
      onPointerEnter={(event) => {
        setAsked(true);
        onPointerEnter?.(event);
      }}
      onTouchStart={(event) => {
        setAsked(true);
        onTouchStart?.(event);
      }}
      onFocus={(event) => {
        setAsked(true);
        onFocus?.(event);
      }}
    />
  );
}
