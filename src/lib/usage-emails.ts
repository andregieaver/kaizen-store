import { capacityEn } from "./admin-messages/capacity.en";
import type { EmailContent } from "./email-layout";
import { formatLimit, formatUsage } from "./usage-format";
import type { UsageLine } from "./usage-view";

/**
 * The email a store's owners get when it nears or reaches a limit of its plan (D314, `docs/capacity.md` step 2.5). Pure. Kaizena Flow
 * writes to owners in English, as the store-closure emails do. It names the store, the limits, the figures and one link; never a customer.
 * A soft limit (visits, bandwidth) says plainly that the shop stays open.
 */

export type UsageEmailFacts = {
  storeName: string;
  level: "near" | "reached";
  lines: readonly UsageLine[];
  /** The store's Billing page in the admin. */
  url: string;
};

const FOOTER = ["Kaizena Flow · kaizenaflow.com"];

export function usageEmail(facts: UsageEmailFacts): EmailContent {
  const { storeName: name, level, lines } = facts;
  const listed = lines.map((l) => `${capacityEn.metrics[l.metric]}: ${formatUsage(l.metric, l.used)} of ${l.limit === null ? "no limit" : formatLimit(l.key, l.limit)}`);
  const soft = lines.every((l) => l.enforce === "soft");
  const subject = level === "reached" ? `${name} has used what its plan includes` : `${name} is close to its plan's limits`;
  return {
    subject,
    preview: listed.join(" · "),
    lang: "en",
    footer: [name, ...FOOTER],
    blocks: [
      { type: "heading", text: subject },
      { type: "paragraph", text: `This month so far: ${listed.join("; ")}.` },
      {
        type: "paragraph",
        text: soft
          ? "Your shop stays open: visits and bandwidth only warn. A plan with more is there when you want it."
          : level === "reached"
            ? "Adding more is paused until you free some room or choose a plan with more. Everything you have keeps working, and orders, emails to customers and invoices are never held back."
            : "Nothing is held back yet. When the limit is reached, adding more waits until you free some room or choose a plan with more.",
      },
      { type: "button", text: "See usage and plans", url: facts.url },
    ],
  };
}

export type AutopilotBudgetFacts = { storeName: string; level: "near" | "reached"; spentUsd: number; budgetUsd: number; url: string };

/**
 * The email a store's owners get when the autopilot's own AI budget for the month nears (80 %) or is spent (PSI AST-07). Pure, English as
 * the plan's emails are; the figures are worked out by the caller.
 */
export function autopilotBudgetEmail(facts: AutopilotBudgetFacts): EmailContent {
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const subject = facts.level === "reached" ? `The autopilot of ${facts.storeName} has spent its AI budget` : `The autopilot of ${facts.storeName} is close to its AI budget`;
  const figures = `${usd(facts.spentUsd)} of ${usd(facts.budgetUsd)} this month`;
  return {
    subject,
    preview: figures,
    lang: "en",
    footer: [facts.storeName, ...FOOTER],
    blocks: [
      { type: "heading", text: subject },
      { type: "paragraph", text: `The AI calls it made on its own: ${figures}.` },
      {
        type: "paragraph",
        text:
          facts.level === "reached"
            ? "It stops until next month, or until you raise the budget. Nothing else waits: you and your team still use the AI yourselves."
            : "Nothing has stopped. When the budget is spent, the autopilot waits until next month or until you raise it.",
      },
      { type: "button", text: "Open the autopilot's settings", url: facts.url },
    ],
  };
}
