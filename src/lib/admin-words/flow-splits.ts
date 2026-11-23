/**
 * The flow splits area's words in both languages (D868, in bloat review step 0.7's shape). Server code reads them as FLOW_SPLITS_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { flowSplitsEn, type FlowSplitsMessages } from "../admin-messages/flow-splits.en";
import { flowSplitsNb } from "../admin-messages/flow-splits.nb";

export const FLOW_SPLITS_WORDS: Record<AdminLang, FlowSplitsMessages> = { en: flowSplitsEn, nb: flowSplitsNb };
