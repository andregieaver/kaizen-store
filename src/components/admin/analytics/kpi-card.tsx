import Link from "next/link";
import type { ReactNode } from "react";

import { verdictOf, type GoodDirection, type Verdict } from "@/lib/analytics-core";

import { Sparkline } from "./charts";
import { Delta, type DeltaView } from "./data-table";

/**
 * One figure of the overview (D152): a label, the value, how it changed against the previous period and the same period last year
 * (sign, arrow and the words for what it is against, so colour is never alone), a small trend line, and a link to where it is
 * explained. A figure that cannot be known is not shown as zero: the card says what is missing and links to where to add it.
 */

export type KpiMissing = {
  /** What is missing, in a sentence ("Costs are not entered yet."). */
  text: string;
  /** What to do about it: a link that fixes it. */
  action?: { label: string; href: string };
};

export type KpiCardProps = {
  label: string;
  /** The figure as written ("12 400 kr"); ignored when the state is `missing`. */
  value: string | null;
  state?: "ok" | "missing";
  missing?: KpiMissing;
  /** Against the previous period; null when there is nothing to compare with. Omit it when the comparison is off. */
  deltaPrevious?: DeltaView | null;
  /** Against the same period a year earlier. */
  deltaLastYear?: DeltaView | null;
  /** Which way is good news, for a change that comes without its own verdict. */
  good?: GoodDirection;
  /** The last days' figures for the trend line. */
  series?: readonly (number | null)[];
  /** A short line under the value ("based on 83 % of sales"). */
  hint?: ReactNode;
  /** Where the figure is explained; the whole card is the link. */
  href?: string;
  /** A main figure of the page: a larger value on the surface colour. */
  emphasis?: boolean;
  /** One line on how the figure is worked out; shown as the label's tooltip. */
  help?: string;
};

/** The trend line takes the colour of the main change's news (green good, red bad), else the plain one. */
function toneOf(delta: DeltaView | null | undefined, good: GoodDirection): "neutral" | "good" | "bad" {
  if (!delta) return "neutral";
  const verdict: Verdict = delta.verdict ?? verdictOf(delta.abs, good);
  return verdict === "neutral" ? "neutral" : verdict;
}

/** A figure is sized by its card's width; a sentence in place of a figure ("60 % of products make 82 % of revenue") is smaller and wraps. */
function valueSize(value: string | null, emphasis: boolean): string {
  if ((value?.length ?? 0) > 18) return "text-xl";
  return emphasis ? "text-2xl @[16rem]:text-3xl" : "text-xl @[13rem]:text-2xl";
}

export function KpiCard({ label, value, state = "ok", missing, deltaPrevious, deltaLastYear, good = "neutral", series, hint, href, emphasis = false, help }: KpiCardProps) {
  // A card is its own container, so its figure is sized by the room the card has, not by the screen: a narrow card in a row of four
  // keeps the figure whole at a smaller size instead of breaking it in the middle.
  const box = `@container flex h-full min-w-0 flex-col justify-between gap-2 rounded-lg border border-border ${emphasis ? "bg-surface" : "bg-background"} p-4`;
  const title = help ? { title: help } : {};

  if (state === "missing") {
    return (
      <div className={box} data-state="missing">
        <p className="text-xs font-medium text-muted" {...title}>
          {label}
        </p>
        <div className="space-y-1">
          <p className="text-lg font-semibold text-muted">
            <span aria-hidden="true">–</span>
            <span className="sr-only">Not available</span>
          </p>
          {missing ? <p className="text-xs text-muted">{missing.text}</p> : null}
          {missing?.action ? (
            <Link href={missing.action.href} className="inline-block text-xs font-medium text-(--brand-text) underline-offset-2 hover:underline">
              {missing.action.label}
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  const known = value !== null && value !== undefined && value !== "";
  const showDeltas = deltaPrevious !== undefined || deltaLastYear !== undefined;
  const body = (
    <>
      <p className="text-xs font-medium text-muted" {...title}>
        {label}
      </p>
      {/* The figure never shrinks to make room for the trend line: in a narrow card the line goes under the figure, in a wide one beside it
          (decided by the card's width, so a row of cards is all one way). */}
      <div className="flex flex-col gap-1 @[17rem]:flex-row @[17rem]:flex-wrap @[17rem]:items-end @[17rem]:justify-between @[17rem]:gap-x-3">
        <p className={`max-w-full break-words font-semibold leading-tight ${valueSize(value, emphasis)}`}>{known ? value : <span className="text-muted">–</span>}</p>
        {series && series.length > 0 ? (
          <span className="self-end @[17rem]:self-auto">
            <Sparkline values={series} tone={toneOf(deltaPrevious ?? deltaLastYear, good)} />
          </span>
        ) : null}
      </div>
      {showDeltas || hint ? (
        <div className="space-y-0.5">
          {deltaPrevious !== undefined ? (
            <p>
              <Delta delta={deltaPrevious} versus="vs previous period" good={good} />
            </p>
          ) : null}
          {deltaLastYear !== undefined ? (
            <p>
              <Delta delta={deltaLastYear} versus="vs same period last year" good={good} />
            </p>
          ) : null}
          {hint ? <p className="text-xs text-muted">{hint}</p> : null}
        </div>
      ) : null}
    </>
  );

  return href ? (
    <Link href={href} className={`${box} no-underline`} data-state="ok">
      {body}
    </Link>
  ) : (
    <div className={box} data-state="ok">
      {body}
    </div>
  );
}
