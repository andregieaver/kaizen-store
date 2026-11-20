import type { Metadata } from "next";
import { connection } from "next/server";
import { ChevronRight, ExternalLink } from "lucide-react";

import { NavIcon } from "@/components/admin/nav-icons";
import { AdminLink, CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { navWord } from "@/lib/admin-nav-words";
import { storeBase, storeHref } from "@/lib/paths";
import { canOpenPath } from "@/lib/permissions";
import { STORE_SECTIONS, storeSections, type StoreItem } from "@/lib/store-nav";
import { HOME_WORDS } from "@/lib/admin-words/home";
import { holderOf } from "@/server/auth";
import { siteFacts } from "@/server/home";
import { memberCan, requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Website" };

/**
 * The store's website (D147). Round 3 (D603): a sentence on what is live, the front page as visitors see it, the Dream Factory's box for a
 * change in the owner's words, the everyday parts each with its state, and every other page of the section by name.
 */
export default async function StoreWebsitePage({ params }: PageProps<"/admin/[store]/website">) {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const member = await requirePermission((await params).store, "website:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = HOME_WORDS[lang].website;
  const say = (text: string) => navWord(lang, text);
  // The pages of a member's own role only (wave 1, 1f): a card for a page they cannot open would be a link to a 404.
  const holder = holderOf(member);
  const section = storeSections(store, (path) => canOpenPath(holder, path, store.workspace)).find((s) => s.key === "website") ?? STORE_SECTIONS.find((s) => s.key === "website")!;
  const items = section.groups.flatMap((g) => g.items);
  const dream = items.find((i) => i.path === "/dream-factory") ?? null;
  const parts = items.filter((i) => i.basic && i !== dream);
  // A store without the shop has no Products tab (its only page left there, Custom fields, is aside), so its fields are listed here: a site's
  // pages use them too.
  const products = storeSections(store, (path) => canOpenPath(holder, path, store.workspace)).find((s) => s.key === "products");
  const fields = products ? null : (STORE_SECTIONS.find((s) => s.key === "products")?.groups.flatMap((g) => g.items).find((i) => i.path === "/fields" && canOpenPath(holder, i.path)) ?? null);
  const rest = [...items.filter((i) => !i.basic && i !== dream), ...(fields ? [fields] : [])];
  const facts = await siteFacts(store.id);
  const base = `/admin/${store.slug}`;
  const front = store.frontPageId;

  const lead =
    facts.pages === 0 ? w.leadEmpty : fillWords(w.lead, { pages: countWords(facts.pages, w.pages), articles: countWords(facts.articles, w.articles) }) + (facts.media === 0 ? w.noMedia : "");
  // Each everyday part's state, in words; a part without one keeps its own line.
  const stateOf = (item: StoreItem): { text: string; tone: "positive" | "neutral" | "plain" } => {
    switch (item.path) {
      case "/pages":
        return facts.pages > 0
          ? { text: countWords(facts.pages, w.state.pagesLive) + (facts.drafts > 0 ? countWords(facts.drafts, w.state.pagesDraft) : ""), tone: "positive" }
          : { text: w.state.noPages, tone: "neutral" };
      case "/articles":
        return facts.articles > 0 ? { text: countWords(facts.articles, w.state.articles), tone: "positive" } : { text: w.state.noArticles, tone: "neutral" };
      case "/media":
        return facts.media > 0 ? { text: countWords(facts.media, w.state.media), tone: "positive" } : { text: w.state.noMedia, tone: "neutral" };
      case "/settings/design":
        return { text: w.state.look, tone: "plain" };
      case "/menus":
        return facts.menus > 0 ? { text: countWords(facts.menus, w.state.menus), tone: "plain" } : { text: w.state.noMenus, tone: "neutral" };
      default:
        return { text: say(item.description), tone: "plain" };
    }
  };
  const shopHref = storeHref(store.slug, storeBase(store.slug));
  const mayEdit = memberCan(member, "website:write");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        meta={[lead]}
        actions={
          <div className="flex flex-wrap gap-2">
            <a href={shopHref} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-pill border border-edge bg-card px-5 text-body text-ink hover:bg-sunken">
              {w.viewShop}
              <ExternalLink aria-hidden className="size-4" />
            </a>
            {mayEdit && (
              <AdminLink href={front ? `${base}/pages/${front}` : `${base}/pages`} className="inline-flex h-11 items-center rounded-pill bg-brand px-5 text-body font-medium text-brand-ink">
                {front ? w.editFront : w.openPages}
              </AdminLink>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-stretch gap-5">
        {front && (
          <figure className={`m-0 flex min-w-0 flex-[999_1_28rem] flex-col gap-2.5 p-3 text-ink ${CARD_CLASS}`}>
            <span aria-hidden className="flex items-center gap-1.5 px-1">
              <span className="size-2 rounded-pill bg-line" />
              <span className="size-2 rounded-pill bg-line" />
              <span className="size-2 rounded-pill bg-line" />
              <span className="ml-2.5 flex h-6 flex-1 items-center truncate rounded-pill bg-sunken px-3 text-caption text-muted">{shopHref.replace(/^https?:\/\//, "")}</span>
            </span>
            {/* The front page drawn at a computer's width and shown at half its size; a picture to look at, never to use. */}
            <span className="relative block aspect-[16/10] overflow-hidden rounded-md bg-sunken">
              <iframe
                title={w.previewTitle}
                src={`${base}/website/front`}
                loading="lazy"
                tabIndex={-1}
                className="pointer-events-none absolute top-0 left-0 h-[200%] w-[200%] origin-top-left scale-50 border-0 bg-white"
              />
            </span>
            <figcaption className="flex items-center justify-between px-1 text-caption text-ink-2">
              <span>{w.frontPage}</span>
              <span className="inline-flex items-center gap-1.5 text-positive-text">
                <span aria-hidden className="size-1.5 rounded-pill bg-insight-solid" />
                {w.live}
              </span>
            </figcaption>
          </figure>
        )}
        {dream && memberCan(member, "owner") && (
          <section aria-labelledby="dream" className="flex min-w-0 flex-[1_1_18rem] flex-col gap-4 rounded-panel bg-ink p-6 text-card">
            <span className="text-caption tracking-[0.08em] text-card/70 uppercase">{w.dream.kicker}</span>
            <h2 id="dream" className="text-[22px] leading-snug tracking-tight">
              {w.dream.title}
            </h2>
            <form action={`${base}/dream-factory`} className="flex flex-1 flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="sr-only">{w.dream.label}</span>
                <textarea name="wish" rows={3} maxLength={2000} placeholder={w.dream.placeholder} className="resize-none rounded-md p-3 text-body text-ink placeholder:text-muted" />
              </label>
              <ul className="flex flex-wrap gap-1.5">
                {w.dream.ideas.map((idea) => (
                  <li key={idea}>
                    <AdminLink href={`${base}/dream-factory?wish=${encodeURIComponent(idea)}`} className="inline-flex h-8 items-center rounded-pill border border-card/20 px-3 text-caption text-card/90 hover:bg-card/10">
                      {idea}
                    </AdminLink>
                  </li>
                ))}
              </ul>
              <button type="submit" className="mt-auto h-11 rounded-pill bg-brand text-body font-medium text-brand-ink">
                {w.dream.show}
              </button>
            </form>
          </section>
        )}
      </div>

      <section aria-labelledby="parts" className="flex flex-col gap-2.5">
        <h2 id="parts" className="text-title text-ink">
          {w.parts}
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(16rem,100%),1fr))] gap-3">
          {parts.map((item) => {
            const state = stateOf(item);
            return (
              <li key={item.path}>
                <AdminLink href={`${base}${item.path}`} className={`flex h-full items-center gap-3.5 p-4.5 text-ink hover:bg-sunken ${CARD_CLASS}`}>
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-sunken text-ink-2">
                    <NavIcon name={item.icon} className="size-[18px]" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-body">{say(item.label)}</span>
                    <span className={`flex items-center gap-1.5 text-caption ${state.tone === "positive" ? "text-positive-text" : state.tone === "neutral" ? "text-muted" : "text-ink-2"}`}>
                      {state.tone !== "plain" && <span aria-hidden className={`size-1.5 shrink-0 rounded-pill ${state.tone === "positive" ? "bg-insight-solid" : "bg-neutral-solid"}`} />}
                      <span className="line-clamp-1">{state.text}</span>
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
                </AdminLink>
              </li>
            );
          })}
        </ul>
      </section>

      {rest.length > 0 && (
        <section aria-labelledby="else" className={`flex flex-col gap-3 px-5.5 py-4.5 ${CARD_CLASS}`}>
          <h2 id="else" className="text-body-strong text-ink">
            {w.elseTitle} <span className="font-normal text-caption text-muted">{w.elseSub}</span>
          </h2>
          <ul className="flex flex-wrap gap-2">
            {rest.map((item) => (
              <li key={item.path}>
                <AdminLink href={`${base}${item.path}`} className="inline-flex h-9 items-center gap-2 rounded-pill bg-sunken px-3.5 text-body text-ink hover:bg-line">
                  <NavIcon name={item.icon} className="size-3.5 text-ink-2" />
                  {say(item.label)}
                </AdminLink>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
