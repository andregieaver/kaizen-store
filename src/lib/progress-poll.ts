/**
 * One tick of an admin screen's progress poll (bloat review step 0.17). Pure. A hidden tab asks nothing. A screen with a `status` asks that
 * (a short fingerprint of what it waits for) and redraws only when the answer changed; a screen without one redraws on every visible tick.
 * `last` is kept by the caller between ticks.
 */
export async function progressTick(o: {
  visible: boolean;
  status?: () => Promise<string | null>;
  last: { value: string | null };
  refresh: () => void;
}): Promise<void> {
  if (!o.visible) return;
  if (!o.status) {
    o.refresh();
    return;
  }
  const now = await o.status().catch(() => null);
  // A failed ask is caught by the next tick.
  if (now === null) return;
  // The first answer: the page is already current.
  if (o.last.value === null) {
    o.last.value = now;
    return;
  }
  if (now !== o.last.value) {
    o.last.value = now;
    o.refresh();
  }
}
