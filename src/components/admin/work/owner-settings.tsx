import Link from "next/link";

import type { FormState } from "@/components/admin/action-form";
import { switchOffNote } from "@/lib/work-owner";
import { workBase } from "@/lib/work-paths";
import type { OwnerSettingsRow } from "@/server/work-owner";
import { PageHeader } from "@/components/admin/ui";

import { WorkSwitchForm } from "./owner-switch";
import { Badge, card } from "./work-parts";
import { workText } from "@/lib/work-text";
import { fillWords } from "@/lib/admin-fill";

/** A store's server action for the switch, already bound to its slug. */
export type SwitchActions = Record<string, (state: FormState, formData: FormData) => Promise<FormState>>;


function StoreCard({ row, action }: { row: OwnerSettingsRow; action: SwitchActions[string] | undefined }) {
  const tw = workText().ownerSettings;
  const { store } = row;
  const owner = store.role === "owner";
  const ready = row.problems;
  return (
    <li className={card}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-title text-ink">{store.name}</h2>
        <span className="flex items-center gap-2 text-xs text-muted">
          <Badge tone={store.workOn ? "good" : "neutral"}>{store.workOn ? tw.workOn : tw.workOff}</Badge>
          {!owner && tw.youAreAnAdmin}
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
              ? tw.onlyAnOwnerOf
              : store.workOn
                ? `${tw.onNote} ${switchOffNote({ issuedInvoices: row.issuedInvoices, runningTimers: row.runningTimers })}`
                : tw.offNote
          }
        />
      ) : null}
      {store.workOn && (
        <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-sm">
          {ready === null ? null : ready.length === 0 ? (
            <p className="text-muted">{tw.thisStoreCanIssue}</p>
          ) : (
            <>
              <p className="font-medium">{tw.beforeTheFirstInvoice}</p>
              <ul className="list-disc pl-5">
                {ready.map((problem) => (
                  <li key={problem.code}>{problem.message}</li>
                ))}
              </ul>
            </>
          )}
          <p>
            <Link href={`${workBase(store.slug)}/settings`} className="underline">
              {fillWords(tw.openStoreSettings, { store: store.name })}
            </Link>
            <span className="text-muted"> {tw.forVatBankAccount}</span>
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
  const tw = workText().ownerSettings;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={tw.workSettings}
        description={<>{tw.chooseWhichOfYour}</>}
      />
      {rows.length === 0 ? (
        <p className={`${card} text-sm text-muted`}>
          {tw.youDoNotWork}
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
  const tw = workText().ownerSettings;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title={<>{title}</>} />
      <section aria-labelledby="start-heading" className={`${card} flex flex-col gap-2`}>
        <h2 id="start-heading" className="text-title text-ink">
          {tw.workIsForThe}
        </h2>
        <p className="text-sm text-muted">
          {tw.keepYourClientsLog}
        </p>
        <p className="text-sm text-muted">
          {rows.length > 0
            ? tw.noneOfYourStores
            : tw.noneOfYourStores2}
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
