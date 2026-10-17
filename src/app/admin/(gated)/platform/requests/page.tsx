import { storeBase, storeHref } from "@/lib/paths";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Fragment } from "react";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { suggestSlug } from "@/lib/slug";
import { designLookValue, type DesignCard } from "@/lib/design-presets";
import { requirePlatformAdmin } from "@/server/auth";
import { isSlugTaken, listAccessRequests, type AccessRequest } from "@/server/platform";
import { designChoices } from "@/server/design-presets";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { decideAction } from "../actions";

export const metadata: Metadata = { title: "Access requests" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** Platform admins approve beta requests here; approval creates the store. */
export default async function PlatformPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  // The themes offered, each look with the demo store it starts a store with (D273); the first card is Standard.
  const [requests, { cards }] = await Promise.all([listAccessRequests(), designChoices()]);
  const designs = cards.filter((card) => card.id);
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <>
      <PageHeader
        title="Access requests"
        description={<>Approving creates the store from the theme chosen (its look and its demo store, or the Standard store), makes the requester its owner, and emails them a sign-in link.</>}
      />

      <section aria-labelledby="pending-heading" className="flex flex-col gap-4">
        <h2 id="pending-heading" className="text-title text-ink">
          Waiting ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">No requests are waiting.</p>
        ) : (
          pending.map((request) => <PendingRequest key={request.id} request={request} designs={designs} />)
        )}
      </section>

      {decided.length > 0 && (
        <section aria-labelledby="decided-heading">
          <h2 id="decided-heading" className="mb-3 text-title text-ink">
            Recently decided
          </h2>
          <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
            {decided.map((request) => (
              <li key={request.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span>
                  {request.name} · {request.email} · {request.storeName}
                  {request.designTitle && <span className="text-muted"> · theme {request.designTitle}</span>}
                  {request.starterTitle && <span className="text-muted"> · demo store {request.starterTitle}</span>}
                </span>
                <span className="text-muted">
                  {request.status === "approved" && request.storeSlug ? (
                    <Link href={storeHref(request.storeSlug, storeBase(request.storeSlug))} className="underline">
                      approved: {request.storeSlug}
                    </Link>
                  ) : (
                    request.status
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

async function PendingRequest({ request, designs }: { request: AccessRequest; designs: DesignCard[] }) {
  // A theme the requester chose that is no longer offered (unpublished or archived, D177) gives way to the Standard store, and is said.
  const designGone = request.designPresetId && !designs.some((d) => d.id === request.designPresetId);
  // Suggest a free address; the admin can still change it.
  const base = suggestSlug(request.storeName) || suggestSlug(request.name);
  let slug = base;
  for (let n = 2; slug && n < 10 && (await isSlugTaken(slug)); n += 1) {
    slug = `${base.slice(0, 37)}-${n}`;
  }

  return (
    <article
      aria-labelledby={`request-${request.id}`}
      className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}
    >
      <div>
        <h3 id={`request-${request.id}`} className="text-body-strong text-ink">
          {request.storeName}
        </h3>
        <p className="text-sm">
          {request.name} · <a href={`mailto:${request.email}`} className="underline">{request.email}</a> ·{" "}
          <time dateTime={request.createdAt} className="text-muted">
            {request.createdAt.slice(0, 10)}
          </time>
          {request.hasAccount && <span className="text-muted"> · already has an account</span>}
        </p>
        {request.message && <p className="mt-2 whitespace-pre-line text-sm text-muted">{request.message}</p>}
      </div>
      <ActionForm
        action={decideAction.bind(null, request.id)}
        className="flex flex-col gap-3"
        replaceOnSuccess
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Store name
            <input name="storeName" required defaultValue={request.storeName} className={control} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Store address
            <span className="flex items-center gap-1 font-normal">
              <span className="text-muted">/s/</span>
              <input
                name="slug"
                required
                pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]"
                defaultValue={slug}
                autoCapitalize="none"
                spellCheck={false}
                className={`${control} w-full`}
              />
            </span>
          </label>
        </div>
        <label className="flex max-w-md flex-col gap-1 text-sm font-medium">
          Theme
          <select
            name="design"
            defaultValue={designGone || !request.designPresetId ? "" : designLookValue(request.designPresetId, request.designVariation)}
            className={control}
          >
            <option value="">Standard (the standard demo products)</option>
            {designs.map((design) => (
              <Fragment key={design.id}>
                <option value={design.id}>{lookOption(design.title, design.demo)}</option>
                {/* Its presets (`docs/theme-showcase-phase-1.md` step 4), each with the demo store it starts with (D273). */}
                {(design.looks ?? []).map((look) => (
                  <option key={look.key} value={designLookValue(design.id, look.key)}>
                    {lookOption(`${design.title} · ${look.name}`, look.demo)}
                  </option>
                ))}
              </Fragment>
            ))}
          </select>
          <span className="font-normal text-muted">
            {designGone
              ? `The requester chose ${request.designTitle ?? "a theme"}, which is no longer offered: the store gets the standard look and demo products unless you choose another.`
              : request.designPresetId
                ? "Chosen by the requester: the store starts with its look and its demo store."
                : "The requester chose none."}
          </span>
        </label>
        <div className="flex flex-wrap gap-3">
          <SubmitButton name="decision" value="approve">
            Approve and create store
          </SubmitButton>
          <SubmitButton name="decision" value="decline" variant="secondary" skipValidation>
            Decline
          </SubmitButton>
        </div>
      </ActionForm>
    </article>
  );
}

/** A look as the Theme field lists it: its name and the demo store it starts a store with (D273). */
const lookOption = (name: string, demo: string | null | undefined) => (demo ? `${name} (demo: ${demo})` : name);
