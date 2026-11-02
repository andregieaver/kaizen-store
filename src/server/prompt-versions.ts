import "server-only";

import { createHash } from "node:crypto";

import { systemPrompt } from "@/lib/chat";
import { SCREENING_SYSTEM, screeningPrompt, TRIAGE_SYSTEM, triagePrompt, type Listing } from "@/lib/content-moderation";
import { briefPrompt } from "@/lib/dream-factory";
import { assembleLegalFacts } from "@/lib/legal-facts";
import { jurisdictionsFor } from "@/lib/legal-sources";
import { starterFactWords } from "@/lib/legal-starters";
import { factSheet, planLegalPage, writerMessages, writerSettings } from "@/lib/legal-writer";

/**
 * The agents' prompt versions (wave 11 unit L, D391, PSI AGT-14): each agent's system prompt drawn with fixed inputs (a store called Eval
 * Store in Norway, a fixed day, no agent of the owner's own, no memories), hashed. The hash changes only when the prompt's code does, never
 * with a store's name, the day or a person, so it names the version every turn was written under: kept with the AI manager's answers
 * (`assistant_messages.prompt_version`), the chat's (`data.prompt`) and every eval run (`ai_eval_runs.prompt_versions`), and the
 * agents' eval plays exactly these prompts, so a recording is of one version (`agent-eval-replay.int.test.ts`). The AI manager's fixed
 * prompt is drawn beside its prompt (`fixedManagerPrompt()` in `owner-assistant.ts`), so the shopper chat's routes never load it; all
 * of them together are `promptVersions()` in `agent-eval.ts`. The notice reader and listing checker (D411 part 2) and the Dream Factory's
 * brief (D409) are drawn here too: their system prompts and the code that frames what they are sent.
 */

export type PromptAgent = "chat" | "manager" | "legal" | "moderation" | "dream";
export type PromptVersions = Record<PromptAgent, string>;

/** A version: the first twelve hex digits of the text's SHA-256. */
export const promptHash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 12);

/** The day every fixed prompt is drawn on. */
export const PROMPT_DAY = new Date("2026-01-05T09:00:00Z");

/** The shopper chat's prompt for the fixed store. */
export function fixedChatPrompt(): string {
  return systemPrompt({
    site: "Eval Store",
    kind: "store",
    agentName: "",
    occupation: "",
    lang: "en",
    instructions: "",
    path: null,
    today: PROMPT_DAY.toISOString().slice(0, 10),
  });
}

/** The legal page writer's messages (D311) for a returns policy of a store in Norway, its passages the given text. */
export function fixedLegalMessages(passage: string) {
  const facts = assembleLegalFacts({
    store: { name: "Eval Store", legalName: "Eval Store AS", organisationNumber: "999 888 777", contactEmail: "post@eval.example", postalAddress: "Storgata 1, 0155 Oslo", country: "NO", audience: "consumers", visitCounting: false, modules: [], tracking: {} },
    tax: { vatNumber: null, registered: true },
    markets: [{ code: "NO", currency: "NOK" }],
    shippingRates: [],
    carrierNames: [],
    returnSettings: null,
    chatOn: false,
    links: {},
    phone: null,
  });
  const sheet = factSheet(facts, starterFactWords(facts, "en"), "en");
  const plan = planLegalPage({
    role: "returns_policy",
    language: "en",
    facts,
    sheet,
    jurisdictions: jurisdictionsFor(facts),
    texts: [{ sourceKey: "eu-crd", language: "en", readAt: PROMPT_DAY, passages: ["art_9", "art_11", "art_13", "art_14", "art_16"].map((key) => ({ key, title: `Article ${key.slice(4)}`, text: passage })) }],
  });
  return writerMessages(plan, sheet, writerSettings(facts));
}

const memo = new Map<string, string>();
const once = (key: string, draw: () => string) => {
  let hash = memo.get(key);
  if (!hash) memo.set(key, (hash = promptHash(draw())));
  return hash;
};

/** The shopper chat's prompt version. */
export const chatPromptVersion = (): string => once("chat", fixedChatPrompt);

/** The legal page writer's: its instructions (system turns) alone, the passages being the case's. */
export const legalPromptVersion = (): string =>
  once("legal", () =>
    fixedLegalMessages("")
      .filter((turn) => turn.role === "system")
      .map((turn) => turn.content)
      .join("\n"),
  );

/** A notice's first reading or a listing's check (D411 part 2), as `triageContentReport()` and `screenListings()` ask the model. */
export function fixedModerationMessages(
  script: { kind: "triage"; notice: { category: string; explanation: string; url: string }; listing: Listing | null } | { kind: "screening"; listing: Listing },
): { role: "system" | "user"; content: string }[] {
  return script.kind === "triage"
    ? [
        { role: "system", content: TRIAGE_SYSTEM },
        { role: "user", content: triagePrompt(script.notice, script.listing) },
      ]
    : [
        { role: "system", content: SCREENING_SYSTEM },
        { role: "user", content: screeningPrompt(script.listing) },
      ];
}

/** The moderation prompts' version: both system prompts and the framing of a fixed notice and listing. */
export const moderationPromptVersion = (): string =>
  once("moderation", () => {
    const listing = { title: "Eval listing", description: "Eval description", safety: "Eval safety" };
    return [
      ...fixedModerationMessages({ kind: "triage", notice: { category: "other", explanation: "Eval explanation", url: "https://kaizenaflow.com/s/eval/no/p/x" }, listing }),
      ...fixedModerationMessages({ kind: "screening", listing }),
    ]
      .map((m) => m.content)
      .join("\n");
  });

/** The Dream Factory's brief (D409) for the fixed store, the owner's description being the case's. */
export function fixedBriefMessages(description: string): { role: "system" | "user"; content: string }[] {
  return [
    { role: "system", content: briefPrompt("Eval Store") },
    { role: "user", content: description },
  ];
}

/** The brief's version: its system prompt for the fixed store. */
export const dreamPromptVersion = (): string => once("dream", () => briefPrompt("Eval Store"));
