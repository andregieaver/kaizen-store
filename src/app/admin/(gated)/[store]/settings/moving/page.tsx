import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { DataSkeleton } from "@/components/admin/data/page-parts";
import { hint } from "@/components/admin/data/ui";
import { CheckOldLinks, ShopifyConnectForm, ShopifyDisconnect } from "@/components/admin/moving/shopify-connect";
import { ShopCopy, type CopyRow } from "@/components/admin/moving/shop-copy";
import { ShopMakers } from "@/components/admin/moving/shop-makers";
import { makersView } from "@/server/shopify-makers";
import { ShopMove } from "@/components/admin/moving/shop-move";
import { moveStatus, moveView } from "@/server/shopify-move";
import { ShopAddress } from "@/components/admin/moving/shop-address";
import { addressView } from "@/server/shopify-address";
import { ShopUndo } from "@/components/admin/moving/shop-undo";
import { undoView } from "@/server/shopify-undo";
import { MoveWatchCard } from "@/components/admin/moving/move-watch-card";
import { COPY_FEEDS, copyDone, copyFailed, copyMoving, copyReady, type CopyFeed } from "@/lib/shopify-copy";
import { copySource, copyView, feedJobPage } from "@/server/shopify-copy";
import { hasMover, moverStatus, wooConnection, wooOffered } from "@/server/woocommerce-connect";
import { KNOWN_PLUGINS } from "@/lib/woocommerce-mover";
import { WORDPRESS_PLUGIN_FILE } from "@/lib/wordpress-plugin";
import { WooMover } from "@/components/admin/moving/woo-mover";
import { WooList } from "@/components/admin/moving/woo-list";
import { MovingSource } from "@/components/admin/moving/moving-source";
import { WOO_COPY_FEEDS, WOO_MOVER_FEEDS } from "@/lib/woocommerce-copy";
import { customerDryCountsOf, dryCountsOf, historyDryCountsOf, redirectDryCountsOf } from "@/server/data-jobs";
import type { DataJob } from "@/server/data-job-store";
import { Card, PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { momentText } from "@/lib/data-admin";
import { requireOwnerRole } from "@/server/permissions";
import { shopifyConnection, shopifyOffered } from "@/server/shopify-connect";
import { checkShopify } from "@/server/shopify-report";
import { figureText, type ShopReport } from "@/lib/shopify-report";
import type { MovingMessages } from "@/lib/admin-messages/moving.en";

import {
  advanceCopyAction,
  advanceMoveAction,
  bringItOverAction,
  cancelMoveAction,
  issueLeftCardAction,
  checkAddressAction,
  checkOldLinksAction,
  connectShopifyAction,
  connectMoverAction,
  connectWooAction,
  disconnectShopifyAction,
  disconnectMoverAction,
  disconnectWooAction,
  importListAction,
  saveVendorMakerAction,
  shopifyClosedAction,
  scheduleMoveAction,
  startAddressAction,
  undoCopyAction,
  startCopyAction,
  startMoveAction,
} from "./actions";

export const metadata: Metadata = { title: "Moving in" };

type Props = PageProps<"/admin/[store]/settings/moving">;

const OUTCOMES = ["connected", "declined", "failed", "off"] as const;

/**
 * Settings → Moving in (D445 step 2, `docs/moving-from-shopify.md` 4.2): for Homer, one field and *Connect Shopify*; once connected, the
 * shop's name and what it holds, and one press to check its old links. Until copying is built (step 3), the files that bring the rest
 * over are linked in their order. Without Kaizena Flow's Shopify app set on this server, the files alone. The owner's.
 */
export default async function MovingPage({ params, searchParams }: Props) {
  const { store, account } = await requireOwnerRole((await params).store);
  const w = adminText(adminLangOf(account.adminLocale), "moving");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.intro} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requireOwnerRole(storeSlug);
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "moving");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const query = await searchParams;
  const asked = query.shopify;
  const outcome = OUTCOMES.find((o) => o === asked) ?? null;
  const offered = shopifyOffered();
  const connection = offered ? await shopifyConnection(member) : null;
  // WooCommerce (D446 step 1): its own key, approved on the owner's own site; WooCommerce sends him back with `success`.
  const wooOn = wooOffered();
  const woo = wooOn && !connection ? await wooConnection(member) : null;
  const wooOutcome = query.woocommerce === "back" ? (woo ? "connected" : query.success === "0" ? "declined" : "failed") : null;
  const base = `/admin/${store.slug}`;
  const files = [
    { href: `${base}/products/import`, label: w.files.products },
    { href: `${base}/customers/import`, label: w.files.customers },
    { href: `${base}/orders/history-import`, label: w.files.orders },
    { href: `${base}/redirects/old-shop`, label: w.files.links },
  ];
  const fileList = (
    <ol className="list-decimal pl-5 text-sm">
      {files.map((f) => (
        <li key={f.href}>
          <Link href={f.href} className="underline underline-offset-2">
            {f.label}
          </Link>
        </li>
      ))}
    </ol>
  );

  return (
    <AdminTextScope texts={adminTexts(lang, ["moving"])}>
      {outcome && (
        <p role="status" className={`rounded-card p-3 text-sm ${outcome === "connected" ? "bg-positive-soft" : "bg-sunken"}`}>
          {w.outcome[outcome]}
        </p>
      )}
      {woo && query.mover === "connected" && (
        <p role="status" className="rounded-card bg-positive-soft p-3 text-sm">
          {w.woo.mover.outcome}
        </p>
      )}
      {wooOutcome && (
        <p role="status" className={`rounded-card p-3 text-sm ${wooOutcome === "connected" ? "bg-positive-soft" : "bg-sunken"}`}>
          {w.woo.outcome[wooOutcome]}
        </p>
      )}
      {woo ? (
        <Card title={fillWords(w.connected.title, { name: woo.name || woo.site })} description={fillWords(w.woo.shop, { site: woo.site, when: momentText(woo.connectedAt, store.timeZone, locale) })}>
          <div className="flex flex-col gap-4">
            <p className="text-sm">{w.woo.later}</p>
            <MoverPanel storeSlug={store.slug} />
            <CopyPanel storeSlug={store.slug} />
            <WooList action={importListAction.bind(null, store.slug)} />
            <MovingSource source="woocommerce">
              <MovePanel storeSlug={store.slug} locale={locale} />
              <AddressPanel storeSlug={store.slug} />
            </MovingSource>
            <details className="text-sm">
              <summary className="w-fit cursor-pointer underline underline-offset-2">{w.details.title}</summary>
              <div className="mt-3">
                <UndoPanel storeSlug={store.slug} />
              </div>
            </details>
            <ShopifyDisconnect disconnect={disconnectWooAction.bind(null, store.slug)} ask={w.woo.disconnectAsk} />
          </div>
        </Card>
      ) : !offered ? (
        <Card title={w.off.title} description={w.off.text}>
          {fileList}
        </Card>
      ) : connection ? (
        <Card title={fillWords(w.connected.title, { name: connection.name || connection.shop })} description={fillWords(w.connected.shop, { shop: connection.shop, when: momentText(connection.connectedAt, store.timeZone, locale) })}>
          <div className="flex flex-col gap-4">
            <Suspense fallback={<DataSkeleton />}>
              <ShopReportView storeSlug={store.slug} words={w} locale={locale} />
            </Suspense>
            {connection.missing.length > 0 && (
              <p role="alert" className="text-sm">
                {countWords(connection.missing.length, w.connected.missing, { n: connection.missing.length })}
              </p>
            )}
            <CopyPanel storeSlug={store.slug} />
            <MakersPanel storeSlug={store.slug} />
            <MovePanel storeSlug={store.slug} locale={locale} />
            <AddressPanel storeSlug={store.slug} />
            <MoveWatchCard member={member} lang={lang} level={3} close={shopifyClosedAction.bind(null, store.slug)} />
            <CheckOldLinks check={checkOldLinksAction.bind(null, store.slug)} />
            <DetailsPanel storeSlug={store.slug} words={w} />
            <ShopifyDisconnect disconnect={disconnectShopifyAction.bind(null, store.slug)} />
          </div>
        </Card>
      ) : (
        <Card title={w.connect.title}>
          <ShopifyConnectForm connect={connectShopifyAction.bind(null, store.slug)} />
        </Card>
      )}
      {wooOn && !woo && !connection && (
        <Card title={w.woo.connect.title}>
          <ShopifyConnectForm kind="woocommerce" connect={connectWooAction.bind(null, store.slug)} />
        </Card>
      )}
    </AdminTextScope>
  );
}

