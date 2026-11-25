import "server-only";

import { suggestionBlocks } from "@/lib/broadcasts";
import { flowAudience } from "@/lib/flow-audience";
import { emailSteps, type FlowStep, withLanguageContent } from "@/lib/flows";

import { suggestBroadcast } from "./broadcasts";
import { getFlow, saveFlow } from "./flows";
import { log } from "./log";
import type { Store } from "./stores";

type Flow = NonNullable<Awaited<ReturnType<typeof getFlow>>>;

/**
 * Every email of a flow written in the store's voice in one language, each from its own words as the brief (`suggestBroadcast()`, told who
 * it reaches and when, and `earned`, what its emails brought, when given): *Write with AI* on the whole flow (M3.1, M3.7) and a recipe after
 * *Start* (D897). An email whose products are picked for each reader keeps its picks.
 */
export async function flowInVoice(
  store: Store,
  accountId: string,
  flow: Pick<Flow, "steps" | "trigger" | "triggerDays">,
  locale: string,
  earned = "",
): Promise<{ ok: true; steps: FlowStep[] } | { ok: false; problem: string }> {
  let steps = flow.steps;
  for (const step of emailSteps(flow.steps)) {
    const own = step.content[locale] ?? Object.values(step.content)[0];
    if (!own) continue;
    const words = [own.subject, ...own.blocks.flatMap((b) => ("text" in b && typeof b.text === "string" ? [b.text] : []))].join("\n");
    const audience = [flowAudience(flow.steps, step.id, flow.trigger, flow.triggerDays), earned].filter(Boolean).join(" ");
    const suggested = await suggestBroadcast(store, accountId, words, locale, { audience });
    if (!suggested.ok) return { ok: false, problem: suggested.problem };
    const s = suggested.suggestion;
    steps = withLanguageContent(steps, step.id, locale, { subject: s.subject, preview: s.preview, blocks: suggestionBlocks(step.picks ? { ...s, products: [] } : s) });
  }
  return { ok: true, steps };
}

/**
 * A recipe's first words in the store's voice (email plan M3.10's follow-up, D897): after *Start* has made a flow from a goal's recipe and
 * answered, each email's ready-made words are rewritten by the store's writer (`suggestBroadcast()`: its facts, brand and rules, told who
 * the email reaches and when), as *Write with AI* on the whole flow does. Saved as the flow's next version only while it is still as
 * *Start* made it (`onlyAtVersion`: the first version, off and untested); an owner who changed it meanwhile keeps their change. With no AI,
 * or a writer that cannot, the ready-made words stay. Picks of products for each reader stay the flow's.
 */
export async function writeRecipeInVoice(store: Store, accountId: string, flowId: string): Promise<"written" | "kept"> {
  const flow = await getFlow(store.id, flowId);
  if (!flow || flow.version !== 1 || flow.enabled || flow.tested) return "kept";
  const written = await flowInVoice(store, accountId, flow, store.localization.locales[0] ?? "en-GB");
  if (!written.ok) return "kept";
  const steps = written.steps;
  const saved = await saveFlow(
    store.id,
    accountId,
    flow.id,
    {
      name: flow.name,
      trigger: flow.trigger,
      triggerDays: flow.triggerDays,
      triggerSegmentId: flow.triggerSegmentId,
      scheduleAt: flow.scheduleAt,
      scheduleEveryDays: flow.scheduleEveryDays,
      triggerTag: flow.triggerTag,
      triggerEvent: flow.triggerEvent,
      steps,
      goals: flow.goals,
    },
    { onlyAtVersion: 1 },
  );
  if (!saved.ok) log("info", "flows.voice_kept", { storeId: store.id, flowId });
  return saved.ok ? "written" : "kept";
}
