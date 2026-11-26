import { GripVertical } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

/**
 * The handle a sortable row of Projects and checklists (D903) is dragged by, or moved with the keyboard: a task, a section, a status.
 * `handle` is the sortable's activator ref; its attributes and listeners are spread on as the rest.
 */
export function DragHandle({ handle, label, className = "", ...rest }: { handle: (element: HTMLElement | null) => void; label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" ref={handle} {...rest} aria-label={label} className={`shrink-0 cursor-grab touch-none text-faint hover:text-ink-2 ${className}`}>
      <GripVertical className="size-4" aria-hidden />
    </button>
  );
}
