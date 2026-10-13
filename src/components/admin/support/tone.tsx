import { toneWords } from "@/lib/support-inbox-text";

/** A tone: a dot in its band's colour and the band in words beside it, or for screen readers only when `compact` (never colour alone). */
export function ToneDot({ score, compact = false }: { score: number | null; compact?: boolean }) {
  const tone = toneWords(score);
  if (!tone) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted" title={`Tone: ${tone.words}`}>
      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: `var(--tone-${tone.level})` }} />
      <span className={compact ? "sr-only" : undefined}>Tone: {tone.words}</span>
    </span>
  );
}
