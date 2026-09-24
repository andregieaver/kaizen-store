import Link from "next/link";
import { redirect } from "next/navigation";

import { storeBase } from "@/lib/paths";
import { requireMember } from "@/server/auth";
import { getSetupProgress } from "@/server/setup";

type Props = PageProps<"/admin/[store]">;

export default async function AdminOverview({ params }: Props) {
  const { store, role } = await requireMember((await params).store);
  // A new owner's first stop is the setup wizard.
  if (!store.setupCompletedAt && role === "owner") redirect(`/admin/${store.slug}/setup`);

  const progress = await getSetupProgress(store);
  const steps = [
    { done: progress.details, label: "Business details", step: "details" },
    { done: progress.countries, label: "Countries you sell to", step: "countries" },
    { done: progress.payments, label: "Stripe keys saved", step: "payments" },
    {
      done: progress.products,
      label: progress.counts.demoProducts > 0 ? "Replace the demo products" : "Products",
      step: "products",
    },
  ];
  const remaining = steps.filter((s) => !s.done).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <Link href={storeBase(store.slug)} className="text-sm underline">
          View your store
        </Link>
      </div>
      {!store.setupCompletedAt && (
        <p role="status" className="rounded-lg border border-border bg-background p-4 text-sm">
          This store is not open yet. An owner can finish the setup.
        </p>
      )}
      {remaining > 0 && (
        <section aria-labelledby="checklist-heading" className="rounded-lg border border-border bg-background p-5">
          <h2 id="checklist-heading" className="mb-3 font-medium">
            Finish setting up ({steps.length - remaining} of {steps.length} done)
          </h2>
          <ol className="flex flex-col gap-2 text-sm">
            {steps.map((step) => (
              <li key={step.step} className="flex items-baseline gap-2">
                <span aria-hidden="true">{step.done ? "✓" : "○"}</span>
                <span className="flex-1">
                  <span className="sr-only">{step.done ? "Done: " : "To do: "}</span>
                  {step.label}
                </span>
                {!step.done && role === "owner" && (
                  <Link href={`/admin/${store.slug}/setup/${step.step}`} className="underline">
                    Do it now
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
