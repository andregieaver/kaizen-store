"use client";

import dynamic from "next/dynamic";

import { useAdminText } from "./admin-text";

/** Stripe's embedded account screens, loaded in the browser only (see stripe-connect-embed). */
export const StripeConnect = dynamic(() => import("./stripe-connect-embed"), {
  ssr: false,
  loading: () => <Loading />,
});

function Loading() {
  return <p className="text-sm text-muted">{useAdminText("payments").stripe.loading}</p>;
}
