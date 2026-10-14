/** The classes the data pages share: the admin's tokens only (`admin.css`), no fixed colours, no one-off shadows. */
export const card = "rounded-lg border border-line bg-sunken p-4";
export const field = "min-h-10 rounded-md border border-line bg-card px-3 text-sm";
export const label = "text-sm font-medium";
export const hint = "text-xs text-muted";
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:opacity-40";
export const primary = `${button} bg-brand text-brand-ink`;
export const secondary = `${button} border border-edge bg-card hover:bg-sunken`;
export const link = "underline underline-offset-2";
export const tableShell = "overflow-x-auto rounded-lg border border-line bg-sunken";
export const th = "px-3 py-2 text-left font-medium";
export const td = "px-3 py-2 align-top";
