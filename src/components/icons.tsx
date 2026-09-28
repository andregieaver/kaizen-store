/** The storefront's few icons, drawn inline so they cost no request. */
const PATHS = {
  bag: "M6 8h12l-1 12H7L6 8zm3 0V6a3 3 0 016 0v2",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0",
  home: "M4 11l8-7 8 7v9h-5v-6H9v6H4v-9z",
  menu: "M4 7h16M4 12h16M4 17h16",
  globe: "M12 21a9 9 0 100-18 9 9 0 000 18zm-9-9h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z",
  chevron: "M6 9l6 6 6-6",
  heart: "M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0112 7.3a4.3 4.3 0 017.5 2.5C19.5 15.4 12 20 12 20z",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zm9 2l-4-4",
  chat: "M4 5h16v11H10l-5 4v-4H4V5z",
  mic: "M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3zm-6 8a6 6 0 0012 0m-6 6v4",
  send: "M4 12l16-8-6 16-2.5-6.5L4 12z",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = "size-6" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
