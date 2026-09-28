/**
 * Profile pictures (D97): a person's own picture, else their Gravatar
 * (through Kaizen's proxy, `/api/gravatar`), else their initials.
 */

/** What `<Avatar>` draws: addresses already worked out on the server. */
export type AvatarView = {
  /** Their name, else their email: for the initials and the picture's title. */
  label: string;
  initials: string;
  /** Their own picture, or their Gravatar through Kaizen; null for initials only. */
  src: string | null;
};

/**
 * Up to two letters for someone: the first letters of the first and last
 * words of their name, else the first letter of their email address.
 */
export function initials(name: string | null | undefined, email: string): string {
  const words = (name ?? "")
    .trim()
    .split(/\s+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0])
    .filter((letter): letter is string => Boolean(letter));
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words.length === 1 ? [words[0]] : [];
  if (letters.length === 0) {
    const first = email.trim().match(/[\p{L}\p{N}]/u)?.[0];
    if (first) letters.push(first);
  }
  return letters.join("").toLocaleUpperCase() || "?";
}

/** The public address of a picture in the avatars bucket. */
export function avatarPictureUrl(supabaseUrl: string, path: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/avatars/${path.split("/").map(encodeURIComponent).join("/")}`;
}
