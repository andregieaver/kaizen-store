import type { Widen } from "./common.en";

/**
 * A flow's split tests on its page (email plan M2.5, D868), in English: each split's two ways side by side, the A/B engine's call, and
 * Keep this way. `{name}`-style placeholders are filled by `fillWords()`. Only the server reads them (`SERVER_AREAS`).
 */
export const flowSplitsEn = {
  title: "Split tests, the last 30 days",
  ways: "First way: {pa} people, {oa} orders. Second way: {pb} people, {ob} orders.",
  calls: {
    better: "The {way} way brings clearly more orders per person.",
    even: "No clear difference yet.",
    few: "Too few people yet: each way needs {floor} to tell them apart.",
    broken: "The two ways came out uneven, so the test cannot be read.",
  },
  first: "first",
  second: "second",
  keep: "Keep the {way} way",
  kept: "Kept. The flow is off until you test it again.",
};

export type FlowSplitsMessages = Widen<typeof flowSplitsEn>;
