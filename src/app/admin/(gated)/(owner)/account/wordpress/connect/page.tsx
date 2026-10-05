import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";

import { primaryButton, secondaryButton } from "@/components/admin/work/work-parts";
import { readApproval } from "@/lib/wordpress";
import { getAccount } from "@/server/auth";
import { storesOf } from "@/server/wordpress";

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
  const read = readApproval(query);
  if (!read.ok) {
    return (
      <div className="flex max-w-xl flex-col gap-3">
        <h1 className="text-2xl font-semibold">Connect a WordPress site</h1>
        <p role="alert" className="rounded-lg border border-red-600 p-4 text-sm">
          This request cannot be used: {read.reason} Start again from the plugin&apos;s settings in WordPress.
        </p>
      </div>
    );
  }
  const { request } = read;
  const stores = await storesOf(account.id);
  const host = new URL(request.site).host;
  return (
    <div className="flex max-w-xl flex-col gap-5">
      <h1 className="text-2xl font-semibold">Connect {host} to your stores?</h1>
      <p className="text-sm text-muted">
        The Kaizen plugin on <strong className="text-foreground">{request.name}</strong> ({request.site}) asks to read the products of your stores, so
        it can show them on its pages. Only approve a site you run.
      </p>
      <section aria-labelledby="reads-heading" className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4 text-sm">
        <h2 id="reads-heading" className="font-medium">
          What it can read
        </h2>
        <ul className="list-disc pl-5 text-muted">
          <li>
            The products, prices, pictures, categories and tags your stores show shoppers
            {stores.length > 0 ? `: ${stores.map((store) => store.name).join(", ")}` : ""}.
          </li>
          <li>The stores you belong to when it asks, so a store you leave is no longer shown.</li>
        </ul>
        <h2 className="mt-2 font-medium">What it cannot do</h2>
        <ul className="list-disc pl-5 text-muted">
          <li>Read orders, customers, settings or anything private, or change anything in a store.</li>
        </ul>
        <p className="mt-2 text-muted">You can disconnect it at any time under Account, WordPress.</p>
      </section>
      <form action={answerApprovalAction} className="flex flex-wrap gap-3">
        <input type="hidden" name="site" value={request.site} />
        <input type="hidden" name="name" value={request.name} />
        <input type="hidden" name="return" value={request.returnTo.toString()} />
        <input type="hidden" name="state" value={request.state} />
        <input type="hidden" name="challenge" value={request.challenge} />
        <button type="submit" name="answer" value="approve" className={primaryButton}>
          Approve and connect
        </button>
        <button type="submit" name="answer" value="deny" className={secondaryButton}>
          Cancel
        </button>
      </form>
    </div>
  );
}
