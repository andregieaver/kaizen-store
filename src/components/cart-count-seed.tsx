"use client";

import { useEffect } from "react";

import { setCart } from "./shopper-own";

/** Puts the cart's count in the header from a page that draws the cart per request anyway (the cart, the wishlist), so no call is needed. */
export function CartCountSeed({ count }: { count: number }) {
  useEffect(() => setCart(count), [count]);
  return null;
}
