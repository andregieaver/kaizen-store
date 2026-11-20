"use client";

import dynamic from "next/dynamic";

import { lazyView } from "./lazy-view";

/**
 * The shopper's wishlists, loaded only where they are drawn (D211, `lazyView()`): one module per group of the shop's stand-ins, so a
 * route carries only the stand-ins it draws (bloat review step 2.9, commit 3).
 */
export const WishlistView = lazyView(dynamic(() => import("../wishlist-view").then((m) => m.WishlistView)));
