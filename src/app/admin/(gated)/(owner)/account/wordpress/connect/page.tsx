import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { primaryButton, secondaryButton } from "@/components/admin/work/work-parts";
import { readApproval } from "@/lib/wordpress";
import { getAccount } from "@/server/auth";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { storesOf } from "@/server/wordpress";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { answerApprovalAction } from "../actions";

export const metadata: Metadata = { title: "Connect a WordPress site", robots: { index: false } };

/**
 * Where the plugin sends the owner to approve a site (D169). It names the site (the address the return goes to) and what it may read, and
 * asks. Someone who is not signed in is sent to sign in and back; the request is read with the same rules again when answered.
 */
export default async function ConnectWordpressPage({ searchParams }: PageProps<"/admin/account/wordpress/connect">) {
  await connection();
  const query = await searchParams;
  const account = await getAccount();
  if (!account) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (typeof value === "string") params.set(key, value);
    redirect(`/admin/sign-in?next=${encodeURIComponent(`/admin/account/wordpress/connect?${params}`)}`);
  }
  const w = adminText(adminLangOf(account.adminLocale), "bookings").wordpress;
  const read = readApproval(query);
  if (!read.ok) {
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <PageHeader title={w.connectTitle} />
        <p role="alert" className="rounded-lg border border-danger-text p-4 text-sm">
          {fillWords(w.unusable, { reason: read.reason })}
        </p>
      </div>
    );
  }
  const { request } = read;
  const stores = await storesOf(account.id);
  const host = new URL(request.site).host;
  return (
    <div className="flex max-w-xl flex-col gap-5">
      <PageHeader
        title={fillWords(w.connectHost, { host })}
        description={<>{w.asksBefore} <strong className="text-ink">{request.name}</strong> {fillWords(w.asksAfter, { site: request.site })}</>}
      />
      <section aria-labelledby="reads-heading" className={`flex flex-col gap-2 p-4 text-sm ${CARD_CLASS}`}>
        <h2 id="reads-heading" className="text-title text-ink">
          {w.reads}
        </h2>
        <ul className="list-disc pl-5 text-muted">
          <li>
            {w.readsProducts}
            {stores.length > 0 ? `: ${stores.map((store) => store.name).join(", ")}` : ""}.
          </li>
          <li>{w.readsStores}</li>
        </ul>
        <h2 className="mt-2 text-title text-ink">{w.else}</h2>
        <ul className="list-disc pl-5 text-muted">
          <li>{w.cart}</li>
        </ul>
        <h2 className="mt-2 text-title text-ink">{w.cannot}</h2>
        <ul className="list-disc pl-5 text-muted">
          <li>{w.private}</li>
        </ul>
        <p className="mt-2 text-muted">{w.anyTime}</p>
      </section>
      <form action={answerApprovalAction} className="flex flex-wrap gap-3">
        <input type="hidden" name="site" value={request.site} />
        <input type="hidden" name="name" value={request.name} />
        <input type="hidden" name="return" value={request.returnTo.toString()} />
        <input type="hidden" name="state" value={request.state} />
        <input type="hidden" name="challenge" value={request.challenge} />
        <button type="submit" name="answer" value="approve" className={primaryButton}>
          {w.approve}
        </button>
        <button type="submit" name="answer" value="deny" className={secondaryButton}>
          {w.cancel}
        </button>
      </form>
    </div>
  );
}
