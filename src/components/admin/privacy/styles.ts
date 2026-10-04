/** The privacy pages' shared classes and day formatting (admin tokens only, D149). */
export const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm font-normal disabled:opacity-60";
export const label = "flex flex-col gap-1 text-sm font-medium";
export const hint = "font-normal text-muted";
export const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";
export const link = "underline";
/** A button that is a plain form submit (a download is a POST the browser follows, so it cannot be an `ActionForm`). */
export const buttonPrimary = "inline-flex min-h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background";
export const buttonSecondary = "inline-flex min-h-10 items-center rounded-md border border-border bg-background px-4 text-sm";
/** Overdue text: red, and always with words beside it (never colour alone). */
export const alertText = "text-red-700 dark:text-red-400";

/** A day for people ("3 Oct 2026"), in the store's own time zone for an instant and as it is for a `yyyy-mm-dd` day. */
export function dayText(value: Date | string | null | undefined, timeZone = "Europe/Oslo"): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(`${value}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(d);
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone }).format(d);
}

/** "12 days left", "Due today", "3 days overdue": the clock in words. */
export function clockWords(daysLeft: number | null, overdue: boolean): string {
  if (daysLeft === null) return "";
  if (overdue) {
    const days = Math.max(1, Math.abs(daysLeft));
    return `${days} ${days === 1 ? "day" : "days"} overdue`;
  }
  if (daysLeft <= 0) return "Due today";
  return `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`;
}
