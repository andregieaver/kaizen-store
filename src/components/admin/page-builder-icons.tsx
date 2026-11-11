"use client";

import { ROW_LAYOUTS, type BlockType, type RowLayout } from "@/lib/page-content";
import { ThemeStoreIcon } from "./theme-store-fields";

/**
 * The page builder's icons (D43, CODE-06): each component's on the palette and in the canvas's stand-ins, drawn in SVG at the
 * text's colour. Moved out of `page-builder.tsx` as they were.
 */

export function BlockIcon({ type }: { type: BlockType }) {
  switch (type) {
    case "columns":
      return <LayoutPreview layout="2" />;
    case "image":
      return <ImageIcon />;
    case "beforeAfter":
      return <BeforeAfterIcon />;
    case "animation":
      return <AnimationIcon />;
    case "timeline":
      return <TimelineIcon />;
    case "heading":
      return <LetterIcon letter="H" bold />;
    case "button":
      return <ButtonIcon />;
    case "contentGrid":
      return <GridIcon />;
    case "product":
      return <ProductIcon />;
    case "site":
      return <SiteIcon />;
    case "menu":
      return <MenuIcon />;
    case "search":
      return <SearchIcon />;
    case "plans":
      return <PlansIcon />;
    case "domainSearch":
      return <DomainSearchIcon />;
    case "themeStore":
      return <ThemeStoreIcon />;
    case "customField":
      return <FieldsIcon />;
    case "fieldLoop":
      return <LoopIcon />;
    case "storePart":
      return <ShopIcon />;
    case "separator":
      return <SeparatorIcon />;
    case "dualButton":
      return <DualButtonIcon />;
    case "accordion":
      return <AccordionIcon />;
    case "tabs":
      return <TabsIcon />;
    case "faq":
      return <LetterIcon letter="?" bold />;
    case "video":
      return <VideoIcon />;
    case "html":
      return <HtmlIcon />;
    case "testimonials":
      return <TestimonialsIcon />;
    case "socialLinks":
      return <SocialIcon />;
    case "iconList":
      return <IconListIcon />;
    case "table":
      return <TableIcon />;
    case "brands":
      return <BrandsIcon />;
    case "gallery":
      return <GalleryIcon />;
    case "emailForm":
      return <FormIcon />;
    case "newsletter":
      return <NewsletterIcon />;
    case "instagram":
      return <InstagramIcon />;
    default:
      return <LetterIcon letter="T" />;
  }
}

function FormIcon() {
  return (
    <span aria-hidden className="flex h-9 flex-col justify-center gap-1 rounded-sm bg-foreground/75 px-2 text-background">
      <span className="h-1.5 w-full rounded-[2px] border border-current" />
      <span className="h-2.5 w-full rounded-[2px] border border-current" />
      <span className="h-1.5 w-3 rounded-[2px] bg-current" />
    </span>
  );
}

function NewsletterIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </svg>
    </span>
  );
}

function TableIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <span className="grid h-6 w-10 grid-cols-3 grid-rows-3 gap-0.5">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={`rounded-[1px] bg-current ${i < 3 ? "" : "opacity-50"}`} />
        ))}
      </span>
    </span>
  );
}

function IconListIcon() {
  return (
    <span aria-hidden className="flex h-9 flex-col justify-center gap-1 rounded-sm bg-foreground/75 px-2 text-background">
      {[0, 1, 2].map((line) => (
        <span key={line} className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-current" />
          <span className="h-0.5 w-5 bg-current opacity-60" />
        </span>
      ))}
    </span>
  );
}

function SocialIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center gap-1 rounded-sm bg-foreground/75 text-background">
      <span className="size-2.5 rounded-full bg-current" />
      <span className="size-2.5 rounded-full bg-current" />
      <span className="size-2.5 rounded-full bg-current" />
    </span>
  );
}

/** A line with three events along it. */
function TimelineIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M6 3v18" />
        <circle cx="6" cy="6" r="2" fill="currentColor" />
        <circle cx="6" cy="12" r="2" fill="currentColor" />
        <circle cx="6" cy="18" r="2" fill="currentColor" />
        <path d="M11 6h9M11 12h7M11 18h9" />
      </svg>
    </span>
  );
}

/** Two halves of a picture with the slider between them. */
function BeforeAfterIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <rect x="3" y="5" width="18" height="14" rx="1.5" />
        <path d="M12 3v18" />
        <path d="M3 5h9v14H3z" fill="currentColor" fillOpacity="0.35" stroke="none" />
        <path d="m9.5 12-1.5 1.5M9.5 12 8 10.5M14.5 12l1.5 1.5M14.5 12l1.5-1.5" />
      </svg>
    </span>
  );
}

/** A picture in motion: a shape with the lines its movement leaves. */
function AnimationIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M3 8h4M2 12h5M3 16h4" />
        <path d="m11 6 9 6-9 6z" fill="currentColor" fillOpacity="0.35" />
      </svg>
    </span>
  );
}

function GalleryIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <rect x="3" y="4" width="8" height="7" rx="1" />
        <rect x="13" y="4" width="8" height="7" rx="1" />
        <rect x="3" y="13" width="8" height="7" rx="1" />
        <path d="M15 14.5v4l3.5-2z" fill="currentColor" />
      </svg>
    </span>
  );
}

function BrandsIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <rect x="3" y="5" width="7" height="6" rx="1" />
        <rect x="14" y="5" width="7" height="6" rx="1" />
        <path d="M4.5 16h4M15.5 16h4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function TestimonialsIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M4 5h16v11H9l-5 4z" />
        <path d="M8 9.5h2M8 12h6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function HtmlIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
      </svg>
    </span>
  );
}

function VideoIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m10 9 5 3-5 3z" fill="currentColor" />
      </svg>
    </span>
  );
}

function TabsIcon() {
  return (
    <span aria-hidden className="flex h-9 flex-col justify-center rounded-sm bg-foreground/75 px-2 text-background">
      <span className="flex gap-0.5">
        <span className="h-2 w-5 rounded-t-sm border-2 border-b-0 border-current" />
        <span className="mt-1 h-1 w-4 rounded-t-sm bg-current opacity-60" />
        <span className="mt-1 h-1 w-4 rounded-t-sm bg-current opacity-60" />
      </span>
      <span className="h-3.5 w-full rounded-sm rounded-tl-none border-2 border-current" />
    </span>
  );
}

function AccordionIcon() {
  return (
    <span aria-hidden className="flex h-9 flex-col justify-center gap-0.5 rounded-sm bg-foreground/75 px-3 text-background">
      {["▾", "▸", "▸"].map((mark, i) => (
        <span key={i} className="flex items-center justify-between border-b border-current/40 text-[8px] leading-[10px]">
          <span className="h-0.5 w-6 rounded-full bg-current" />
          {mark}
        </span>
      ))}
    </span>
  );
}

function DualButtonIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center gap-1 rounded-sm bg-foreground/75 text-background">
      <span className="h-3.5 w-5 rounded-full bg-current" />
      <span className="h-3.5 w-5 rounded-full border-2 border-current" />
    </span>
  );
}

function SeparatorIcon() {
  return (
    <span aria-hidden className="flex h-9 flex-col items-center justify-center gap-1 rounded-sm bg-foreground/75 text-background">
      <span className="h-0.5 w-8 rounded-full bg-current opacity-50" />
      <span className="h-0.5 w-10 rounded-full bg-current" />
      <span className="h-0.5 w-8 rounded-full bg-current opacity-50" />
    </span>
  );
}

function GridIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <span className="grid grid-cols-3 gap-0.5">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="size-2 rounded-[2px] bg-current" />
        ))}
      </span>
    </span>
  );
}

function ButtonIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <span className="rounded-full border-2 border-current px-2 text-[10px] leading-4 font-medium">{"OK"}</span>
    </span>
  );
}

function ImageIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.5" />
        <path d="M21 16l-5-5-8 8" />
      </svg>
    </span>
  );
}

function LetterIcon({ letter, bold = false }: { letter: string; bold?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-9 items-center justify-center rounded-sm bg-foreground/75 font-serif text-lg text-background ${bold ? "font-bold" : ""}`}
    >
      {letter}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------

const ICONS = {
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </g>
  ),
  wrench: <path d="M14.7 6.3a4 4 0 0 0-5.1 5.1L3.5 17.5a1.4 1.4 0 0 0 2 2l6.1-6.1a4 4 0 0 0 5.1-5.1l-2.4 2.4-2.1-.4-.4-2.1z" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </>
  ),
  flask: <path d="M9 3h6M10 3v6L4.5 18.2A1.6 1.6 0 0 0 5.9 20.6h12.2a1.6 1.6 0 0 0 1.4-2.4L14 9V3M7.5 15h9" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />,
};

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name]}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Menu components (D85)
// ---------------------------------------------------------------------------

function DomainSearchIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
      </svg>
    </span>
  );
}

function PlansIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="5" height="14" rx="1" />
        <rect x="9.5" y="3" width="5" height="16" rx="1" />
        <rect x="16" y="7" width="5" height="12" rx="1" />
      </svg>
    </span>
  );
}

function SearchIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="6" />
        <path d="m20 20-4.5-4.5" />
      </svg>
    </span>
  );
}

function ShopIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9l1.5-5h13L20 9M4 9h16a2.7 2.7 0 0 1-5.3 0 2.7 2.7 0 0 1-5.4 0A2.7 2.7 0 0 1 4 9M5.5 12v8h13v-8M10 20v-5h4v5" />
      </svg>
    </span>
  );
}

function MenuIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h10M4 18h13" />
      </svg>
    </span>
  );
}

function LoopIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="8" height="7" rx="1.5" />
        <rect x="13" y="4" width="8" height="7" rx="1.5" />
        <rect x="3" y="14" width="8" height="6" rx="1.5" />
        <rect x="13" y="14" width="8" height="6" rx="1.5" />
      </svg>
    </span>
  );
}

function FieldsIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M4 10h16M10 10v9" />
      </svg>
    </span>
  );
}

function SiteIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18" />
      </svg>
    </span>
  );
}

function ProductIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 7h12l-1 13H7L6 7z" />
        <path d="M9 7a3 3 0 0 1 6 0" />
      </svg>
    </span>
  );
}

/** A row's columns as bars, like a small picture of the row. */
export function LayoutPreview({ layout }: { layout: RowLayout }) {
  return (
    <span aria-hidden className="flex h-9 gap-1">
      {ROW_LAYOUTS[layout].widths.map((width, index) => (
        // A column as wide as what it holds (0, D80) shows as a narrow bar.
        <span key={index} style={width ? { flexGrow: width } : { flexBasis: "0.75rem" }} className={`${width ? "basis-0" : "shrink-0"} rounded-sm bg-foreground/75`} />
      ))}
    </span>
  );
}

/** A camera's outline (the Instagram feed, D543), drawn as the other tiles' pictures are; not Instagram's own logo. */
function InstagramIcon() {
  return (
    <span aria-hidden className="flex h-9 items-center justify-center rounded-sm bg-foreground/75 text-background">
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

