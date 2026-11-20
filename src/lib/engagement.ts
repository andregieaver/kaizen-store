/**
 * How engaged a subscriber is, in words (email plan M2.8): from their latest press on a link in the store's emails (broadcasts since M1.3,
 * flows since D767), kept 180 days. The store keeps no opens (M0.1 b), so presses are the one honest signal. Pure.
 */

export const ENGAGEMENT_LEVELS = ["active", "warm", "cooling", "new", "asleep"] as const;
export type EngagementLevel = (typeof ENGAGEMENT_LEVELS)[number];

const DAY = 86_400_000;

/**
 * A subscriber's level: pressed a link in the last 30 days (active), 90 (warm) or 180 (cooling); else joined in the last 30 days and not yet
 * pressed one (new); else no press in the 180 days presses are kept (asleep, the sunset recipe's readers).
 */
export function engagementLevel(joinedAt: string, lastClickAt: string | null, now: Date): EngagementLevel {
  const ago = (at: string) => (now.getTime() - new Date(at).getTime()) / DAY;
  if (lastClickAt) {
    const days = ago(lastClickAt);
    if (days <= 30) return "active";
    if (days <= 90) return "warm";
    if (days <= 180) return "cooling";
  }
  return ago(joinedAt) <= 30 ? "new" : "asleep";
}