/** *Here's your shop* (D445 step 3): what Shopify counts and what its settings already answer, then at most three things good to know. */
async function ShopReportView({ storeSlug, words, locale }: { storeSlug: string; words: MovingMessages; locale: string }) {
  const member = await requireOwnerRole(storeSlug);
  const check = await checkShopify(member);
  const r = words.report;
  if (!check) return null;
  if (!check.ok) return <p className="text-sm">{check.problem === "disconnected" ? r.disconnected : r.failed}</p>;
  return <ShopReportBody report={check.report} words={words} locale={locale} />;
}

function ShopReportBody({ report, words, locale }: { report: ShopReport; words: MovingMessages; locale: string }) {
  const r = words.report;
  // A figure in words: one or many by the number (an unknown one, a dash, reads as many).
  const thing = (key: keyof MovingMessages["report"]["things"], v: ShopReport["products"]) => countWords(v?.n ?? 0, r.things[key], { n: figureText(v, locale) });
  let countryNames: Intl.DisplayNames | null = null;
  try {
    countryNames = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    countryNames = null;
  }
  const countries = report.countries.map((c) => countryNames?.of(c) ?? c);
  const list = (items: string[]) => {
    try {
      return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
    } catch {
      return items.join(", ");
    }
  };
  return (
    <section aria-labelledby="shop-report" className="flex flex-col gap-3">
      <h3 id="shop-report" className="text-base font-medium">
        {r.title}
      </h3>
      <ul className="flex flex-col gap-1 text-sm">
        <li>{[thing("products", report.products), thing("collections", report.collections), thing("pages", report.pages), thing("articles", report.articles)].join(" · ")}</li>
        <li>{[thing("customers", report.customers), thing("subscribers", report.subscribers)].join(" · ")}</li>
        <li>{[thing("orders", report.orders), thing("giftCards", report.giftCardsWithMoney), thing("discounts", report.discounts)].join(" · ")}</li>
        {report.redirects && report.redirects.n > 0 && <li>{thing("redirects", report.redirects)}</li>}
      </ul>
      <ul className="flex flex-col gap-1 text-sm">
        <li>{report.taxesIncluded === true ? r.vatIncluded : report.taxesIncluded === false ? r.vatExcluded : r.vatUnknown}</li>
        {countries.length > 0 && report.currency && (
          <li>
            {fillWords(r.sellsIn, { countries: list(countries), currency: report.currency })}
            {report.currencies.length > 0 ? `, ${fillWords(r.alsoIn, { currencies: list(report.currencies) })}` : ""}
          </li>
        )}
      </ul>
      {report.goodToKnow.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-medium">{r.goodToKnow}</h4>
          <ul className="list-disc pl-5 text-sm">
            {report.goodToKnow.map((item) => (
              <li key={item}>{r.items[item]}</li>
            ))}
          </ul>
        </div>
      )}
      <p className={hint}>{r.counted}</p>
    </section>
  );
}

