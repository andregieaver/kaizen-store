/**
 * The visitor's first visit in the last 30 days (wave 5 unit I3, D303, `docs/wave-5-marketing.md` 12.4), kept only for a visitor who allowed
 * statistics cookies: a first-party cookie `kaizen_touch_{store}` with the raw tags and referring host of that visit and its day, no id. The
 * server classifies it as a visit's channel is classified and keeps it on today's visit (`recordTouch()`). Without consent nothing is kept,
 * and D152's visit counting stays cookieless. Pure, for the keeper and its tests.
 */

import { campaignParams, referrerHost } from "./visit-beacon";

export const TOUCH_DAYS = 30;
export const touchCookieName = (storeId: string) => `kaizen_touch_${storeId}`;

export type Touch = { source?: string; medium?: string; campaign?: string; ref?: string; day: string };

/** What the current page load says about where the visitor came from, or null when it says nothing (a visit typed or within the site). */
export function touchOf(search: string, referrer: string | null | undefined, ownHost: string, day: string): Touch | null {
  const tags = campaignParams(search);
  const ref = referrerHost(referrer, ownHost);
  if (!tags.utm_source && !tags.utm_medium && !tags.utm_campaign && !ref) return null;
  return {
    ...(tags.utm_source ? { source: tags.utm_source } : {}),
    ...(tags.utm_medium ? { medium: tags.utm_medium } : {}),
    ...(tags.utm_campaign ? { campaign: tags.utm_campaign } : {}),
    ...(ref ? { ref } : {}),
    day,
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PART = /^[^|]{0,120}$/;

/** The cookie's value: five fields joined, each encoded. */
export const encodeTouch = (t: Touch) => [t.source ?? "", t.medium ?? "", t.campaign ?? "", t.ref ?? "", t.day].map(encodeURIComponent).join("|");

export function decodeTouch(value: string | null | undefined): Touch | null {
  if (!value) return null;
  const parts = value.split("|").map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return "";
    }
  });
  if (parts.length !== 5 || !DAY.test(parts[4]) || !parts.every((p) => PART.test(p))) return null;
  const [source, medium, campaign, ref, day] = parts;
  return { ...(source ? { source } : {}), ...(medium ? { medium } : {}), ...(campaign ? { campaign } : {}), ...(ref ? { ref } : {}), day };
}

/** Days between two `YYYY-MM-DD` days. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The touch to keep now: the kept one while it is younger than 30 days, else this page load's if it says anything. */
export function keepTouch(kept: Touch | null, current: Touch | null, today: string): Touch | null {
  if (kept && daysBetween(kept.day, today) < TOUCH_DAYS && daysBetween(kept.day, today) >= 0) return kept;
  return current;
}
