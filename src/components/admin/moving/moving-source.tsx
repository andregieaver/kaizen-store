"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The platform the shop moves from (D446): the move's and the address's panels say their few platform words of it. */
const MovingSourceContext = createContext<"shopify" | "woocommerce">("shopify");

export function MovingSource({ source, children }: { source: "shopify" | "woocommerce"; children: ReactNode }) {
  return <MovingSourceContext.Provider value={source}>{children}</MovingSourceContext.Provider>;
}

export const useMovingSource = (): "shopify" | "woocommerce" => useContext(MovingSourceContext);

export { overWords } from "@/lib/over-words";
