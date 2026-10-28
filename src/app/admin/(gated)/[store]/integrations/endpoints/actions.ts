"use server";

import { refresh } from "next/cache";

import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import type { Membership } from "@/server/auth";
import { sendEndpointTest } from "@/server/integrations";
import { checkOwnerRole } from "@/server/permissions";
import {
  addEndpoint,
  ENDPOINTS_MAX,
  removeEndpoint,
  renewSecret,
  resendDelivery,
  switchEndpoint,
  updateEndpoint,
  type SaveOutcome,
} from "@/server/webhook-endpoints";

/** An owner's endpoints get customers' details, so only an owner adds or changes them (D354), as with the services (D41). */
async function asOwner(storeSlug: string): Promise<Membership | string> {
  return (await checkOwnerRole(storeSlug)) ?? adminText(await actionAdminLang(), "notifications").integrations.endpoints.ownerOnly;
}

const wordsOf = (member: Membership) => adminText(adminLangOf(member.account.adminLocale), "notifications").integrations.endpoints;

export type EndpointAnswer = { ok: true; secret?: string; message?: string } | { ok: false; message: string };

function said(member: Membership, outcome: SaveOutcome): EndpointAnswer {
  if (outcome.ok) return { ok: true, secret: outcome.secret };
  const w = wordsOf(member);
  return { ok: false, message: fillWords(w.problems[outcome.problem], { detail: outcome.detail ?? "", max: ENDPOINTS_MAX }) };
}

const inputOf = (form: FormData) => ({
  name: String(form.get("name") ?? ""),
  url: String(form.get("url") ?? ""),
  topics: form.getAll("topics").map(String),
});

export async function addEndpointAction(storeSlug: string, form: FormData): Promise<EndpointAnswer> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, message: owner };
  const answer = said(owner, await addEndpoint(owner, inputOf(form)));
  if (answer.ok) refresh();
  return answer;
}

export async function updateEndpointAction(storeSlug: string, id: string, form: FormData): Promise<EndpointAnswer> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, message: owner };
  const answer = said(owner, await updateEndpoint(owner, id, inputOf(form)));
  if (answer.ok) refresh();
  return answer;
}

export async function switchEndpointAction(storeSlug: string, id: string, on: boolean): Promise<EndpointAnswer> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, message: owner };
  if (!(await switchEndpoint(owner, id, on))) return { ok: false, message: wordsOf(owner).gone };
  refresh();
  return { ok: true };
}

export async function renewSecretAction(storeSlug: string, id: string): Promise<EndpointAnswer> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, message: owner };
  const renewed = await renewSecret(owner, id);
  return renewed.ok ? { ok: true, secret: renewed.secret } : { ok: false, message: wordsOf(owner).problems[renewed.problem] };
}

export async function removeEndpointAction(storeSlug: string, id: string): Promise<EndpointAnswer> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, message: owner };
  if (!(await removeEndpoint(owner, id))) return { ok: false, message: wordsOf(owner).gone };
  refresh();
  return { ok: true };
}

export async function testEndpointAction(storeSlug: string, id: string): Promise<EndpointAnswer> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, message: owner };
  const w = wordsOf(owner);
  const outcome = await sendEndpointTest(owner, id);
  refresh();
  if (!outcome) return { ok: false, message: w.gone };
  return outcome.ok
    ? { ok: true, message: fillWords(w.testSent, { status: outcome.status ?? "" }) }
    : { ok: false, message: fillWords(w.testFailed, { problem: outcome.error ?? String(outcome.status ?? "") }) };
}

export async function resendDeliveryAction(storeSlug: string, deliveryId: string): Promise<EndpointAnswer> {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false, message: owner };
  const w = wordsOf(owner);
  const outcome = await resendDelivery(owner, deliveryId);
  if (outcome === "queued") refresh();
  return outcome === "queued" ? { ok: true, message: w.resent } : { ok: false, message: outcome === "off" ? w.resendOff : w.gone };
}
