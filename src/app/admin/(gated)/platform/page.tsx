import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { suggestSlug } from "@/lib/slug";
import { requireAccount } from "@/server/auth";
import { isSlugTaken, listAccessRequests, type AccessRequest } from "@/server/platform";

import { decideAction } from "./actions";

export const metadata: Metadata = { title: "Access requests" };

const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

/** Platform admins approve beta requests here; approval creates the store. */
export default async function PlatformPage() {
  const account = await requireAccount();
  if (!account.platformAdmin) notFound();
  const requests = await listAccessRequests();
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Access requests</h1>
        <p className="text-sm text-muted">
          Approving creates the store as a copy of the demo template, makes the requester its
          owner, and emails them a sign-in link.
        </p>
      </div>

      <section aria-labelledby="pending-heading" className="flex flex-col gap-4">
        <h2 id="pending-heading" className="font-medium">
          Waiting ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">No requests are waiting.</p>
        ) : (
          pending.map((request) => <PendingRequest key={request.id} request={request} />)
        )}
      </section>

      {decided.length > 0 && (
        <section aria-labelledby="decided-heading">
          <h2 id="decided-heading" className="mb-3 font-medium">
            Recently decided
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
            {decided.map((request) => (
              <li key={request.id} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                <span>
                  {request.name} · {request.email} · {request.storeName}
                </span>
                <span className="text-muted">
                  {request.status === "approved" && request.storeSlug ? (
                    <Link href={`/s/${request.storeSlug}`} className="underline">
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
    </main>
  );
}

async function PendingRequest({ request }: { request: AccessRequest }) {
  // Suggest a free address; the admin can still change it.
  const base = suggestSlug(request.storeName) || suggestSlug(request.name);
  let slug = base;
  for (let n = 2; slug && n < 10 && (await isSlugTaken(slug)); n += 1) {
    slug = `${base.slice(0, 37)}-${n}`;
  }

  return (
    <article
      aria-labelledby={`request-${request.id}`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5"
    >
      <div>
        <h3 id={`request-${request.id}`} className="font-medium">
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
