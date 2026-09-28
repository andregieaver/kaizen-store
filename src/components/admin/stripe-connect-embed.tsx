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

import type { AccountStage } from "@/lib/stripe-account";
import { showsDark } from "@/lib/color-mode";

/**
 * Server actions already bound to the account: a store's (the owner's) or a
 * host's own (D71).
 */
export type ConnectActions = {
  session: () => Promise<{ ok: true; clientSecret: string } | { ok: false; problem: string }>;
  refresh: () => Promise<void>;
};

/**
 * Stripe's own onboarding and account screens, embedded in the admin (Connect
 * embedded components). Rendered only in the browser: Stripe's script is
 * loaded when this appears, never on other admin pages.
 */
export default function StripeConnectEmbed({
  actions,
  publishableKey,
  stage,
}: {
  actions: ConnectActions;
  publishableKey: string;
  stage: AccountStage;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [managing, setManaging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [connect] = useState(() => {
    // The admin's colours: the account's choice, else the device's (D99).
    const dark = showsDark();
    return loadConnectAndInitialize({
      publishableKey,
      fetchClientSecret: async () => {
        const session = await actions.session();
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
      await actions.refresh();
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
