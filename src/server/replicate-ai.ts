import "server-only";

import {
  analysisSystem,
  analysisUser,
  assessSystem,
  assessUser,
  parseAnalysis,
  type Analysis,
} from "@/lib/replicate-prompts";
import { parsePatchPlan, type PatchPlan } from "@/lib/replicate-patches";

import { AiError, completeText, imagePart, type AiConnection, type ChatMessage, type ContentPart } from "./ai";

/**
 * The page replicator's calls to the site's AI (D150): one to understand the original's design, and one per pass to look
 * at the copy beside the original. Both send pictures; a model that does not see them is noticed (a 400 from the provider),
 * and the replicator carries on without it, saying so. What the model answers is read by `parseAnalysis()` and
 * `parsePatchPlan()` and nothing else of it is used.
 */

export type AiOutcome<T> = { ok: true; value: T } | { ok: false; problem: string; blind: boolean };

function pictures(connection: AiConnection, images: Buffer[]): ContentPart[] {
  return images.map((bytes) => imagePart(connection, bytes, "image/jpeg"));
}

/**
 * A reply with room to think: a reasoning model counts its hidden reasoning against the limit, so a limit that fits the answer can be used up
 * before the first word (seen with the site's vision model on lampan.no: "cut off at its length limit"). Low reasoning effort first, a limit
 * that leaves room, and once more with three times the room when the answer was still cut off. Other failures are the caller's.
 */
export async function replyWithRoom(
  connection: AiConnection,
  messages: ChatMessage[],
  options: { maxTokens: number; temperature: number; timeoutMs: number },
): Promise<{ text: string }> {
  try {
    return await completeText(connection, messages, { ...options, reasoningEffort: "low" });
  } catch (error) {
    if (!(error instanceof AiError) || !/cut off/i.test(error.message)) throw error;
    return completeText(connection, messages, { ...options, maxTokens: options.maxTokens * 3, reasoningEffort: "low" });
  }
}

const failure = (error: unknown): { problem: string; blind: boolean } => {
  if (error instanceof AiError) {
    // A 400 with pictures in the message means the model cannot take them.
    if (error.status === 400) return { problem: "The site's AI text model cannot look at pictures. Choose a model that can under AI settings.", blind: true };
    return { problem: `The site's AI did not answer: ${error.message}`, blind: false };
  }
  return { problem: "The site's AI could not be reached.", blind: false };
};

/** The AI's description of the original, from its pictures (computers' slices, and a phone's) and the browser's digest. */
export async function analyse(connection: AiConnection, digest: string, desktop: Buffer[], mobile: Buffer[]): Promise<AiOutcome<Analysis>> {
  const seen: ChatMessage[] = [
    { role: "system", content: analysisSystem() },
    { role: "user", content: [{ type: "text", text: analysisUser(digest) }, ...pictures(connection, [...desktop, ...mobile])] },
  ];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { text } = await replyWithRoom(connection, seen, { maxTokens: 4000, temperature: 0.2, timeoutMs: 120_000 });
      const analysis = parseAnalysis(text);
      if (analysis) return { ok: true, value: analysis };
    }
    return { ok: false, problem: "The site's AI did not answer in a form that could be read.", blind: false };
  } catch (error) {
    // Without pictures, from the facts alone, so the design is still understood as far as words reach.
    const reason = failure(error);
    if (reason.blind) {
      try {
        const { text } = await completeText(connection, [{ role: "system", content: analysisSystem() }, { role: "user", content: analysisUser(digest) }], { maxTokens: 4000, temperature: 0.2, timeoutMs: 90_000, reasoningEffort: "low" });
        const analysis = parseAnalysis(text);
        if (analysis) return { ok: true, value: analysis };
      } catch {
        // Fall through to the reason.
      }
    }
    return { ok: false, ...reason };
  }
}

/** What the AI would change in the copy, from pictures of the original beside it. */
export async function assess(
  connection: AiConnection,
  input: Parameters<typeof assessUser>[0],
  images: Buffer[],
): Promise<AiOutcome<PatchPlan>> {
  const messages: ChatMessage[] = [
    { role: "system", content: assessSystem() },
    { role: "user", content: [{ type: "text", text: assessUser(input) }, ...pictures(connection, images)] },
  ];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { text } = await replyWithRoom(connection, messages, { maxTokens: 6000, temperature: 0.2, timeoutMs: 150_000 });
      const read = parsePatchPlan(text);
      if (read.ok) return { ok: true, value: read.plan };
      messages.push({ role: "assistant", content: text.slice(0, 6000) }, { role: "user", content: `That could not be read (${read.problem}). Answer again with the JSON object only.` });
    }
    return { ok: false, problem: "The site's AI did not answer in a form that could be read.", blind: false };
  } catch (error) {
    return { ok: false, ...failure(error) };
  }
}
