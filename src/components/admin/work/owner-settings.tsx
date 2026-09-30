import Link from "next/link";

import type { FormState } from "@/components/admin/action-form";
import { switchOffNote } from "@/lib/work-owner";
import { workBase } from "@/lib/work-paths";
import type { OwnerSettingsRow } from "@/server/work-owner";

import { WorkSwitchForm } from "./owner-switch";
import { Badge, card } from "./work-parts";

/** A store's server action for the switch, already bound to its slug. */
export type SwitchActions = Record<string, (state: FormState, formData: FormData) => Promise<FormState>>;

const ON_NOTE = "Work is on. It shows in the menu with clients, invoices, time and reports.";
const OFF_NOTE =
  "Adds clients, hours and invoices for this store to your Work. Each store is its own seller, with its own invoice numbers, VAT and bank details.";

function StoreCard({ row, action }: { row: OwnerSettingsRow; action: SwitchActions[string] | undefined }) {
  const { store } = row;
  const owner = store.role === "owner";
  const ready = row.problems;
  return (
    <li className={card}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{store.name}</h2>
        <span className="flex items-center gap-2 text-xs text-muted">
          <Badge tone={store.workOn ? "good" : "neutral"}>{store.workOn ? "Work on" : "Work off"}</Badge>
          {!owner && "You are an admin here"}
        </span>
      </div>
      {action ? (
        <WorkSwitchForm
          action={action}
          storeName={store.name}
          on={store.workOn}
          canChange={owner}
          note={
            !owner
              ? "Only an owner of the store can switch Work on or off."
              : store.workOn
                ? `${ON_NOTE} ${switchOffNote({ issuedInvoices: row.issuedInvoices, runningTimers: row.runningTimers })}`
                : OFF_NOTE
          }
        />
      ) : null}
      {store.workOn && (
        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-sm">
          {ready === null ? null : ready.length === 0 ? (
            <p className="text-muted">This store can issue invoices: its business details are complete.</p>
          ) : (
            <>
              <p className="font-medium">Before the first invoice</p>
              <ul className="list-disc pl-5">
                {ready.map((problem) => (
                  <li key={problem.code}>{problem.message}</li>
                ))}
              </ul>
            </>
          )}
          <p>
            <Link href={`${workBase(store.slug)}/settings`} className="underline">
              Open {store.name}&apos;s Work settings
            </Link>
            <span className="text-muted"> for VAT, bank account, defaults and invoice numbering.</span>
          </p>
        </div>
      )}
    </li>
  );
}

/**
 * Work's settings at the owner's level (D123): one card per store the account works in, with the switch "Use Work
 * in this store" (owners only) and a link to the store's own Work settings, where its seller details, VAT, bank
 * account and numbering are kept. What is missing before its first invoice is listed under each store using Work.
 */
export function OwnerSettingsView({ rows, actions }: { rows: OwnerSettingsRow[]; actions: SwitchActions }) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Work settings</h1>
        <p className="text-sm text-muted">
          Choose which of your stores use Work. Each store is the seller of its own invoices, so its business details,
          VAT, bank account, currency and numbering are set in that store&apos;s own Work settings.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className={`${card} text-sm text-muted`}>
          You do not work in any store yet. When you are added to a store, it is listed here.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((row) => (
            <StoreCard key={row.store.id} row={row} action={actions[row.store.slug]} />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What the combined pages show while no store the account works in uses Work (D123): a short explanation and the
 * switches, instead of empty tables. An account that owns no store to switch it on in is told who can.
 */
export function OwnerWorkStart({ rows, actions, title }: { rows: OwnerSettingsRow[]; actions: SwitchActions; title: string }) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <section aria-labelledby="start-heading" className={`${card} flex flex-col gap-2`}>
        <h2 id="start-heading" className="font-medium">
          Work is for the time you sell
        </h2>
        <p className="text-sm text-muted">
          Keep your clients, log the hours you work with a timer or by hand, and turn them into numbered invoices with
          VAT. If you run several stores or income streams, all of their Work is here in one place, and each store stays
          its own seller with its own invoice numbers and details.
        </p>
        <p className="text-sm text-muted">
          {rows.length > 0
            ? "None of your stores uses Work yet. Switch it on where you sell your time:"
            : "None of your stores uses Work yet, and only a store's owner can switch it on. Ask an owner of the store to do it."}
        </p>
      </section>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-4">
          {rows.map((row) => (
            <StoreCard key={row.store.id} row={row} action={actions[row.store.slug]} />
          ))}
        </ul>
      )}
    </div>
  );
}
