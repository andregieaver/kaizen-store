import { ArrowRight, Check, ChevronRight, Printer } from "lucide-react";
import type { ReactNode } from "react";

import { AdminLink, PageHeader } from "@/components/admin/ui";
import { CARD_CLASS } from "@/components/admin/ui/card";

/**
 * The parts of the redesigned Home (round 1, `docs/audits/admin-redesign-round-1.md`), shared by a store's Home and the platform's: the one
 * next step with the page's only green button, the week as bars, lists with pictures, a ring for setup and the milestones' track. They draw
 * what they are given; the page counts it.
 */

/** The page's greeting (a `PageHeader`): the eyebrow, "Good afternoon, Eva", and one sentence on how things are, its first part in ink. */
export function HomeHeader({ eyebrow, title, lead, rest, chips }: { eyebrow: string; title: string; lead: string | null; rest: string; chips?: ReactNode }) {
  return (
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      description={
        lead || rest ? (
          <p className="text-[1.125rem] leading-relaxed text-pretty">
            {lead && <span className="text-ink">{lead}</span>}
            {lead && rest ? " " : ""}
            {rest}
          </p>
        ) : undefined
      }
      actions={chips}
    />
  );
}

/** A small status chip with a dot: `positive` green, `warning` amber, `neutral` grey. */
export function DotChip({ tone, children }: { tone: "positive" | "warning" | "neutral"; children: ReactNode }) {
  const look = {
    positive: "bg-positive-soft text-positive-text",
    warning: "bg-warning-soft text-warning-text",
    neutral: "bg-neutral-soft text-neutral-text",
  }[tone];
  const dot = { positive: "bg-insight-solid", warning: "bg-warning-solid", neutral: "bg-neutral-solid" }[tone];
  return (
    <span className={`inline-flex h-7 items-center gap-1.5 rounded-pill px-2.5 text-caption ${look}`}>
      {tone !== "neutral" && <span aria-hidden className={`size-1.5 rounded-pill ${dot}`} />}
      {children}
    </span>
  );
}

/** The main column and the aside: two columns from 1024 px, one below. */
export function HomeColumns({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">{main}</div>
      <aside className="flex min-w-0 flex-col gap-4">{aside}</aside>
    </div>
  );
}

