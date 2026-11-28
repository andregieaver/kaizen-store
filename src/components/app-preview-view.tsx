import type { CSSProperties, ReactNode } from "react";

import type { AppPreviewBlock, PreviewMark, PreviewPart, PreviewTone } from "@/lib/page-content";

import { ListIcon } from "./list-icon";

/** The theme's colours an app preview is drawn in: its accent at two strengths, a soft fill for empty lines and tracks, and the signals. */
const ACCENT = "color-mix(in srgb, var(--accent) 72%, transparent)";
const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 38%, transparent)";
const ACCENT_TINT = "color-mix(in srgb, var(--accent) 16%, transparent)";
const FILL = "color-mix(in srgb, var(--muted) 20%, transparent)";
const TONE_COLOURS: Record<PreviewTone, string> = { neutral: "var(--muted)", accent: "var(--accent)", success: "#22a04b", warning: "#e07b00" };
/** A window's three dots, as an app's title bar has them. */
const DOTS = ["#ff5f57", "#febc2e", "#28c840"];

/** Words, or a soft bar of the given width where there are none yet: the preview looks like an app before it is written. */
function Words({ text, width = "70%", className = "", role }: { text: string; width?: string; className?: string; role?: "meta" | "title" }) {
  return text.trim() ? (
    <span data-kz-text={role} className={`min-w-0 [overflow-wrap:anywhere] ${className}`}>
      {text}
    </span>
  ) : (
    <span aria-hidden className="inline-block h-2.5 rounded-full align-middle" style={{ width, background: FILL }} />
  );
}

/** A small label over a part, in capitals as an app's section names are. */
function Label({ text }: { text: string }) {
  return text.trim() ? (
    <p data-kz-text="meta" className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
      {text}
    </p>
  ) : null;
}

/** A note beside a title: plain words in their colour, or a pill on a tint of it. */
function Aside({ text, tone = "neutral", pill = false }: { text: string; tone?: PreviewTone; pill?: boolean }) {
  if (!text.trim()) return null;
  const colour = TONE_COLOURS[tone];
  return (
    <span
      data-kz-text="meta"
      className={`shrink-0 text-[12px] font-medium ${pill ? "rounded-full px-2 py-0.5 text-[11px]" : ""}`}
      style={{ color: colour, ...(pill ? { background: `color-mix(in srgb, ${colour} 16%, transparent)` } : {}) }}
    >
      {text}
    </span>
  );
}

/** A line's mark in a checklist: a filled dot, a ticked box, or a tick in a circle when done, an empty one when not. */
function Mark({ mark, done }: { mark: PreviewMark; done: boolean }) {
  if (mark === "tick") return <ListIcon name="circleCheck" className="size-4 shrink-0" style={{ color: done ? TONE_COLOURS.success : FILL }} />;
  return (
    <span
      aria-hidden
      className={`flex size-4 shrink-0 items-center justify-center border text-[10px] leading-none text-white ${mark === "box" ? "rounded" : "rounded-full"}`}
      style={done ? { background: TONE_COLOURS.success, borderColor: TONE_COLOURS.success } : { borderColor: FILL }}
    >
      {done && mark === "box" ? "✓" : ""}
    </span>
  );
}

/** Bars from the bottom, each its share of the height; the last `soft` ones lighter, as a forecast is. */
function Bars({ values, soft, tall }: { values: number[]; soft: number; tall?: boolean }) {
  return (
    <div aria-hidden className={`flex items-end gap-2 ${tall ? "h-28" : "h-16"}`}>
      {values.map((value, i) => (
        <span key={i} className="flex-1 rounded-t-sm" style={{ height: `${value}%`, background: i >= values.length - soft ? ACCENT_SOFT : ACCENT }} />
      ))}
    </div>
  );
}

