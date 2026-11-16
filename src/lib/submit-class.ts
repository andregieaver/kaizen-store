/**
 * A submit button's look by variant (`SubmitButton`), for a caller that adds to it, such as a wide one-press step (round 18, D657), rather
 * than replacing it. A plain module, so server components can call it: the button itself is a client component.
 */
export function submitClass(variant: "primary" | "secondary" = "primary"): string {
  return variant === "primary"
    ? "min-h-10 rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink disabled:opacity-40"
    : "min-h-10 rounded-pill border border-edge bg-card px-4 text-sm disabled:opacity-40";
}
