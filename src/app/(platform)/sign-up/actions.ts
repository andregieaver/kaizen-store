"use server";

import { cookies, headers } from "next/headers";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { formProblems } from "@/lib/form-problems";
import { REFERRAL_COOKIE, referralCodeFor } from "@/lib/referrals";
import { designLookChoice } from "@/lib/design-presets";
import { contentForLook } from "@/server/design-presets";
import { consentCookieName } from "@/lib/cookie-consent";
import { touchCookieName } from "@/lib/first-touch";
import { signupAdSignals } from "@/lib/platform-ad-conversions";
import { houseStoreId } from "@/server/house-customers";
import { createAccessRequest, type AccessRequestInput } from "@/server/platform";
import { getPublicExtensions } from "@/server/public-extensions";
import { isExtensionId, STANDALONE_SIGNUP_OPEN, type ExtensionId } from "@/lib/extensions";
import { signupFirstTouch } from "@/server/platform-channels";
import { addressOf } from "@/server/analytics-visits";
import { recordSignup } from "@/server/experiments";
import { confirmSelfSignup, selfServeOn, startSelfSignup } from "@/server/self-signup";
import { langOfLocale, type PlatformLang } from "@/lib/platform-lang";
import { platformText, type PlatformMessages } from "@/lib/platform-text";
import { signUpWorkspaceText } from "@/lib/messages/sign-up-workspace";

/** The form's checks, in the words of the language it was sent in (D312). */
function inputIn(errors: PlatformMessages["signUp"]["errors"]) {
  return z.object({
    name: z.string().trim().min(1, errors.name).max(100),
    email: z.email(errors.email),
    storeName: z.string().trim().min(1, errors.storeName).max(80),
    message: z.string().trim().max(1000, errors.message),
  });
}

/** The language the form was sent in: its `locale` field, English for anything else. */
function langOfForm(formData: FormData): PlatformLang {
  return langOfLocale(String(formData.get("locale") ?? "")) ?? "en";
}

/**
 * Records a request to join the beta. The answer is the same whether or not
 * this email has asked before, so the form reveals nothing about who has.
 */
export async function requestAccess(_state: FormState, formData: FormData): Promise<FormState> {
  const lang = langOfForm(formData);
  const w = platformText(lang).signUp;
  // A field people never see; bots fill it in.
  if (String(formData.get("website") ?? "") !== "") return { status: "ok", messages: [w.received] };

  const parsed = inputIn(w.errors).safeParse({
    name: formData.get("name") ?? "",
    email: String(formData.get("email") ?? "").trim(),
    storeName: formData.get("storeName") ?? "",
    message: formData.get("message") ?? "",
  });
  if (!parsed.success) return formProblems(parsed.error.issues);
  const context = await signupContext(formData);
  try {
    // The theme and its preset (`docs/theme-showcase-phase-1.md` step 4) chosen, kept only when published (checked inside), and the demo
    // store the look starts a store with (D273): never chosen apart.
    const look = designLookChoice(formData.get("design"));
    const input = {
      ...parsed.data,
      referralCode: context.referralCode,
      starterId: await contentForLook(look),
      designPresetId: look?.id ?? null,
      designVariation: look?.variation ?? null,
      lang,
      dream: formData.get("dream") === "on",
      // The form is sent under the sentence that links the terms and the privacy notice (PSI REG-02).
      termsAccepted: true,
      firstTouch: context.firstTouch,
      adSignals: context.adSignals,
    };
    const selfServe = await sendRequest(input, context.house);
    return { status: "ok", messages: [selfServe ? w.selfServe.received : w.received] };
  } catch {
    return { status: "error", messages: [w.failed] };
  }
}

/**
 * What every sign-up carries besides its fields: a referral (D131: the code the link put in the form, else the cookie, which only exists
 * when the visitor allowed it; an unknown or blocked code is dropped inside), where the person first came from (C2, D522: the house store's
 * first-touch cookie, only with statistics cookies allowed) and the ad platforms' ids (C2, D523: only with marketing cookies allowed).
 */
