"use client";

import dynamic from "next/dynamic";

/** Stripe's embedded account screens, loaded in the browser only (see stripe-connect-embed). */
export const StripeConnect = dynamic(() => import("./stripe-connect-embed"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted">Loading Stripe …</p>,
});
