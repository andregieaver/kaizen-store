import type { PublicPlans } from "./plan-offer";
import { PLAN_WORDS_NB } from "./plan-words.nb";

/** The plans' own words by language (D312): Norwegian by the English they are written in; English is the data as it is. */
const WORDS: Partial<Record<string, Record<string, string>>> = { nb: PLAN_WORDS_NB };

/**
 * Kaizena Flow's plans in `lang` (D142, D312): each plan's line and each feature's category, name and description where they are written in
 * it (`PLAN_WORDS_NB`), else as written. Plan names are names. Pure: `PlansSection` reads the plans and draws them in the page's language.
 */
export function plansIn(data: PublicPlans, lang: string): PublicPlans {
  const words = WORDS[lang];
  if (!words) return data;
  const say = (text: string) => (Object.hasOwn(words, text) ? words[text] : text);
  return {
    plans: data.plans.map((plan) => ({ ...plan, description: say(plan.description) })),
    features: data.features.map((feature) => ({
      ...feature,
      category: say(feature.category),
      name: say(feature.name),
      description: say(feature.description),
    })),
  };
}
