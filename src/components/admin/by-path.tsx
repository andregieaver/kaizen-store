"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * One of two things by the page's address: a level's layout stays mounted across its pages, so a page that is drawn in another layout
 * (the `focus` layout for the setup wizard, docs/admin-style.md 6.3) is told apart by its address, as `AdminMain`'s `fullWidth` is.
 * `pattern` is a regular expression's source, as a function cannot cross from the server.
 */
export function ByPath({ pattern, match, otherwise }: { pattern: string; match: ReactNode; otherwise: ReactNode }) {
  return <>{new RegExp(pattern).test(usePathname()) ? match : otherwise}</>;
}
