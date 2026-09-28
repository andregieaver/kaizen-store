import type { AvatarView } from "@/lib/avatar";

/**
 * Someone's profile picture (D97): their initials, with their own picture
 * or Gravatar over them. The proxy answers an empty picture when there is
 * no Gravatar, so the initials show through without script. Decorative:
 * their name or email is always written beside it.
 */
export function Avatar({
  avatar,
  size = 32,
  className = "bg-surface text-muted",
}: {
  avatar: AvatarView;
  size?: number;
  /** Colours of the circle and initials; the storefront passes the theme's. */
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      title={avatar.label}
      className={`relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-medium leading-none ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) }}
    >
      {avatar.initials}
      {avatar.src && (
        // eslint-disable-next-line @next/next/no-img-element -- a small square from Storage or Kaizen's Gravatar proxy.
        <img
          src={avatar.src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  );
}
