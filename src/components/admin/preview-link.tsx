/** A preview of a store or a design profile, opened in a new window (`target="_blank" rel="noopener"`), named for screen readers. */
export function PreviewLink({ href, label, title }: { href: string; label: string; title: string }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="flex min-h-10 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-surface">
      {label}
      <span className="sr-only"> of {title} (opens in a new window)</span>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 5h5v5M19 5l-8 8M10 5H5v14h14v-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