/** One part, drawn as its kind draws. */
function Part({ part }: { part: PreviewPart }) {
  switch (part.kind) {
    case "title":
      return (
        <div className="flex items-center justify-between gap-3">
          <Words text={part.title} width="40%" role="title" className="text-[17px] font-bold tracking-tight" />
          <Aside text={part.aside} tone={part.asideTone} pill={part.asidePill} />
        </div>
      );
    case "briefing":
      return (
        <div>
          <div className="flex items-center gap-2">
            <ListIcon name={part.icon ?? "sparkles"} className="size-4 shrink-0 text-accent" />
            <Words text={part.title} width="45%" role="title" className="text-[13px] font-semibold" />
          </div>
          {part.lines > 0 && (
            <div aria-hidden className="mt-2 flex flex-col gap-1.5">
              {[92, 78, 64].slice(0, part.lines).map((width, i) => (
                <span key={i} className="flex items-center gap-2">
                  {part.dots && <span className="size-1.5 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />}
                  <span className="h-2.5 rounded-full" style={{ width: `${width}%`, background: FILL }} />
                </span>
              ))}
            </div>
          )}
        </div>
      );
    case "checklist":
      return (
        <div>
          <Label text={part.title} />
          <ul className={`flex flex-col ${part.divided ? "divide-y divide-border" : ""}`}>
            {part.items.map((item) => (
              <li key={item.id} className={`flex items-center gap-2 ${part.divided ? "py-2" : "py-1"}`}>
                <Mark mark={part.mark ?? "circle"} done={item.done} />
                <Words text={item.text} width="60%" className={`text-[13px] ${item.done ? "text-muted line-through" : ""}`} />
              </li>
            ))}
          </ul>
        </div>
      );
    case "progress":
      return (
        <div aria-hidden className="h-2 overflow-hidden rounded-full" style={{ background: FILL }}>
          <div className="h-full rounded-full" style={{ width: `${part.value}%`, background: "var(--accent)" }} />
        </div>
      );
    case "bars":
      return (
        <div>
          {(part.title.trim() || part.aside.trim() || part.icon) && (
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                {part.icon && <ListIcon name={part.icon} className="size-4 shrink-0 text-accent" />}
                {part.title.trim() && (
                  <span data-kz-text="meta" className="text-[11px] font-semibold tracking-wide text-muted uppercase">
                    {part.title}
                  </span>
                )}
              </span>
              <Aside text={part.aside} tone={part.asideTone} />
            </div>
          )}
          <Bars values={part.values} soft={part.soft} tall={part.tall} />
          {(part.captionStart.trim() || part.captionEnd.trim()) && (
            <div data-kz-text="meta" className="mt-3 flex items-center justify-between gap-3 text-[12px] text-muted">
              <span>{part.captionStart}</span>
              <span>{part.captionEnd}</span>
            </div>
          )}
        </div>
      );
    case "pairs":
      return (
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <Words text={part.title} width="35%" role="title" className="text-[15px] font-bold" />
            <span data-kz-text="meta" className="flex items-center gap-2 text-[11px] text-muted">
              {[
                [part.legendFirst, ACCENT_SOFT],
                [part.legendSecond, "var(--accent)"],
              ]
                .filter(([text]) => text.trim())
                .map(([text, colour]) => (
                  <span key={colour} className="flex items-center gap-1">
                    <span aria-hidden className="size-2 rounded-full" style={{ background: colour }} />
                    {text}
                  </span>
                ))}
            </span>
          </div>
          <div aria-hidden className="flex h-28 items-end gap-3">
            {part.values.map(([first, second], i) => (
              <span key={i} className="flex h-full flex-1 items-end justify-center gap-1">
                <span className="w-1/2 rounded-t-sm" style={{ height: `${first}%`, background: ACCENT_SOFT }} />
                <span className="w-1/2 rounded-t-sm" style={{ height: `${second}%`, background: "var(--accent)" }} />
              </span>
            ))}
          </div>
          {part.caption.trim() && (
            <p data-kz-text="meta" className="mt-3 text-[12px] text-muted">
              {part.caption}
            </p>
          )}
        </div>
      );
    case "chat":
      return (
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <ListIcon name="sparkles" className="size-4" />
            </span>
            <Words text={part.title} width="40%" role="title" className="text-[14px] font-bold" />
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {part.messages.map((message) => (
              <p
                key={message.id}
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] ${message.mine ? "ml-auto rounded-br-sm bg-accent text-accent-foreground" : "mr-auto rounded-bl-sm"}`}
                style={message.mine ? undefined : { background: FILL }}
              >
                {message.text.trim() ? message.text : <span aria-hidden className="inline-block h-2.5 w-24 rounded-full bg-current opacity-25" />}
              </p>
            ))}
          </div>
        </div>
      );
    case "rings":
      return (
        <div className="grid grid-cols-3 gap-3">
          {part.items.map((item) => (
            <div key={item.id} className="flex flex-col items-center gap-2">
              <span
                aria-hidden
                className="flex size-16 items-center justify-center rounded-full"
                style={{ background: `conic-gradient(var(--accent) ${item.value}%, ${FILL} 0)` }}
              >
                <span className="flex size-12 items-center justify-center rounded-full bg-surface text-[12px] font-bold">{Math.round(item.value)}%</span>
              </span>
              <Words text={item.text} width="80%" className="line-clamp-1 text-center text-[11px] text-muted" />
            </div>
          ))}
        </div>
      );
    case "heatmap": {
      const on = new Set(part.on);
      return (
        <div aria-hidden className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: part.weeks * 7 }, (_, i) => (
            <span key={i} className="aspect-square rounded-[4px]" style={{ background: on.has(i) ? ACCENT : FILL }} />
          ))}
        </div>
      );
    }
    case "kanban":
      return (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${part.columns.length}, minmax(0, 1fr))` }}>
          {part.columns.map((column) => (
            <div key={column.id} className="flex min-w-0 flex-col gap-2">
              <span aria-hidden className="h-1.5 w-2/3 rounded-full" style={{ background: ACCENT_SOFT }} />
              {column.cards.map((card) => (
                <div key={card.id} className="rounded-md border border-border p-2" style={{ background: `color-mix(in srgb, ${FILL} 40%, transparent)` }}>
                  <span aria-hidden className="block h-2 w-full rounded-full" style={{ background: FILL }} />
                  <p className="mt-1.5 truncate text-[10px] text-muted">{card.text}</p>
                </div>
              ))}
            </div>
          ))}
        </div>
      );
    case "rows":
      return (
        <div>
          {(part.title.trim() || part.icon) && (
            <div className="flex items-center gap-2">
              {part.icon && <ListIcon name={part.icon} className="size-4 shrink-0 text-accent" />}
              <Words text={part.title} width="40%" role="title" className="text-[13px] font-bold" />
            </div>
          )}
          <ul className="mt-3 flex flex-col divide-y divide-border">
            {part.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                <Words text={item.text} width="55%" className="truncate text-[12px]" />
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: TONE_COLOURS[item.tone] }} />
              </li>
            ))}
          </ul>
        </div>
      );
    default:
      return null;
  }
}

