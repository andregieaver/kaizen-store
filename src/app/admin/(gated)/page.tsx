import Link from "next/link";

import { MARKET_SLUGS, MARKETS } from "@/lib/markets";
import { getStaff } from "@/server/auth";
import { getPaymentSettings } from "@/server/settings";

export default async function AdminOverview() {
  const staff = await getStaff();
  if (!staff) return null;
  const payments = await getPaymentSettings();
  const mode = payments.stripe.activeMode;

  const steps = [
    {
      done: payments.encryptionKeyConfigured,
      label: "The server has an encryption key for payment secrets",
      help: "Set SETTINGS_ENCRYPTION_KEY in Vercel (see the Payments page).",
    },
    {
      done: Boolean(payments.credentials.test.secretKeyHint && payments.credentials.test.publishableKey),
      label: "Stripe test keys are saved",
    },
    {
      done: MARKET_SLUGS.every((slug) => payments.methods[MARKETS[slug].code].size > 0),
      label: "Every market has at least one payment method switched on",
    },
    {
      done: payments.stripe.enabled,
      label: `Stripe is enabled (${mode} mode)`,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <section aria-labelledby="setup-heading" className="rounded-lg border border-border bg-background p-5">
        <h2 id="setup-heading" className="mb-3 font-medium">
          Payment setup
        </h2>
        <ol className="flex flex-col gap-2 text-sm">
          {steps.map((step) => (
            <li key={step.label} className="flex gap-2">
              <span aria-hidden="true">{step.done ? "✓" : "○"}</span>
              <span>
                <span className="sr-only">{step.done ? "Done: " : "To do: "}</span>
                {step.label}
                {!step.done && step.help && <span className="block text-muted">{step.help}</span>}
              </span>
            </li>
          ))}
        </ol>
        <Link href="/admin/settings/payments" className="mt-4 inline-block text-sm underline">
          Go to payment settings
        </Link>
      </section>
    </div>
  );
}