/** "Next up": the one thing to do now, with the page's one green button and, optionally, a second way and a picture of what it is about. */
export function NextUp({
  eyebrow,
  title,
  text,
  action,
  second,
  children,
}: {
  eyebrow: string;
  title: string;
  text?: ReactNode;
  action?: { href: string; label: string };
  second?: { href: string; label: string; print?: boolean };
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby="next-up" data-next-up className={`${CARD_CLASS} flex flex-col gap-5 p-6 sm:p-7`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <p className="text-eyebrow text-muted uppercase">{eyebrow}</p>
          <h2 id="next-up" className="text-metric text-ink">
            {title}
          </h2>
          {text && <p className="text-body text-ink-2">{text}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {second && (
            <AdminLink href={second.href} prefetch={false} className="inline-flex h-11 items-center gap-2 rounded-pill border border-edge bg-card px-4 text-body text-ink hover:bg-sunken">
              {second.print && <Printer aria-hidden className="size-4" />}
              {second.label}
            </AdminLink>
          )}
          {action && (
            <AdminLink href={action.href} className="inline-flex h-11 items-center gap-2 rounded-pill bg-brand px-5 text-body-strong text-brand-ink hover:bg-brand-hover">
              {action.label}
              <ArrowRight aria-hidden className="size-4" />
            </AdminLink>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

/** A product picture, or a quiet square with the first letter where there is none. */
export function Thumb({ src, title, size = 48 }: { src: string | null; title: string; size?: number }) {
  const box = { width: size, height: size };
  if (!src) {
    return (
      <span aria-hidden style={box} className="flex shrink-0 items-center justify-center rounded-card bg-sunken text-caption text-muted">
        {title.slice(0, 1).toLocaleUpperCase()}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- product pictures come from the store's own media, at their stored size.
  return <img src={src} alt={title} width={size} height={size} loading="lazy" style={box} className="shrink-0 rounded-card bg-sunken object-cover" />;
}

/** A row of an order's pictures: the first few, then "+n more". */
export function Pictures({ lines, size = 48, max = 3, moreWord }: { lines: { title: string; picture: string | null }[]; size?: number; max?: number; moreWord: (n: number) => string }) {
  const shown = lines.slice(0, max);
  const rest = lines.length - shown.length;
  return (
    <div className="flex items-center gap-1.5">
      {shown.map((line, i) => (
        <Thumb key={`${line.title}-${i}`} src={line.picture} title={line.title} size={size} />
      ))}
      {rest > 0 && <span className="text-caption text-muted">{moreWord(rest)}</span>}
    </div>
  );
}

/** Initials in a round tile, for a person with no picture. */
export function Initials({ name, size = 36, strong = false }: { name: string; size?: number; strong?: boolean }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toLocaleUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-pill text-caption ${strong ? "bg-brand-soft text-brand-text" : "bg-sunken text-ink-2"}`}
    >
      {letters || "·"}
    </span>
  );
}

/** A card with a title and an optional link at its top right. */
export function HomeCard({ title, link, children, compact = false }: { title: string; link?: { href: string; label: string }; children: ReactNode; compact?: boolean }) {
  return (
    <section aria-label={title} className={`${CARD_CLASS} flex flex-col ${compact ? "gap-3 p-5" : "gap-4 p-6 sm:px-7"}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={compact ? "text-body-strong text-ink" : "text-title text-ink"}>{title}</h2>
        {link && (
          <AdminLink href={link.href} className="inline-flex items-center gap-1 text-body text-ink-2 hover:text-ink">
            {link.label}
            <ChevronRight aria-hidden className="size-4" />
          </AdminLink>
        )}
      </div>
      {children}
    </section>
  );
}

/** A list row that is a link: a picture or icon, two lines, and a word on the right. */
export function LinkRow({ href, start, title, sub, end }: { href: string; start: ReactNode; title: ReactNode; sub?: ReactNode; end?: ReactNode }) {
  return (
    <li className="border-t border-line first:border-t-0">
      <AdminLink href={href} className="flex min-h-14 items-center gap-3 py-2.5 hover:[&_.row-title]:underline">
        {start}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="row-title truncate text-body text-ink">{title}</span>
          {sub && <span className="truncate text-caption text-muted">{sub}</span>}
        </span>
        {end}
      </AdminLink>
    </li>
  );
}

/**
 * The week as bars: each day this week in ink (today in green, with its amount), the same day the week before as a thin grey bar beside it,
 * the day's name under it. Read out as one sentence (`label`); the figures beside it carry the words, never the bars alone.
 */
export function WeekBars({
  heights,
  priorHeights,
  dayNames,
  todayAmount,
  label,
  keys,
  link,
}: {
  heights: number[];
  priorHeights: number[];
  dayNames: string[];
  todayAmount: string;
  label: string;
  keys: { now: string; before: string };
  link?: { href: string; label: string };
}) {
  const last = heights.length - 1;
  return (
    <div role="img" aria-label={label} className="flex flex-col gap-2">
      <div className="grid h-48 grid-cols-7 items-end gap-2 border-b border-line sm:gap-3">
        {heights.map((h, i) => (
          <div key={dayNames[i] ?? i} className="flex h-full flex-col items-center justify-end gap-1.5">
            {i === last && <span className="text-caption whitespace-nowrap text-positive-text">{todayAmount}</span>}
            <div className="flex items-end gap-1">
              <span style={{ height: priorHeights[i] ?? 0 }} className="w-2 rounded-t-[3px] bg-neutral-line sm:w-3.5" />
              <span style={{ height: h }} className={`w-4 rounded-t-[4px] sm:w-7 ${i === last ? "bg-brand" : "bg-ink"}`} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2 text-center text-caption text-muted sm:gap-3">
        {dayNames.map((name, i) => (
          <span key={`${name}-${i}`} className={i === last ? "text-ink" : undefined}>
            {name}
          </span>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-4 text-caption text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px] bg-ink" />
          {keys.now}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-[3px] bg-neutral-line" />
          {keys.before}
        </span>
        {link && (
          <AdminLink href={link.href} className="ml-auto inline-flex items-center gap-1 text-ink-2 hover:text-ink">
            {link.label}
            <ChevronRight aria-hidden className="size-4" />
          </AdminLink>
        )}
      </div>
    </div>
  );
}

/** A ring that fills as steps are done, with "3/6" in it. */
export function ProgressRing({ done, total, label, size = 52 }: { done: number; total: number; label: string; size?: number }) {
  const r = size / 2 - 5;
  const length = 2 * Math.PI * r;
  const filled = total > 0 ? (done / total) * length : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" className="stroke-line" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${length}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="stroke-brand"
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-ink text-[12px]">
        {done}/{total}
      </text>
    </svg>
  );
}

/** The milestones' track: a bar to the next one, the marks under it, those reached ticked. */
export function MilestoneTrack({ share, marks, label, firstSale }: { share: number; marks: { at: number; reached: boolean }[]; label: string; firstSale: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={label} className="relative h-2 rounded-pill bg-sunken">
        <span style={{ width: `${Math.round(share * 100)}%` }} className="absolute inset-y-0 left-0 rounded-pill bg-brand" />
      </div>
      <div className="flex justify-between text-caption text-muted">
        {marks.map((mark) => (
          <span key={mark.at} className={`inline-flex items-center gap-0.5 ${mark.reached ? "text-positive-text" : ""}`}>
            {mark.at === 1 ? firstSale : mark.at.toLocaleString("en")}
            {mark.reached && <Check aria-hidden className="size-3" />}
          </span>
        ))}
      </div>
    </div>
  );
}
