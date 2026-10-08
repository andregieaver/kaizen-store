import "server-only";

import { featureSwitchSummary, sameWarnings, type SetFeatureInput } from "@/lib/feature-tools";
import { formatMoney } from "@/lib/money";
import { homeMarket } from "@/lib/markets";
import { FEATURE_IDS, FEATURES_BY_ID, featureBlockers, featureInUse, featureKept, featureOn, featureWarnings, missingNeeds, type FeatureId } from "@/lib/store-features";

import type { Account } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import { featureFacts, setFeature } from "./store-features";
import type { Store } from "./stores";
import type { PermissionHolder } from "@/lib/permissions";

/**
 * The AI manager's store feature tools (D178 step 6): `list_features` reads the Features page's facts, `set_feature` switches one feature through
 * `setFeature()`, so its needs, blockers, warnings, audit and caches are the page's. A switch that could not be made (a need off, a blocker) is
 * refused before it is kept for a yes (`preflightFeatureTool()`); the approval names the warnings (`featureApprovalDetails()`), and the switch
 * runs confirmed only when they are still the ones the owner approved.
 */

type Ctx = { account: Account; store: Store; holder?: PermissionHolder };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const adminLink = (store: Store, path: string) => `/admin/${store.slug}${path}`;
const moneyIn = (store: Store) => (minor: number, currency: string) => formatMoney(minor, currency, homeMarket(store)?.locale ?? "en");
const needWords = (id: FeatureId) => (id === "shop" ? "the online shop" : FEATURES_BY_ID[id].label);

/** Every feature of the store as the Features page shows it: on, off or asleep, in use, what it needs, where it is set up. */
export async function listFeaturesTool({ store }: Ctx) {
  const facts = await featureFacts(store.id);
  return {
    features: FEATURE_IDS.map((id) => {
      const feature = FEATURES_BY_ID[id];
      const on = featureOn(store, id);
      return {
        id,
        label: feature.label,
        what: feature.words,
        state: on ? "on" : featureKept(store, id) ? "asleep" : "off",
        in_use: featureInUse(id, facts),
        needs: feature.needs.map(needWords),
        ...(featureKept(store, id) && !on && { waiting_for: missingNeeds(store, id).map(needWords) }),
        page: adminLink(store, on ? feature.setupPath : "/settings/features"),
      };
    }),
    switched_on_under: adminLink(store, "/settings/features"),
    note: "A feature off or asleep is hidden in the admin and on the site; nothing of it is deleted.",
  };
}

/** What switching a feature off would warn of now, and what blocks it (empty: nothing); nothing for a switch on, or one that is asleep. */
async function switchFacts(store: Store, input: SetFeatureInput): Promise<{ blockers: string[]; warnings: string[] }> {
  if (input.on || !featureOn(store, input.feature)) return { blockers: [], warnings: [] };
  const facts = await featureFacts(store.id);
  return {
    blockers: featureBlockers(input.feature, facts).map((b) => b.text),
    warnings: featureWarnings(input.feature, facts, store, moneyIn(store)),
  };
}

/** A switch that could not be made, or would change nothing, is refused now and never kept for a yes. */
export async function preflightFeatureTool({ store }: Ctx, input: SetFeatureInput): Promise<void> {
  const label = FEATURES_BY_ID[input.feature].label;
  if (featureKept(store, input.feature) === input.on) fail(`${label} is already switched ${input.on ? "on" : "off"}.`);
  if (input.on) {
    const missing = missingNeeds(store, input.feature);
    if (missing.length > 0) fail(`${label} needs ${missing.map(needWords).join(" and ")}. Switch ${missing.length === 1 ? "it" : "them"} on first.`);
    return;
  }
  const { blockers } = await switchFacts(store, input);
  if (blockers.length > 0) fail([`${label} can't be switched off yet.`, ...blockers].join(" "));
}

/** The approval's words and the warnings the owner is shown, kept with the call (`approved_warnings`, never the model's). */
export async function featureApprovalDetails(store: Store, input: SetFeatureInput): Promise<{ summary: string; warnings: string[] }> {
  const { warnings } = await switchFacts(store, input);
  return { summary: featureSwitchSummary(input.feature, input.on, warnings), warnings };
}

/** Switches the feature on the owner's yes: warnings count as confirmed only when they are the ones the owner approved. */
export async function setFeatureTool({ account, store, holder }: Ctx, input: SetFeatureInput) {
  const label = FEATURES_BY_ID[input.feature].label;
  const { warnings } = await switchFacts(store, input);
  if (warnings.length > 0 && !sameWarnings(input.approved_warnings ?? [], warnings)) {
    fail(`What switching ${label} off means has changed since you were asked: ${warnings.join(" ")} Ask the owner again.`);
  }
  const member = { account, store, role: holder?.role ?? "owner", kind: holder?.kind, permissions: holder?.permissions };
  const result = await setFeature(member, input.feature, input.on, { confirmed: true });
  if (!result.ok) fail(result.problems.join(" "));
  if (result.ok && !result.changed) return { done: `${label} was already switched ${input.on ? "on" : "off"}.` };
  return {
    done: `${label} is switched ${input.on ? "on" : "off"}.`,
    ...(input.on ? { set_up: adminLink(store, FEATURES_BY_ID[input.feature].setupPath) } : { note: "Nothing is deleted: switching it on again brings everything back." }),
    features_on: FEATURE_IDS.filter((id) => result.ok && featureOn(result.features, id)),
  };
}
