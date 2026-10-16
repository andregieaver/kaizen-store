import type { ContentPack } from "./content-packs";
import { newPageContent, type PageContent } from "./page-content";

/**
 * A content pack's pages (`docs/theme-showcase-phase-1.md` step 2): its home page and its about page, built from the pack's words in the
 * core section styles every Kaizena theme defines (`hero`, `plain`, `feature`, `muted`), so each theme and preset draws them in its own way.
 * The pictures are the pack's own once made (an address, measured); until then the hero is the theme's hero style alone. Pure; checked by
 * `pageInput` where it is saved.
 */

export type PackPicture = { url: string; width: number; height: number; alt: string };

type Ids = () => string;
const uuid: Ids = () => globalThis.crypto.randomUUID();

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const richText = (id: string, texts: string[], extra: Record<string, unknown> = {}) => ({
  id,
  type: "richText",
  doc: { type: "doc", content: texts.map(paragraph) },
  ...extra,
});
const heading = (id: string, text: string, level: number, extra: Record<string, unknown> = {}) => ({ id, type: "heading", text, level, ...extra });

/** The words on the button and over the grid for a store of goods, or of services booked by time. */
const isServices = (pack: ContentPack) => pack.products.some((p) => p.minutes);

/** The pack's home page: its hero, its products, three points and its story. */
export function packHomePage(pack: ContentPack, pictures: { hero: PackPicture | null; story: PackPicture | null }, id: Ids = uuid): PageContent {
  const light = pictures.hero ? { typography: { text: { align: "center", color: "#ffffff" } } } : { typography: { text: { align: "center" } } };
  const hero = {
    id: id(),
    type: "row",
    layout: "1",
    width: "full",
    sectionStyle: "hero",
    style: { padding: { top: 160, right: 20, bottom: 140, left: 20 } },
    ...(pictures.hero && {
      background: {
        type: "image",
        image: { url: pictures.hero.url, width: pictures.hero.width, height: pictures.hero.height },
        overlay: { color: "#000000", opacity: 40 },
      },
    }),
    columns: [
      {
        id: id(),
        ...light,
        blocks: [
          heading(id(), pack.headline, 1, light),
          richText(id(), [pack.tagline], light),
          { id: id(), type: "button", label: isServices(pack) ? "See the services" : "See the products", href: "#products", align: "center" },
        ],
      },
    ],
  };
  const products = {
    id: id(),
    type: "row",
    layout: "1",
    sectionStyle: "plain",
    htmlId: "products",
    columns: [
      {
        id: id(),
        blocks: [
          heading(id(), isServices(pack) ? "Services" : "New in", 2),
          {
            id: id(),
            type: "contentGrid",
            source: { type: "products" },
            categories: [],
            tags: [],
            sort: "oldest",
            limit: 8,
            columns: { mobile: 2, tablet: 3, desktop: 4 },
            show: { image: true, heading: true, excerpt: false, price: true, button: false },
            buttonLabel: "",
            emptyText: "",
            headingLevel: 3,
            excerptLines: 3,
            gap: 24,
          },
        ],
      },
    ],
  };
  const points = {
    id: id(),
    type: "row",
    layout: "3",
    sectionStyle: "feature",
    columns: pack.points.map((point) => ({ id: id(), blocks: [heading(id(), point.title, 3), richText(id(), [point.text])] })),
  };
  const story = {
    id: id(),
    type: "row",
    layout: "2",
    sectionStyle: "muted",
    columns: [
      {
        id: id(),
        blocks: pictures.story
          ? [{ id: id(), type: "image", image: { ...pictures.story }, caption: "", href: "" }]
          : [heading(id(), pack.storeName, 2)],
      },
      { id: id(), blocks: [heading(id(), pack.storyTitle, 2), richText(id(), [pack.story])] },
    ],
  };
  return { ...newPageContent(), title: "Home", slug: "home", rows: [hero, products, points, story] as unknown as PageContent["rows"] };
}

/** The pack's about page: who the store is, and that it is a demo to replace. */
export function packAboutPage(pack: ContentPack, picture: PackPicture | null, id: Ids = uuid): PageContent {
  const rows = [
    {
      id: id(),
      type: "row",
      layout: "1",
      sectionStyle: "plain",
      columns: [{ id: id(), blocks: [heading(id(), `About ${pack.storeName}`, 1), richText(id(), pack.about)] }],
    },
    ...(picture
      ? [
          {
            id: id(),
            type: "row",
            layout: "1",
            sectionStyle: "plain",
            columns: [{ id: id(), blocks: [{ id: id(), type: "image", image: { ...picture }, caption: "", href: "" }] }],
          },
        ]
      : []),
  ];
  return { ...newPageContent(), title: "About us", slug: "about", rows: rows as unknown as PageContent["rows"] };
}
