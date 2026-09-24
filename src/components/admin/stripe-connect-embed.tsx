"use client";

import { loadConnectAndInitialize } from "@stripe/connect-js";
import {
  ConnectAccountManagement,
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
} from "@stripe/react-connect-js";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { accountSessionAction, refreshStripeAccountAction } from "@/app/admin/(gated)/actions";
import type { AccountStage, PaymentModeName } from "@/lib/stripe-account";

/**
 * Stripe's own onboarding and account screens, embedded in the admin (Connect
 * embedded components). Rendered only in the browser: Stripe's script is
 * loaded when this appears, never on other admin pages.
 */
export default function StripeConnectEmbed({
  storeSlug,
  mode,
  publishableKey,
  stage,
}: {
  storeSlug: string;
  mode: PaymentModeName;
  publishableKey: string;
  stage: AccountStage;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [managing, setManaging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [connect] = useState(() => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return loadConnectAndInitialize({
      publishableKey,
      fetchClientSecret: async () => {
        const session = await accountSessionAction(storeSlug, mode);
        if (!session.ok) {
          setProblem(session.problem);
          throw new Error(session.problem);
        }
        return session.clientSecret;
      },
      appearance: {
        variables: {
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          colorPrimary: dark ? "#ededed" : "#171717",
          colorBackground: dark ? "#0a0a0a" : "#ffffff",
          colorText: dark ? "#ededed" : "#171717",
          borderRadius: "6px",
        },
      },
    });
  });

  const refresh = () =>
    startRefresh(async () => {
      await refreshStripeAccountAction(storeSlug, mode);
      router.refresh();
    });

  return (
    <ConnectComponentsProvider connectInstance={connect}>
      <div className="flex flex-col gap-4">
        {problem && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {problem}
          </p>
        )}
        <ConnectNotificationBanner />
        {stage === "ready" ? (
          <>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setManaging((open) => !open)}
                aria-expanded={managing}
                className="min-h-10 rounded-md border border-border bg-background px-4 text-sm"
              >
                {managing ? "Hide account details" : "Business and bank details"}
              </button>
            </div>
            {managing && <ConnectAccountManagement />}
          </>
        ) : (
          <>
            <ConnectAccountOnboarding onExit={refresh} />
            <p className="text-sm text-muted" aria-live="polite">
              {refreshing
                ? "Checking your account with Stripe …"
                : "Stripe saves your answers as you go, so you can finish later."}
            </p>
          </>
        )}
      </div>
    </ConnectComponentsProvider>
  );
}