/** A part in its place: in a box of its own when `boxed`, half the width beside another half part from a small screen up. */
function Placed({ part, children }: { part: PreviewPart; children: ReactNode }) {
  return <div className={`min-w-0 ${part.half ? "" : "sm:col-span-2"} ${part.boxed ? "rounded-md border border-border p-4" : ""}`}>{children}</div>;
}

/**
 * An app preview (D916) on the site: a window (three dots and its bar) or a plain card, a sidebar from a medium screen up, and its parts in
 * a grid of two, a half part beside the next. Drawn on the server in the theme's colours, and the same in the builder. A screen reader is
 * told the owner's description of it, not each of its words; without one the words are read as they are.
 */
export function AppPreviewView({ block }: { block: AppPreviewBlock }) {
  if (block.parts.length === 0) return null;
  const side = block.side.filter((item) => item.text.trim());
  const described = block.alt.trim() !== "";
  const frame: CSSProperties = { boxShadow: "0 25px 50px -12px rgb(0 0 0 / 0.25)" };
  return (
    <div
      className="kz-app-preview overflow-hidden rounded-card border border-border bg-surface text-left"
      style={frame}
      {...(described ? { role: "img", "aria-label": block.alt } : {})}
    >
      {block.frame === "window" && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5" style={{ background: `color-mix(in srgb, ${FILL} 40%, transparent)` }}>
          {DOTS.map((colour) => (
            <span key={colour} aria-hidden className="size-3 shrink-0 rounded-full opacity-80" style={{ background: colour }} />
          ))}
          {block.bar.trim() &&
            (block.barTitle ? (
              <span data-kz-text="meta" className="ml-2 truncate text-[12px] font-semibold">
                {block.bar}
              </span>
            ) : (
              <span data-kz-text="meta" className="ml-3 truncate rounded-full bg-background px-3 py-0.5 text-[11px] text-muted">
                {block.bar}
              </span>
            ))}
        </div>
      )}
      <div className={`grid gap-4 p-5 ${side.length > 0 ? "md:flex" : ""}`}>
        {side.length > 0 && (
          <div className="hidden w-32 shrink-0 flex-col gap-1.5 md:flex">
            {block.sideTitle.trim() && (
              <p data-kz-text="title" className="px-2 text-[15px] font-bold">
                {block.sideTitle}
              </p>
            )}
            {side.map((item, i) => (
              <span
                key={item.id}
                className={`truncate rounded-md px-2 py-1.5 text-[13px] ${i === 0 ? "font-medium text-accent" : "text-muted"}`}
                style={i === 0 ? { background: ACCENT_TINT } : undefined}
              >
                {item.text}
              </span>
            ))}
          </div>
        )}
        <div className="grid min-w-0 flex-1 content-start gap-3 sm:grid-cols-2">
          {block.parts.map((part) => (
            <Placed key={part.id} part={part}>
              <Part part={part} />
            </Placed>
          ))}
        </div>
      </div>
    </div>
  );
}
