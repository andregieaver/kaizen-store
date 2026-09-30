import "server-only";

import { BACKGROUND_EFFECTS, ENTER_EFFECTS, HOVER_EFFECTS, SCROLL_EFFECTS, type MotionTarget } from "@/lib/motion";
import { z } from "zod";

import {
  cleanMotionPlan,
  motionPlanRefusal,
  outlinePage,
  ruleBasedPlan,
  STYLES,
  type MotionPlanResult,
  type PageOutline,
} from "@/lib/motion-plan";
import { PAGE_TYPES, pageRowSchema, ROWS_MAX, type PageRow, type PageType } from "@/lib/page-content";
import { parseModelJson } from "@/lib/query-understanding";

import { completeText, type AiConnection, type ChatMessage } from "./ai";

/**
 * "Make my page cool" (D128): the site's text model looks at an outline of the page and chooses motion for it, within
 * the effect catalogues; what it answers is checked against the real page (`cleanMotionPlan`) and only then offered to
 * the owner. With no AI, or an answer that cannot be used, the rules make the plan (`ruleBasedPlan`): the button always
 * does something useful. The model sees structure and a few headline words (`outlinePage`), never prices, addresses or
 * people; its words are data, never HTML, and the summary the owner reads is written in code.
 */

/** Effects with the same targets, listed once: `fade (Fade in), fade-up (Fade up) …` under "any part" and so on. */
function listCatalogue(catalogue: Record<string, { label: string; targets: readonly MotionTarget[] }>): string {
  const groups = new Map<string, string[]>();
  for (const [id, entry] of Object.entries(catalogue)) {
    const key = entry.targets.join(", ");
    groups.set(key, [...(groups.get(key) ?? []), `${id} (${entry.label})`]);
  }
  const named = (targets: string) => (targets === "row, column, block, text" ? "any part" : `only on ${targets}`);
  return [...groups.entries()].map(([targets, effects]) => `  ${named(targets)}: ${effects.join(", ")}`).join("\n");
}

const STYLE_GUIDE = `- "subtle": ${STYLES.subtle.enter.join(", ")} only; small moves, soft ease.
- "elegant": ${STYLES.elegant.enter.join(", ")}; text may use ${STYLES.elegant.text.join(", ")}; smooth ease.
- "lively": ${STYLES.lively.enter.join(", ")}; text may use ${STYLES.lively.text.join(", ")}; snappy.`;

/** The rules the model is given, with the catalogues it may choose from. */
export function motionSystemPrompt(): string {
  return [
    "You are a motion designer for a web page builder. You are given the outline of one page and choose tasteful motion for it: entrances (when a part comes into view or the page loads), hover effects, scroll effects and moving backgrounds.",
    "",
    "Rules:",
    '- Choose ONE style for the whole page and stay in it: "subtle", "elegant" or "lively".',
    STYLE_GUIDE,
    "- Be restrained. Animate about one part in three at most, and use at most two different kinds of entrance on the page besides text effects. A page must never feel like a circus.",
    '- The first row (firstRow: true) loads with the page: give it entrances with "trigger": "load" and short delays (under 600 ms), and no scroll effects on its text.',
    '- A row with several columns gets ONE entrance on the row with a "stagger" (milliseconds, up to 400), so its columns come in turn. Do not give each column its own delay. Do not animate a part inside a part that is already animated.',
    "- Buttons get a small hover effect; pictures and cards (columns of a row with several columns) may too. Rows, headings and text get none. A row or column with a picture background may get parallax or a slow zoom. Gradient and colour backgrounds get nothing.",
    '- Parts marked "motion": true or "bgMotion": true were animated by the owner: leave those alone.',
    "- Entrances go only on these components: richText, heading, image, button, dualButton, video, contentGrid, accordion, tabs, faq, testimonials, iconList, socialLinks, emailForm, newsletter (and on rows and columns). Separators, html, menus, search, shop and product parts stay still.",
    "- Use ONLY the effect ids listed here and ONLY the ids in the outline. Never invent ids, effects or values.",
    "",
    'Entrance effects ("enter"):',
    listCatalogue(ENTER_EFFECTS),
    'Hover effects ("hover"):',
    listCatalogue(HOVER_EFFECTS),
    'Scroll effects ("scroll"):',
    listCatalogue(SCROLL_EFFECTS),
    'Background effects ("backgroundMotion", rows and columns that have a picture or video background):',
    listCatalogue(BACKGROUND_EFFECTS),
    "",
    'Answer with JSON only, in exactly this shape, leaving out what you do not use: {"style": "elegant", "items": [{"id": "<a row, column or component id>", "enter": {"effect": "fade-up", "delay": 0, "stagger": 0}, "hover": {"effect": "lift"}, "scroll": {"effect": "parallax"}, "backgroundMotion": {"effect": "parallax"}}]}',
    "Speed, ease and distance are set for you from the style. delay is milliseconds in steps of 50.",
  ].join("\n");
}

/** The messages that ask: the rules, then the outline as JSON. */
export function motionMessages(outline: PageOutline): ChatMessage[] {
  return [
    { role: "system", content: motionSystemPrompt() },
    { role: "user", content: `The page:\n${JSON.stringify(outline)}` },
  ];
}

/**
 * The plan for a page: from the model when the connection has a text model and its answer holds something usable,
 * else from the rules. Never fails for lack of AI; only a page with nothing to look at gets the rules' "nothing to add".
 */
export async function planPageMotion(connection: AiConnection | null, rows: PageRow[]): Promise<MotionPlanResult> {
  const outline = outlinePage(rows);
  if (connection?.textModel && outline.rows.length > 0) {
    try {
      const reply = await completeText(connection, motionMessages(outline), {
        maxTokens: 3000,
        timeoutMs: 45_000,
        temperature: 0.2,
        reasoningEffort: "low",
      });
      const plan = cleanMotionPlan(parseModelJson(reply.text), rows);
      if (plan) return { ok: true, plan };
    } catch {
      // The provider is down, slow or answered nothing: the rules do it.
    }
  }
  return { ok: true, plan: ruleBasedPlan(rows) };
}

/** The most JSON one request takes: a page's rows with room to spare. */
export const MOTION_REQUEST_MAX = 1_500_000;

/**
 * What a plan request holds, checked as the page save checks it: the page's rows as the editor has them (a page in the
 * middle of an edit may not be valid yet, which is said in plain words), for a kind of page that takes motion here.
 */
export function readMotionRows(
  type: PageType,
  rowsJson: unknown,
): { ok: true; rows: PageRow[] } | { ok: false; problem: string } {
  if (!PAGE_TYPES.includes(type)) return { ok: false, problem: "Unknown page. Reload and try again." };
  const refused = motionPlanRefusal(type);
  if (refused) return { ok: false, problem: refused };
  if (typeof rowsJson !== "string" || rowsJson.length > MOTION_REQUEST_MAX) {
    return { ok: false, problem: "The page is too large to look at in one go." };
  }
  let held: unknown;
  try {
    held = JSON.parse(rowsJson);
  } catch {
    return { ok: false, problem: "The page could not be read. Reload and try again." };
  }
  const parsed = z.array(pageRowSchema).max(ROWS_MAX, `A page takes at most ${ROWS_MAX} rows.`).safeParse(held);
  if (!parsed.success) {
    return {
      ok: false,
      problem: `The page has something that needs fixing first: ${parsed.error.issues[0]?.message ?? "it could not be read."}`,
    };
  }
  return { ok: true, rows: parsed.data };
}
