"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { siteUrl } from "@/lib/site";
import { requireAccount, type Account } from "@/server/auth";
import { connectPlatformWebhooks, setSaleFeeBps } from "@/server/connect";
import { approveAccessRequest, declineAccessRequest } from "@/server/platform";

async function requirePlatformAdmin(): Promise<Account> {
  const account = await requireAccount();
  if (!account.platformAdmin) notFound();
  return account;
}

async function origin(): Promise<string> {
  const header = (await headers()).get("origin");
  return header ? new URL(header).origin : siteUrl();
}

/**
 * Approves or declines a request, depending on which button was pressed.
 * The page is not refreshed, so the outcome stays where the request was
 * until the admin reloads.
 */
export async function decideAction(
  requestId: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const id = z.uuid().safeParse(requestId);
  if (!id.success) return { status: "error", messages: ["Unknown request."] };

  if (formData.get("decision") === "decline") {
    await declineAccessRequest(admin, id.data);
    return { status: "ok", messages: ["Declined. The request is in the list of decisions."] };
  }

  const site = await origin();
  const result = await approveAccessRequest(
    admin,
    id.data,
    String(formData.get("slug") ?? "").trim().toLowerCase(),
    String(formData.get("storeName") ?? ""),
    site,
  );
  if (!result.ok) return { status: "error", messages: result.problems };
  return {
    status: "ok",
    messages: [
      result.invited
        ? `Store created at /s/${result.slug}. A sign-in link is on its way to ${result.email}.`
        : `Store created at /s/${result.slug}, but the sign-in email could not be sent. Ask ${result.email} to sign in at ${site}/admin/sign-in.`,
    ],
  };
}

/** Creates Kaizen's Connect webhooks in its Stripe account for a mode. */
export async function connectWebhooksAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const mode = z.enum(["test", "live"]).safeParse(formData.get("mode"));
  if (!mode.success) return { status: "error", messages: ["Unknown mode."] };
  const result = await connectPlatformWebhooks(admin, mode.data, await origin());
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [`Stripe sends ${mode.data} events to Kaizen now.`] };
}

/** Kaizen's fee on each storefront sale, entered as a percentage. */
export async function saveSaleFeeAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const text = String(formData.get("percent") ?? "").trim().replace(",", ".");
  const percent = Number(text);
  if (!text || !Number.isFinite(percent)) return { status: "error", messages: ["Enter a percentage, e.g. 1.5."] };
  const result = await setSaleFeeBps(admin, Math.round(percent * 100));
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: ["Fee saved. It applies to checkouts from now on."] };
}
