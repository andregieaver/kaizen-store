"use server";

import { refresh } from "next/cache";

import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePlatform, type Account } from "@/server/auth";
import {
  addPlatformEndpoint,
  ENDPOINTS_MAX,
  removePlatformEndpoint,
  renewPlatformSecret,
  resendPlatformDelivery,
  switchPlatformEndpoint,
  updatePlatformEndpoint,
} from "@/server/platform-endpoints";
import { sendPlatformEndpointTest } from "@/server/platform-integrations";
import type { SaveOutcome } from "@/server/webhook-endpoints";

/**
 * Kaizena Flow's own endpoints (C4, D515): they get the name and email of each person who asks for a store, so only a platform owner (the
 * settings area, D510) adds, changes, tests or removes one.
 */
const asOwner = (): Promise<Account> => requirePlatform("settings");

const wordsOf = (account: Account) => adminText(adminLangOf(account.adminLocale), "notifications").integrations.endpoints;

export type EndpointAnswer = { ok: true; secret?: string; message?: string } | { ok: false; message: string };

function said(account: Account, outcome: SaveOutcome): EndpointAnswer {
  if (outcome.ok) return { ok: true, secret: outcome.secret };
  return { ok: false, message: fillWords(wordsOf(account).problems[outcome.problem], { detail: outcome.detail ?? "", max: ENDPOINTS_MAX }) };
}

const inputOf = (form: FormData) => ({ name: String(form.get("name") ?? ""), url: String(form.get("url") ?? ""), topics: form.getAll("topics").map(String) });

export async function addPlatformEndpointAction(form: FormData): Promise<EndpointAnswer> {
  const owner = await asOwner();
  const answer = said(owner, await addPlatformEndpoint(owner, inputOf(form)));
  if (answer.ok) refresh();
  return answer;
}

export async function updatePlatformEndpointAction(id: string, form: FormData): Promise<EndpointAnswer> {
  const owner = await asOwner();
  const answer = said(owner, await updatePlatformEndpoint(owner, id, inputOf(form)));
  if (answer.ok) refresh();
  return answer;
}

export async function switchPlatformEndpointAction(id: string, on: boolean): Promise<EndpointAnswer> {
  const owner = await asOwner();
  if (!(await switchPlatformEndpoint(owner, id, on))) return { ok: false, message: wordsOf(owner).gone };
  refresh();
  return { ok: true };
}

export async function renewPlatformSecretAction(id: string): Promise<EndpointAnswer> {
  const owner = await asOwner();
  const renewed = await renewPlatformSecret(owner, id);
  return renewed.ok ? { ok: true, secret: renewed.secret } : { ok: false, message: wordsOf(owner).problems[renewed.problem] };
}

export async function removePlatformEndpointAction(id: string): Promise<EndpointAnswer> {
  const owner = await asOwner();
  if (!(await removePlatformEndpoint(owner, id))) return { ok: false, message: wordsOf(owner).gone };
  refresh();
  return { ok: true };
}

export async function testPlatformEndpointAction(id: string): Promise<EndpointAnswer> {
  const owner = await asOwner();
  const w = wordsOf(owner);
  const outcome = await sendPlatformEndpointTest(owner, id);
  refresh();
  if (!outcome) return { ok: false, message: w.gone };
  return outcome.ok
    ? { ok: true, message: fillWords(w.testSent, { status: outcome.status ?? "" }) }
    : { ok: false, message: fillWords(w.testFailed, { problem: outcome.error ?? String(outcome.status ?? "") }) };
}

export async function resendPlatformDeliveryAction(deliveryId: string): Promise<EndpointAnswer> {
  const owner = await asOwner();
  const w = wordsOf(owner);
  const outcome = await resendPlatformDelivery(owner, deliveryId);
  if (outcome === "queued") refresh();
  return outcome === "queued" ? { ok: true, message: w.resent } : { ok: false, message: outcome === "off" ? w.resendOff : outcome === "erased" ? w.resendErased : w.gone };
}
