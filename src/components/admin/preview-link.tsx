import { fillWords } from "@/lib/admin-fill";
import { platformSiteEn } from "@/lib/admin-messages/platform-site.en";

/** A preview of a store or a design profile, opened in a new window (`target="_blank" rel="noopener"`), named for screen readers. */
export function PreviewLink({ href, label, title, of = platformSiteEn.preview.of }: { href: string; label: string; title: string; of?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="flex min-h-10 items-center gap-1.5 rounded-pill border border-edge px-3 text-sm hover:bg-sunken">
      {label}
      <span className="sr-only"> {fillWords(of, { title })}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 5h5v5M19 5l-8 8M10 5H5v14h14v-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
