/**
 * A store's blogs and authors (wave 7 unit G, D341, `docs/wave-7-storefront.md` G): pure, shared by the server, the admin and the
 * storefront. The first blog is at `/blog` (as before), the others at `/blogs/{handle}`; an article belongs to the blog its content names
 * (`PageContent.blogId`), else to the first. Every blog's feed is its address with `/feed.atom` after it. No zod: the visitor's pages
 * read these.
 */

export const BLOG_COMMENT_SETTINGS = ["off", "moderated", "automatic"] as const;
export type BlogCommentSetting = (typeof BLOG_COMMENT_SETTINGS)[number];

export const BLOG_HANDLE_MAX = 60;
export const BLOG_TITLE_MAX = 80;
/** Blogs a store may have, the first included. */
export const BLOGS_MAX = 20;
export const AUTHOR_NAME_MAX = 100;
export const AUTHOR_BIO_MAX = 600;
export const AUTHOR_LINK_MAX = 500;
/** Authors a store may have. */
export const AUTHORS_MAX = 100;

export type Blog = {
  id: string;
  handle: string;
  /** The store's first blog, at `/blog`. */
  main: boolean;
  /** Its name per locale (`nb-NO`); a locale without one shows the main language's, else the standard word. */
  titles: Record<string, string>;
  /** A published page drawn at the blog's address instead of the standard list; the first blog's is the `blog` page role (D112). */
  listingPageId: string | null;
  comments: BlogCommentSetting;
  position: number;
};

export type BlogAuthor = {
  id: string;
  name: string;
  /** A picture from the store's media library, or none. */
  picture: string | null;
  bio: string;
  /** Where to read more about them: checked by `isSafeAddress()` when saved and when drawn. */
  link: string | null;
};

/** A blog's address inside a market: `/blog` for the first, `/blogs/{handle}` for the others. */
export const blogPath = (blog: Pick<Blog, "main" | "handle">): string => (blog.main ? "/blog" : `/blogs/${blog.handle}`);

/** An article's address inside a market, in its blog. */
export const articlePath = (blog: Pick<Blog, "main" | "handle">, slug: string): string => `${blogPath(blog)}/${slug}`;

/** A blog's Atom feed inside a market. */
export const feedPath = (blog: Pick<Blog, "main" | "handle">): string => `${blogPath(blog)}/feed.atom`;

/** The blog an article belongs to: the one its content names when the store still has it, else the first. */
export function blogOfArticle<B extends Pick<Blog, "id" | "main">>(blogs: readonly B[], content: { blogId?: string }): B | null {
  const named = content.blogId ? blogs.find((b) => b.id === content.blogId) : undefined;
  return named ?? blogs.find((b) => b.main) ?? null;
}

/** Whether an article belongs to a blog (`blogOfArticle()` asked of one blog). */
export const inBlog = (blogs: readonly Pick<Blog, "id" | "main">[], blog: Pick<Blog, "id">, content: { blogId?: string }): boolean =>
  blogOfArticle(blogs, content)?.id === blog.id;

/** A blog's name in a locale: its own, else the main language's, else `fallback` (the standard word, `m.blog`). */
export function blogTitle(blog: Pick<Blog, "titles">, locale: string, mainLocale: string | undefined, fallback: string): string {
  return blog.titles[locale]?.trim() || (mainLocale ? blog.titles[mainLocale]?.trim() : "") || fallback;
}

export type BlogProblem =
  | "handle_missing"
  | "handle_format"
  | "handle_long"
  | "handle_taken"
  | "title_long"
  | "too_many"
  | "comments";

const HANDLE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type BlogInput = { handle: string; titles: Record<string, string>; comments: string; listingPageId: string | null };

/**
 * What is wrong with a blog as typed, before it is saved: its address (the first blog's is fixed), its names and its comments setting.
 * `others` are the store's other blogs' handles; `count` how many blogs the store has besides this one.
 */
export function blogProblems(input: BlogInput, { main, others, count }: { main: boolean; others: readonly string[]; count: number }): BlogProblem[] {
  const problems: BlogProblem[] = [];
  if (!main) {
    if (!input.handle) problems.push("handle_missing");
    else if (input.handle.length > BLOG_HANDLE_MAX) problems.push("handle_long");
    else if (!HANDLE.test(input.handle)) problems.push("handle_format");
    else if (others.includes(input.handle)) problems.push("handle_taken");
  }
  if (Object.values(input.titles).some((title) => title.length > BLOG_TITLE_MAX)) problems.push("title_long");
  if (!(BLOG_COMMENT_SETTINGS as readonly string[]).includes(input.comments)) problems.push("comments");
  if (count >= BLOGS_MAX) problems.push("too_many");
  return problems;
}

/** An address from a title: lowercase letters and digits with single hyphens (`Our news` → `our-news`). */
export function handleFromTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BLOG_HANDLE_MAX)
    .replace(/-+$/g, "");
}

export type AuthorProblem = "name_missing" | "name_long" | "bio_long" | "link_long" | "link_unsafe" | "too_many";

/** What is wrong with an author as typed; `safe` is `isSafeAddress()` (passed in so this stays free of the site's modules). */
export function authorProblems(
  input: { name: string; bio: string; link: string | null },
  { count, safe }: { count: number; safe: (address: string) => boolean },
): AuthorProblem[] {
  const problems: AuthorProblem[] = [];
  const name = input.name.trim();
  if (!name) problems.push("name_missing");
  else if (name.length > AUTHOR_NAME_MAX) problems.push("name_long");
  if (input.bio.length > AUTHOR_BIO_MAX) problems.push("bio_long");
  if (input.link) {
    if (input.link.length > AUTHOR_LINK_MAX) problems.push("link_long");
    else if (!safe(input.link)) problems.push("link_unsafe");
  }
  if (count >= AUTHORS_MAX) problems.push("too_many");
  return problems;
}
