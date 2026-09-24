"use server";

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { siteUrl } from "@/lib/site";
import { requireAccount, type Account } from "@/server/auth";
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
