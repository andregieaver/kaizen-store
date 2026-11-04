"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The platform the shop moves from (D446): the move's and the address's panels say their few platform words of it. */
const MovingSourceContext = createContext<"shopify" | "woocommerce">("shopify");

export function MovingSource({ source, children }: { source: "shopify" | "woocommerce"; children: ReactNode }) {
  return <MovingSourceContext.Provider value={source}>{children}</MovingSourceContext.Provider>;
}

export const useMovingSource = (): "shopify" | "woocommerce" => useContext(MovingSourceContext);

/** Words with a platform's own over them, key by key, into nested groups; a word the platform does not have stays the shared one. */
export function overWords<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object" || !base || typeof base !== "object") return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(over as Record<string, unknown>)) {
    out[key] = value && typeof value === "object" && !Array.isArray(value) && typeof out[key] === "object" ? overWords(out[key], value) : value;
  }
  return out as T;
}
