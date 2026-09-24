"use server";

import { refresh, updateTag } from "next/cache";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { PLAN_INTERVALS, percentToBps } from "@/lib/plans";
import { parsePrice } from "@/lib/product-input";
import { seoFromForm } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { requireAccount, type Account } from "@/server/auth";
import {
  assignPlan,
  cancelPlan,
  planCurrencies,
  savePlan,
  setStoreFee,
  syncPlans,
  type PlanInput,
} from "@/server/billing";
import { connectPlatformWebhooks, setCheckoutUi, setSaleFeeBps } from "@/server/connect";
import { uploadProductImage, type UploadResult } from "@/server/media";
import { approveAccessRequest, declineAccessRequest } from "@/server/platform";
import { PLATFORM_SEO_TAG, savePlatformSeo } from "@/server/seo";
import { platformModes } from "@/server/stripe";

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
  const bps = percentToBps(String(formData.get("percent") ?? ""));
  if (bps === null) return { status: "error", messages: ["Enter a percentage between 0 and 20, e.g. 1.5."] };
  const result = await setSaleFeeBps(admin, bps);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: ["Fee saved. It applies to checkouts from now on."] };
}

/** Kaizen's own checkout page, or Stripe's page as a fallback (D22). */
export async function saveCheckoutUiAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const ui = formData.get("ui");
  if (ui !== "custom" && ui !== "hosted") return { status: "error", messages: ["Choose where shoppers pay."] };
  await setCheckoutUi(admin, ui);
  refresh();
  return { status: "ok", messages: [] };
}

// ---------------------------------------------------------------------------
// Plans and stores' subscriptions (decision D18)
// ---------------------------------------------------------------------------

/** Creates a plan (planId null) or updates one, then copies it to Stripe. */
export async function savePlanAction(
  planId: string | null,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (planId !== null && !z.uuid().safeParse(planId).success) {
    return { status: "error", messages: ["Unknown plan."] };
  }
  const problems: string[] = [];
  const name = String(formData.get("name") ?? "").trim();
  if (!name) problems.push("Give the plan a name.");
  const fee = percentToBps(String(formData.get("fee") ?? ""));
  if (fee === null) problems.push("Enter the fee per sale as a percentage between 0 and 20, e.g. 1.5.");
  const position = Number.parseInt(String(formData.get("position") ?? "0"), 10);

  const prices: PlanInput["prices"] = [];
  for (const currency of await planCurrencies()) {
    for (const interval of PLAN_INTERVALS) {
      const text = String(formData.get(`price:${currency}:${interval}`) ?? "").trim();
      if (!text) continue;
      const amount = parsePrice(text, currency);
      if (amount === null) problems.push(`"${text}" is not an amount in ${currency}.`);
      else prices.push({ currency, interval, amountMinor: amount });
    }
  }
  if (prices.length === 0) problems.push("Give the plan at least one price.");
  if (problems.length > 0) return { status: "error", messages: problems };

  const result = await savePlan(admin, planId, {
    name,
    description: String(formData.get("description") ?? "").trim(),
    saleFeeBps: fee as number,
    position: Number.isFinite(position) ? position : 0,
    active: formData.get("active") === "on",
    prices,
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [result.note ?? (planId ? "Plan saved and updated in Stripe." : "Plan created in Kaizen and Stripe.")] };
}

/** Copies every plan to Stripe again, e.g. after a failure or new keys. */
export async function syncPlansAction(): Promise<FormState> {
  await requirePlatformAdmin();
  const problems: string[] = [];
  const modes = platformModes();
  if (modes.length === 0) return { status: "error", messages: ["Kaizen's Stripe keys are not set."] };
  for (const mode of modes) {
    const result = await syncPlans(mode);
    if (!result.ok) problems.push(...result.problems.map((p) => `${mode}: ${p}`));
  }
  refresh();
  return problems.length > 0
    ? { status: "error", messages: problems }
    : { status: "ok", messages: ["Plans are up to date in Stripe."] };
}

/** Starts or changes a store's plan. */
export async function assignPlanAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const priceId = z.uuid().safeParse(formData.get("priceId"));
  if (!priceId.success) return { status: "error", messages: ["Choose a plan and price."] };
  const trial = Number.parseInt(String(formData.get("trialDays") ?? "0") || "0", 10);
  if (!Number.isInteger(trial) || trial < 0 || trial > 730) {
    return { status: "error", messages: ["A free trial is between 0 and 730 days."] };
  }
  const result = await assignPlan(admin, storeSlug, priceId.data, trial, await origin());
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: ["Plan saved. Stripe emails the store its invoices."] };
}

/** Cancels a store's plan at the end of its period, at once, or undoes a cancellation. */
export async function cancelPlanAction(storeId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const when = z.enum(["period_end", "now", "undo"]).safeParse(formData.get("when"));
  if (!when.success || !z.uuid().safeParse(storeId).success) return { status: "error", messages: ["Unknown request."] };
  const result = await cancelPlan(admin, storeId, when.data);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return {
    status: "ok",
    messages: [
      when.data === "undo"
        ? "The plan continues."
        : when.data === "now"
          ? "Plan cancelled."
          : "The plan ends when the current period does.",
    ],
  };
}

/** Sets a store's own fee per sale; empty returns it to its plan's fee. */
export async function setStoreFeeAction(storeId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (!z.uuid().safeParse(storeId).success) return { status: "error", messages: ["Unknown store."] };
  const text = String(formData.get("fee") ?? "").trim();
  const bps = text === "" ? null : percentToBps(text);
  if (text !== "" && bps === null) {
    return { status: "error", messages: ["Enter a percentage between 0 and 20, or leave it empty."] };
  }
  const result = await setStoreFee(admin, storeId, bps);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [bps === null ? "The store pays its plan's fee." : "Fee saved."] };
}

// ---------------------------------------------------------------------------
// Kaizen's own search and sharing (decision D21)
// ---------------------------------------------------------------------------

export async function savePlatformSeoAction(_state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await savePlatformSeo(admin, seoFromForm(formData, ["en"]));
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(PLATFORM_SEO_TAG);
  refresh();
  return { status: "ok", messages: ["Search and sharing saved."] };
}

export async function uploadPlatformImageAction(formData: FormData): Promise<UploadResult> {
  await requirePlatformAdmin();
  const image = formData.get("image");
  const thumbnail = formData.get("thumbnail");
  if (!(image instanceof File) || !(thumbnail instanceof File)) {
    return { ok: false, problem: "Choose a picture to upload." };
  }
  return uploadProductImage("platform", image, thumbnail);
}
