import {
  Accessibility,
  Activity,
  BadgePercent,
  Banknote,
  BedDouble,
  Blocks,
  BookOpen,
  Bot,
  Braces,
  Building,
  Calculator,
  ChartColumn,
  ChartPie,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Coins,
  Container,
  Cookie,
  DoorOpen,
  FileClock,
  FilePen,
  Flag,
  Files,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Gauge,
  Gift,
  Globe,
  Heart,
  House,
  Image as ImageIcon,
  Import,
  Inbox,
  Landmark,
  Languages,
  LayoutDashboard,
  LayoutTemplate,
  Layers,
  Library,
  LifeBuoy,
  Link2,
  ListFilter,
  ListPlus,
  Lock,
  Mail,
  MailCheck,
  Map as MapIcon,
  Menu,
  MessageSquare,
  MessageSquareText,
  MousePointerClick,
  Newspaper,
  Paintbrush,
  PanelBottom,
  PanelsTopLeft,
  PanelTop,
  Percent,
  Plug,
  Power,
  Puzzle,
  Receipt,
  ReceiptText,
  Recycle,
  Repeat,
  Rss,
  Scale,
  Search,
  Send,
  Settings,
  Settings2,
  Share2,
  ShieldCheck,
  ShoppingCart,
  Signpost,
  SlidersHorizontal,
  Sparkles,
  Star,
  Store,
  Target,
  ThumbsUp,
  Ticket,
  ToggleRight,
  TrendingUp,
  Truck,
  Type,
  Undo2,
  UserCheck,
  UserCog,
  UsersRound,
  Video,
  Wallet,
  Warehouse,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * The small icons beside the admin's navigation (D144): one stroke, drawn at the text's size in its colour. Only what the navigation
 * names; a new one is a key here. The sections' own are drawn here (`PATHS`); each page in a sidebar and on a page of cards has one too
 * (D454: a picture beside the word is found again faster than the word alone), from lucide (`PAGE_ICONS`), at the same stroke. Settings'
 * cog is lucide's: the one drawn here read as a sun.
 */
const PATHS = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  // Themes (D285): a painter's palette.
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.5 0-1-.8-1.4-.8-2.3 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.6 17 3 12 3Z" />
      <circle cx="7.5" cy="11.5" r="1" />
      <circle cx="9.5" cy="7.5" r="1" />
      <circle cx="14.5" cy="7.5" r="1" />
    </>
  ),
  "shopping-bag": (
    <>
      <path d="M5 8h14l-1 12H6L5 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
    </>
  ),
  "credit-card": (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  package: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" />
      <path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z" />
      <circle cx="8" cy="8" r="1.5" />
    </>
  ),
  megaphone: <path d="M3 10v4a1 1 0 0 0 1 1h3l8 4V5L7 9H4a1 1 0 0 0-1 1ZM19 9.5a4 4 0 0 1 0 5" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  chart: <path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6M20 16V6" />,
  bell: <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2ZM10 21a2 2 0 0 0 4 0" />,
  // Support (D216): a speech bubble.
  chat: <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1ZM8 10h8M8 13h5" />,
} as const;

/** The pages' icons (and Settings'), by a name that says what it shows, never a product's or a brand's mark. */
const PAGE_ICONS = {
  accessibility: Accessibility,
  activity: Activity,
  "badge-percent": BadgePercent,
  banknote: Banknote,
  bed: BedDouble,
  blocks: Blocks,
  "book-open": BookOpen,
  bot: Bot,
  braces: Braces,
  building: Building,
  calculator: Calculator,
  "chart-column": ChartColumn,
  "chart-pie": ChartPie,
  "clipboard-check": ClipboardCheck,
  "clipboard-list": ClipboardList,
  clock: Clock,
  coins: Coins,
  cog: Settings,
  container: Container,
  cookie: Cookie,
  dashboard: LayoutDashboard,
  door: DoorOpen,
  "file-clock": FileClock,
  "file-pen": FilePen,
  "file-spreadsheet": FileSpreadsheet,
  "file-text": FileText,
  files: Files,
  flag: Flag,
  flask: FlaskConical,
  gauge: Gauge,
  gift: Gift,
  globe: Globe,
  heart: Heart,
  house: House,
  image: ImageIcon,
  import: Import,
  inbox: Inbox,
  landmark: Landmark,
  languages: Languages,
  layers: Layers,
  "layout-template": LayoutTemplate,
  library: Library,
  "life-buoy": LifeBuoy,
  link: Link2,
  "list-filter": ListFilter,
  "list-plus": ListPlus,
  lock: Lock,
  mail: Mail,
  "mail-check": MailCheck,
  map: MapIcon,
  menu: Menu,
  "message-square": MessageSquare,
  "message-text": MessageSquareText,
  newspaper: Newspaper,
  paintbrush: Paintbrush,
  "panel-bottom": PanelBottom,
  "panel-top": PanelTop,
  "panels-top-left": PanelsTopLeft,
  percent: Percent,
  plug: Plug,
  pointer: MousePointerClick,
  power: Power,
  puzzle: Puzzle,
  receipt: Receipt,
  "receipt-text": ReceiptText,
  recycle: Recycle,
  repeat: Repeat,
  rss: Rss,
  scale: Scale,
  search: Search,
  send: Send,
  "settings-2": Settings2,
  share: Share2,
  "shield-check": ShieldCheck,
  cart: ShoppingCart,
  signpost: Signpost,
  sliders: SlidersHorizontal,
  sparkles: Sparkles,
  star: Star,
  store: Store,
  target: Target,
  "thumbs-up": ThumbsUp,
  ticket: Ticket,
  toggle: ToggleRight,
  "trending-up": TrendingUp,
  truck: Truck,
  type: Type,
  undo: Undo2,
  "user-check": UserCheck,
  "user-cog": UserCog,
  "users-round": UsersRound,
  video: Video,
  wallet: Wallet,
  warehouse: Warehouse,
  workflow: Workflow,
  zap: Zap,
} satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof PATHS | keyof typeof PAGE_ICONS;

/** Every icon's name, for the tests that hold the navigation to names that exist. */
export const NAV_ICON_NAMES = [...Object.keys(PATHS), ...Object.keys(PAGE_ICONS)] as NavIconName[];

export function NavIcon({ name, className = "size-4" }: { name: NavIconName; className?: string }) {
  if (name in PAGE_ICONS) {
    const Icon = PAGE_ICONS[name as keyof typeof PAGE_ICONS];
    return <Icon aria-hidden className={`${className} shrink-0`} strokeWidth={1.75} />;
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`${className} shrink-0`} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name as keyof typeof PATHS]}
    </svg>
  );
}
