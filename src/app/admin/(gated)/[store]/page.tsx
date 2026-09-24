import Link from "next/link";

import { requireMember } from "@/server/auth";
import { getPaymentSettings } from "@/server/settings";

export default async function AdminOverview({ params }: PageProps<"/admin/[store]">) {
  const { store } = await requireMember((await params).store);
  const payments = await getPaymentSettings(store);
  const mode = payments.stripe.activeMode;

  const steps = [
    {
      done: Boolean(payments.credentials.test.secretKeyHint && payments.credentials.test.publishableKey),
      label: "Stripe test keys are saved",
    },
    {
      done: store.markets.every((market) => (payments.methods[market.code]?.size ?? 0) > 0),
      label: "Every country has at least one payment method switched on",
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
              </span>
            </li>
          ))}
        </ol>
        <Link href={`/admin/${store.slug}/settings/payments`} className="mt-4 inline-block text-sm underline">
          Go to payment settings
        </Link>
      </section>
    </div>
  );
}