async function signupContext(formData: FormData) {
  const referralCode = referralCodeFor(String(formData.get("ref") ?? ""), (await cookies()).get(REFERRAL_COOKIE)?.value);
  const house = await houseStoreId();
  const jar = await cookies();
  const firstTouch = house ? signupFirstTouch(jar.get(touchCookieName(house))?.value) : null;
  const adSignals = house ? signupAdSignals((name) => jar.get(name)?.value, jar.get(consentCookieName(house))?.value) : null;
  return { referralCode, house, firstTouch, adSignals };
}

/**
 * Sends a request: self-serve (D359) emails a link to confirm the address first and makes the account on the press; else the request waits
 * for a platform admin. A sign-up counts as an A/B test's goal on Kaizena Flow's own store (D148 phase 19). Answers whether it was self-serve.
 */
async function sendRequest(input: AccessRequestInput, house: string | null): Promise<boolean> {
  const selfServe = await selfServeOn();
  if (selfServe) await startSelfSignup(input, addressOf(await headers()) || null);
  else await createAccessRequest(input);
  if (house) await recordSignup(house);
  return selfServe;
}

/**
 * The sign-up for extensions (D748 E7): the extensions ticked (those sold on their own, or any with an online store ticked too), the
 * business's name and country, and the person. Without a store it is approved into a workspace in that country; the trials of what was
 * ticked start when the account is made.
 */
export async function requestExtensions(_state: FormState, formData: FormData): Promise<FormState> {
  const lang = langOfForm(formData);
  const w = platformText(lang).signUp;
  const x = w.extensions;
  if (!STANDALONE_SIGNUP_OPEN) return { status: "error", messages: [w.failed] };
  if (String(formData.get("website") ?? "") !== "") return { status: "ok", messages: [x.received] };
  const wantsStore = formData.get("store") === "on";
  const offered = (await getPublicExtensions()).extensions.filter((e) => wantsStore || e.standalone).map((e) => e.id);
  const extensions = [...new Set(formData.getAll("extension").map(String))].filter((id): id is ExtensionId => isExtensionId(id) && offered.includes(id));
  const country = String(formData.get("country") ?? "").trim().toUpperCase();
  const parsed = inputIn(w.errors)
    .pick({ name: true, email: true, storeName: true })
    .safeParse({ name: formData.get("name") ?? "", email: String(formData.get("email") ?? "").trim(), storeName: formData.get("storeName") ?? "" });
  const problems = [
    ...(extensions.length === 0 ? [x.pickOne] : []),
    ...(!/^[A-Z]{2}$/.test(country) ? [x.countryMissing] : []),
    ...(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)),
  ];
  if (!parsed.success || problems.length > 0) return { status: "error", messages: [...new Set(problems)] };
  const context = await signupContext(formData);
  try {
    const selfServe = await sendRequest(
      { ...parsed.data, message: "", referralCode: context.referralCode, lang, termsAccepted: true, firstTouch: context.firstTouch, adSignals: context.adSignals, wantsStore, extensions, country },
      context.house,
    );
    return { status: "ok", messages: [selfServe ? x.receivedSelfServe : x.received] };
  } catch {
    return { status: "error", messages: [w.failed] };
  }
}

/** The press on the confirmation page (D359): makes the store, or says why not, in the page's language. */
export async function confirmSignup(_state: FormState, formData: FormData): Promise<FormState> {
  const w = platformText(langOfForm(formData)).signUp.selfServe;
  const done = await confirmSelfSignup(String(formData.get("token") ?? ""), { password: String(formData.get("password") ?? "") });
  // A sign-up for extensions (D748 E7) is told about its account, not a store.
  const ws = signUpWorkspaceText(langOfForm(formData)).confirm;
  if (done.ok) {
    const text = done.workspace ? (done.password ? ws.doneWithPassword : ws.done) : done.password ? w.doneWithPassword : w.done;
    return { status: "ok", messages: [text.replaceAll("{store}", done.storeName)] };
  }
  const problem = done.workspace && done.problem === "off" ? ws.off : done.workspace && done.problem === "failed" ? ws.failed : w[done.problem];
  return { status: "error", messages: [problem] };
}
