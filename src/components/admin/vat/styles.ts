/** The platform VAT pages' shared classes (admin tokens only, D149). */
export const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal disabled:opacity-60";
export const label = "flex flex-col gap-1 text-sm font-medium";
export const hint = "font-normal text-muted";
export const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";

const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Europe/Oslo" });
/** A `yyyy-mm-dd` day for people ("3 Oct 2026"), or the text itself when it is not one. */
export const dayText = (day: string | null): string => {
  if (!day) return "";
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : date.format(d);
};
