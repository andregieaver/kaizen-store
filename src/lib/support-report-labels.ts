/**
 * A support report's units in English (bloat review step 2.50): beside `support-reports.ts`, whose `rateWords()` and `durationFigureWords()`
 * say them to the AI manager and the platform with no language, and which the reports' views (client parts) import too, so the `support`
 * catalogue takes its `units` from here and neither side brings the catalogue. Imports nothing.
 */

export const SUPPORT_UNITS = {
  seconds: "{n} s",
  minutesSeconds: "{m} min {n} s",
  minutes: "{n} min",
  hoursMinutes: "{h} h {n} min",
  hours: "{n} h",
  daysHours: "{d} d {n} h",
  days: "{n} d",
  noneYet: "None yet",
  needed: "{n} of the {min} needed",
};
