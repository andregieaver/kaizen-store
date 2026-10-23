import { fillWords } from "@/lib/admin-fill";
import { toneWords } from "@/lib/support-inbox-text";
import { toneHistory } from "@/lib/support-tone";

import { useAdminText } from "../admin-text";

/** A tone: a dot in its band's colour and the band in words beside it, or for screen readers only when `compact` (never colour alone). */
export function ToneDot({
  score,
  compact = false,
}: {
  score: number | null;
  compact?: boolean;
}) {
  const t = useAdminText("support");
  const tone = toneWords(score, t.lib);
  if (!tone) return null;
  const label = fillWords(t.tone.label, { tone: tone.words });
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted"
      title={label}
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full"
        style={{ background: `var(--tone-${tone.level})` }}
      />
      <span className={compact ? "sr-only" : undefined}>{label}</span>
    </span>
  );
}

/**
 * The conversation's tone over time (2.4, Context): the rolling value after each scored customer message, drawn on the admin's tokens
 * between −100 and 100, with its data table behind it (every chart has one). Nothing while fewer than two messages are scored.
 */
export function ToneChart({
  messages,
}: {
  messages: { seq: number; author: string; tone: number | null; at: string }[];
}) {
  const t = useAdminText("support");
  const w = t.tone;
  const words = (score: number) => toneWords(score, t.lib)!;
  const customer = messages.filter((m) => m.author === "customer");
  const scored = customer.filter((m) => m.tone !== null);
  const history = toneHistory(customer.map((m) => m.tone));
  if (history.length < 2) return null;
  const width = 240;
  const height = 80;
  const x = (i: number) =>
    history.length === 1
      ? width / 2
      : (i / (history.length - 1)) * (width - 8) + 4;
  const y = (score: number) => height / 2 - (score / 100) * (height / 2 - 4);
  const points = history
    .map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`)
    .join(" ");
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">{w.chartTitle}</figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-20 w-full"
        role="img"
        aria-label={fillWords(w.chartLabel, {
          tone: words(history[history.length - 1]).words,
        })}
      >
        <line
          x1="0"
          x2={width}
          y1={height / 2}
          y2={height / 2}
          stroke="var(--color-border)"
          strokeDasharray="3 3"
        />
        <polyline
          points={points}
          fill="none"
          stroke="var(--chart-1, currentColor)"
          strokeWidth="2"
        />
        {history.map((value, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(value)}
            r="2.5"
            fill={`var(--tone-${words(value).level})`}
          />
        ))}
      </svg>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">{w.figures}</summary>
        <table className="mt-1 w-full">
          <thead>
            <tr className="text-left text-muted">
              <th scope="col">{w.message}</th>
              <th scope="col">{w.score}</th>
              <th scope="col">{w.then}</th>
            </tr>
          </thead>
          <tbody>
            {scored.map((m, i) => (
              <tr key={m.seq}>
                <td>#{m.seq}</td>
                <td>{m.tone}</td>
                <td>{words(history[i]).words}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
