import {
  ArrowRight,
  Award,
  Baby,
  Bike,
  Book,
  Calendar,
  Camera,
  Car,
  Check,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock,
  Coffee,
  CreditCard,
  Droplet,
  Flame,
  Gift,
  Globe,
  GraduationCap,
  Headphones,
  Heart,
  House,
  Info,
  Leaf,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Minus,
  Mountain,
  Music,
  Package,
  Paintbrush,
  PawPrint,
  Percent,
  Phone,
  Plane,
  Plus,
  Recycle,
  RotateCcw,
  Scissors,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Smile,
  Snowflake,
  Sparkles,
  Sprout,
  Star,
  Store,
  Sun,
  Tag,
  ThumbsUp,
  Trophy,
  Truck,
  User,
  Users,
  Utensils,
  Wallet,
  Waves,
  Wifi,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import type { CSSProperties } from "react";

import type { IconName } from "@/lib/icons";

const DRAWINGS: Record<IconName, LucideIcon> = {
  check: Check,
  circleCheck: CircleCheck,
  x: X,
  plus: Plus,
  minus: Minus,
  arrowRight: ArrowRight,
  chevronRight: ChevronRight,
  star: Star,
  heart: Heart,
  thumbsUp: ThumbsUp,
  smile: Smile,
  sparkles: Sparkles,
  award: Award,
  trophy: Trophy,
  truck: Truck,
  package: Package,
  gift: Gift,
  rotateCcw: RotateCcw,
  shieldCheck: ShieldCheck,
  lock: Lock,
  creditCard: CreditCard,
  wallet: Wallet,
  tag: Tag,
  percent: Percent,
  shoppingBag: ShoppingBag,
  shoppingCart: ShoppingCart,
  store: Store,
  house: House,
  clock: Clock,
  calendar: Calendar,
  mapPin: MapPin,
  phone: Phone,
  mail: Mail,
  messageCircle: MessageCircle,
  headphones: Headphones,
  globe: Globe,
  info: Info,
  circleHelp: CircleHelp,
  circleAlert: CircleAlert,
  users: Users,
  user: User,
  leaf: Leaf,
  sprout: Sprout,
  recycle: Recycle,
  droplet: Droplet,
  sun: Sun,
  snowflake: Snowflake,
  flame: Flame,
  zap: Zap,
  coffee: Coffee,
  utensils: Utensils,
  scissors: Scissors,
  wrench: Wrench,
  paintbrush: Paintbrush,
  camera: Camera,
  music: Music,
  book: Book,
  graduationCap: GraduationCap,
  car: Car,
  bike: Bike,
  plane: Plane,
  mountain: Mountain,
  waves: Waves,
  pawPrint: PawPrint,
  baby: Baby,
  wifi: Wifi,
};

/** An icon list's icon (D91), in the current colour; decorative, as the text beside it says what it means. */
export function ListIcon({ name, className, style, gradient }: { name: IconName; className?: string; style?: CSSProperties; gradient?: IconGradient }) {
  const Drawing = DRAWINGS[name] ?? Check;
  if (!gradient) return <Drawing aria-hidden focusable={false} className={className} style={style} strokeWidth={2} />;
  // A gradient is an SVG paint: its definition sits beside the icon (taking no room) and the icon's strokes use it.
  const id = gradientId(gradient);
  const turn = (gradient.angle * Math.PI) / 180;
  const dx = Math.sin(turn);
  const dy = -Math.cos(turn);
  const stops = gradient.colors;
  return (
    <>
      <svg aria-hidden focusable={false} width="0" height="0" className="absolute">
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={12 - 12 * dx} y1={12 - 12 * dy} x2={12 + 12 * dx} y2={12 + 12 * dy}>
            {stops.map((color, index) => (
              <stop key={index} offset={stops.length === 1 ? 0 : index / (stops.length - 1)} stopColor={color} />
            ))}
          </linearGradient>
        </defs>
      </svg>
      <Drawing aria-hidden focusable={false} className={className} style={style} strokeWidth={2} stroke={`url(#${id})`} />
    </>
  );
}

/** An icon's gradient: its colours and angle. */
export type IconGradient = { colors: string[]; angle: number };

/** A name for a gradient's definition, from what it says, so equal gradients share one and different ones never clash. */
const gradientId = (gradient: IconGradient) => `icon-gradient-${gradient.angle}-${gradient.colors.map((c) => c.replace("#", "")).join("")}`;
