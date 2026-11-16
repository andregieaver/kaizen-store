"use client";

import { useState, type DetailsHTMLAttributes } from "react";

/**
 * A `<details>` that starts open when `startOpen` is true and then stays as the person leaves it (round 10, D633): a server render after
 * an action inside it (calling off a change of business) does not close it under them.
 */
export function FoldOpenOnce({ startOpen, ...rest }: { startOpen: boolean } & Omit<DetailsHTMLAttributes<HTMLDetailsElement>, "open">) {
  const [open] = useState(startOpen);
  return <details open={open} {...rest} />;
}
