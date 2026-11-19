/**
 * The reportsCampaigns cut (bloat review step 2.27): the groups campaigns, channels of REPORTS_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as REPORTS_CAMPAIGNS_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { REPORTS_WORDS } from "./reports";

export const REPORTS_CAMPAIGNS_WORDS = cut(REPORTS_WORDS, ["campaigns", "channels"]);
