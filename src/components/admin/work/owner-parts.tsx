"use client";

import Link from "next/link";
import { useState } from "react";

import { Modal } from "@/components/admin/modal";
import { newClientHref, newInvoiceHref } from "@/lib/work-owner";

import { control, primaryButton, secondaryButton } from "./work-parts";

/**
 * Small pieces of the combined Work view (D123) that need the browser: "New client" and "New invoice" on the
 * combined lists. They do not create anything themselves: they ask which store, then lead to that store's own
 * create flow (its clients page, its invoices page with the New invoice dialog open), so the rules stay in one
 * place. With one store they are plain links.
 */

export type StoreChoice = { slug: string; name: string };

const KINDS = {
  client: { label: "New client", title: "New client", href: newClientHref },
  invoice: { label: "New invoice", title: "New invoice", href: newInvoiceHref },
} as const;

/**
 * "New client" or "New invoice": one store is a link straight to its create flow; several ask which store first
 * (a dialog with a select that starts on `defaultSlug`: the store the list is narrowed to, else the last one
 * used) and then offer a link to that store's flow.
 */
export function NewInStoreButton({
  kind,
  stores,
  defaultSlug,
  primary = true,
}: {
  kind: keyof typeof KINDS;
  stores: StoreChoice[];
  defaultSlug: string;
  primary?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState(stores.some((s) => s.slug === defaultSlug) ? defaultSlug : (stores[0]?.slug ?? ""));
  const { label, title, href } = KINDS[kind];
  const className = primary ? primaryButton : secondaryButton;
  if (stores.length === 0) return null;
  if (stores.length === 1) {
    return (
      <Link href={href(stores[0].slug)} className={className}>
        {label}
      </Link>
    );
  }
  const chosen = stores.find((s) => s.slug === slug) ?? stores[0];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Each store keeps its own clients and invoices, with its own numbers and details. Which store is this for?
          </p>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Store
            <select value={chosen.slug} onChange={(event) => setSlug(event.target.value)} className={control}>
              {stores.map((store) => (
                <option key={store.slug} value={store.slug}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={secondaryButton}>
              Cancel
            </button>
            <Link href={href(chosen.slug)} className={primaryButton}>
              Continue in {chosen.name}
            </Link>
          </div>
        </div>
      </Modal>
    </>
  );
}