/** What a feed's dry run found: how many would come over, how many need a look. */
function dryOf(feed: CopyFeed, job: DataJob | undefined): { ready: number | null; needLook: number | null } {
  if (!job || !job.counts.dry) return { ready: null, needLook: null };
  switch (feed) {
    case "collections":
    case "products": {
      const d = dryCountsOf(job);
      return { ready: d.toCreate + d.toUpdate + d.unchanged, needLook: d.withProblems };
    }
    case "customers": {
      const d = customerDryCountsOf(job);
      return { ready: d.toCreate + d.toUpdate, needLook: d.withProblems };
    }
    case "orders": {
      const d = historyDryCountsOf(job);
      return { ready: d.toCreate + d.already, needLook: d.withProblems };
    }
    case "redirects": {
      const d = redirectDryCountsOf(job);
      return { ready: d.toCreate + d.toReplace + d.unchanged, needLook: d.withErrors };
    }
    default:
      return { ready: null, needLook: null };
  }
}

/**
 * *Details* (D445 step 9, Lisa's, one step away): each part of the copy row by row on its import's own page, every old link and where it
 * leads, Shopify's own files for a part brought by hand, and *Undo this copy*.
 */
async function DetailsPanel({ storeSlug, words }: { storeSlug: string; words: MovingMessages }) {
  const member = await requireOwnerRole(storeSlug);
  const view = await copyView(member);
  const d = words.details;
  const base = `/admin/${storeSlug}`;
  const parts = view
    ? COPY_FEEDS.flatMap((feed) => {
        const job = view.state.feeds[feed].job;
        const href = job ? feedJobPage(feed, storeSlug, job) : null;
        return href ? [{ feed, href }] : [];
      })
    : [];
  return (
    <details className="text-sm">
      <summary className="w-fit cursor-pointer underline underline-offset-2">{d.title}</summary>
      <div className="mt-3 flex flex-col gap-3">
        {parts.length > 0 && (
          <div className="flex flex-col gap-1">
            <h4 className="font-medium">{d.rows}</h4>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {parts.map((p) => (
                <li key={p.feed}>
                  <Link href={p.href} className="underline underline-offset-2">
                    {words.copy.feeds[p.feed]}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Link href={`${base}/redirects/old-shop`} className="w-fit underline underline-offset-2">
          {d.links}
        </Link>
        <div className="flex flex-col gap-1">
          <h4 className="font-medium">{d.files}</h4>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            <li>
              <Link href={`${base}/products/import`} className="underline underline-offset-2">
                {words.files.products}
              </Link>
            </li>
            <li>
              <Link href={`${base}/customers/import`} className="underline underline-offset-2">
                {words.files.customers}
              </Link>
            </li>
            <li>
              <Link href={`${base}/orders/history-import`} className="underline underline-offset-2">
                {words.files.orders}
              </Link>
            </li>
            <li>
              <Link href={`${base}/redirects/import`} className="underline underline-offset-2">
                {d.redirectsFile}
              </Link>
            </li>
          </ul>
        </div>
        <UndoPanel storeSlug={storeSlug} />
      </div>
    </details>
  );
}

/** *Read more of your shop* (D446 step 2): our WordPress plugin, connected or not, and the plugins it found. */
async function MoverPanel({ storeSlug }: { storeSlug: string }) {
  const member = await requireOwnerRole(storeSlug);
  const status = await moverStatus(member);
  if (!status) return null;
  return (
    <WooMover
      status={status}
      download={WORDPRESS_PLUGIN_FILE}
      known={KNOWN_PLUGINS}
      actions={{ connect: connectMoverAction.bind(null, storeSlug), stop: disconnectMoverAction.bind(null, storeSlug) }}
    />
  );
}

/** *Undo this copy* (D445 step 9): Lisa's, with what it would take back; gone after the first real order. */
async function UndoPanel({ storeSlug }: { storeSlug: string }) {
  const member = await requireOwnerRole(storeSlug);
  const view = await undoView(member);
  if (!view) return null;
  const total = Object.values(view.counts).reduce((n, c) => n + c, 0);
  return <ShopUndo total={total} allowed={view.allowed} undo={undoCopyAction.bind(null, storeSlug)} />;
}

/** Move day, the address (D445 step 7b): once the shop has moved, its Shopify address pointed here. */
async function AddressPanel({ storeSlug }: { storeSlug: string }) {
  const member = await requireOwnerRole(storeSlug);
  const move = await moveStatus(member);
  if (move?.status !== "moved") return null;
  const view = await addressView(member);
  if (!view) return null;
  const base = `/admin/${storeSlug}/settings/domains`;
  return (
    <ShopAddress
      view={view}
      actions={{ start: startAddressAction.bind(null, storeSlug), check: checkAddressAction.bind(null, storeSlug) }}
      hrefs={{ domains: base, moveIn: `${base}/move-in` }}
    />
  );
}

/** Move day (D445 step 7a): once the copy is brought over, *Ready to move?*; while and after it moves, its steps. */
async function MovePanel({ storeSlug, locale }: { storeSlug: string; locale: string }) {
  const member = await requireOwnerRole(storeSlug);
  const [view, copy] = await Promise.all([moveView(member), copyView(member)]);
  if (!view || !copy) return null;
  // Before the copy is brought over there is nothing to move yet.
  if (view.state.status === "none" && !view.state.missed && !(copy.state.apply && copyDone(copy.state))) return null;
  const base = `/admin/${storeSlug}`;
  return (
    <ShopMove
      state={view.state}
      checks={view.checks}
      canMove={view.canMove}
      locale={locale}
      timeZone={view.timeZone}
      hrefs={{
        payments: `${base}/settings/payments`,
        copy: "#shop-copy",
        links: `${base}/redirects/old-shop`,
        waiting: "#shop-makers",
        address: "#shop-address",
        steps: { catch_up: `${base}/products/import`, links: `${base}/redirects/old-shop`, gift_cards: `${base}/gift-cards`, open: `${base}/settings/private` },
      }}
      actions={{
        start: startMoveAction.bind(null, storeSlug),
        schedule: scheduleMoveAction.bind(null, storeSlug),
        cancel: cancelMoveAction.bind(null, storeSlug),
        advance: advanceMoveAction.bind(null, storeSlug),
        issue: issueLeftCardAction.bind(null, storeSlug),
      }}
    />
  );
}

/** *Who makes your products?* (D445 step 6): once the copy has stopped moving, one question per Shopify vendor whose products still lack a maker. */
async function MakersPanel({ storeSlug }: { storeSlug: string }) {
  const member = await requireOwnerRole(storeSlug);
  const copy = await copyView(member);
  if (!copy || copyMoving(copy.state)) return null;
  const view = await makersView(member);
  if (!view || view.groups.length === 0) return null;
  return (
    <ShopMakers
      rows={view.groups}
      operators={view.operators}
      countries={view.countries}
      safety={view.safety}
      destinations={view.destinations}
      save={saveVendorMakerAction.bind(null, storeSlug)}
      bulkHref={`/admin/${storeSlug}/products/bulk`}
    />
  );
}

/** *Copy my shop* (D445 step 4): where each part of the copy is, from `shop_moves.copy` and the imports' own jobs. */
async function CopyPanel({ storeSlug }: { storeSlug: string }) {
  const member = await requireOwnerRole(storeSlug);
  const [view, move, source] = await Promise.all([copyView(member), moveStatus(member), copySource(member)]);
  if (!view) return null;
  // While the shop moves, the copy is the move's catch-up: the move shows it, and nothing here may start it again.
  if (move && (move.status === "moving" || move.status === "moved")) return null;
  const base = `/admin/${storeSlug}`;
  const files: Record<CopyFeed, string> = {
    products: `${base}/products/import`,
    customers: `${base}/customers/import`,
    orders: `${base}/orders/history-import`,
    redirects: `${base}/redirects/import`,
    collections: `${base}/products/import`,
    pages: `${base}/pages`,
    articles: `${base}/articles`,
    menus: `${base}/menus`,
    countries: `${base}/settings/countries`,
    shipping: `${base}/settings/shipping`,
    discounts: `${base}/discounts`,
    reviews: `${base}/reviews/import`,
    seo: `${base}/fields`,
    look: `${base}/settings/design/themes`,
    subscribers: `${base}/subscribers`,
    gift_cards: `${base}/gift-cards`,
  };
  // A WooCommerce copy lists the parts it brings (D446 step 1); the others are later steps'.
  const wooParts: readonly CopyFeed[] = [...WOO_COPY_FEEDS, ...(source === "woocommerce" && (await hasMover(member.store.id)) ? WOO_MOVER_FEEDS : [])];
  const feeds = source === "woocommerce" ? COPY_FEEDS.filter((f) => wooParts.includes(f)) : COPY_FEEDS.filter((f) => f !== "reviews");
  const rows: CopyRow[] = feeds.map((feed) => {
    const f = view.state.feeds[feed];
    const dry = dryOf(feed, view.jobs[feed]);
    return {
      feed,
      stage: f.stage,
      count: f.count ?? null,
      problem: f.problem ?? null,
      href: f.job ? feedJobPage(feed, storeSlug, f.job) : null,
      fileHref: files[feed],
      ready: dry.ready,
      // A page, post or menu that could not be written is counted by the copy itself (it has no import page).
      needLook: f.refused ?? dry.needLook,
    };
  });
  return (
    <ShopCopy
      source={source ?? "shopify"}
      parts={feeds}
      started={view.state.startedAt !== null}
      moving={copyMoving(view.state)}
      ready={copyReady(view.state)}
      done={copyDone(view.state)}
      failed={copyFailed(view.state)}
      rows={rows}
      privateHref={`${base}/settings/private`}
      actions={{ start: startCopyAction.bind(null, storeSlug), advance: advanceCopyAction.bind(null, storeSlug), bring: bringItOverAction.bind(null, storeSlug) }}
    />
  );
}

