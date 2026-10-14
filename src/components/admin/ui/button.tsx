import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";

/**
 * The admin's buttons (docs/admin-style.md 5.6), in the colour roles only: one `main` action a page, `strong` for a card's own
 * conclusion, `secondary` for every other action, `quiet` in toolbars and rows, `icon` for a round button with a name, `link` for
 * "All invoices ›" and `danger` for deleting, ending or refusing. Every kind is a pill (the link has no shape), gets the admin's
 * one focus ring (`admin.css`) and keeps its shape at 45 % when disabled. A `<button>` is `Button`, a link is `ButtonLink`.
 */

export const BUTTON_KINDS = ["main", "strong", "secondary", "quiet", "icon", "link", "danger"] as const;
export type ButtonKind = (typeof BUTTON_KINDS)[number];

/** Its height: `header` 44 px (the page header, the top bar), `card` 36 px (in a card, the default), `dense` 32 px (tables, toolbars). */
export const BUTTON_SIZES = ["header", "card", "dense"] as const;
export type ButtonSize = (typeof BUTTON_SIZES)[number];

const KIND: Record<ButtonKind, string> = {
  main: "bg-brand text-brand-ink hover:bg-brand-hover hover:-translate-y-px motion-reduce:hover:translate-y-0",
  strong: "bg-inverse text-inverse-ink hover:opacity-90",
  secondary: "border border-edge bg-card text-ink hover:bg-sunken",
  quiet: "text-ink-2 hover:bg-sunken hover:text-ink",
  icon: "bg-card text-ink hover:bg-sunken",
  link: "text-ink-2 hover:text-ink",
  danger: "bg-danger-soft text-danger-text hover:bg-danger-line",
};

const HEIGHT: Record<ButtonSize, string> = { header: "h-11 px-5", card: "h-9 px-4", dense: "h-8 px-3" };
const ROUND: Record<ButtonSize, string> = { header: "size-11", card: "size-10", dense: "size-8" };

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap text-body-strong select-none disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0";

/** The classes of a button of this kind and size; `full` makes it as wide as its box (a `strong` button in a card, a phone's main action). */
export function buttonClass(kind: ButtonKind = "secondary", size: ButtonSize = "card", full = false): string {
  const shape = kind === "link" ? "gap-1" : kind === "icon" ? `rounded-pill ${ROUND[size]}` : `rounded-pill ${HEIGHT[size]}`;
  return [BASE, shape, KIND[kind], full ? "w-full" : ""].filter(Boolean).join(" ");
}

type Common = {
  kind?: ButtonKind;
  size?: ButtonSize;
  full?: boolean;
  /** An icon before the words (an `icon` button is only its icon, named by `aria-label`). */
  icon?: ReactNode;
};

/** The words and what goes with them: an icon before, the chevron after a `link`. */
function inside(kind: ButtonKind, icon: ReactNode, children: ReactNode) {
  if (kind === "icon") return icon ?? children;
  return (
    <>
      {icon}
      {children}
      {kind === "link" && <ChevronRight aria-hidden className="size-4" />}
    </>
  );
}

export type ButtonProps = Common & ButtonHTMLAttributes<HTMLButtonElement> & (
  | { kind: "icon"; "aria-label": string }
  | { kind?: Exclude<ButtonKind, "icon"> }
);

export function Button({ kind = "secondary", size = "card", full, icon, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={[buttonClass(kind, size, full), className].filter(Boolean).join(" ")} {...rest}>
      {inside(kind, icon, children)}
    </button>
  );
}

export type ButtonLinkProps = Common & ComponentProps<typeof Link> & (
  | { kind: "icon"; "aria-label": string }
  | { kind?: Exclude<ButtonKind, "icon"> }
);

export function ButtonLink({ kind = "secondary", size = "card", full, icon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={[buttonClass(kind, size, full), className].filter(Boolean).join(" ")} {...rest}>
      {inside(kind, icon, children)}
    </Link>
  );
}
