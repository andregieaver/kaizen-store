import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { DataSkeleton } from "@/components/admin/data/page-parts";
import { hint } from "@/components/admin/data/ui";
import { CheckOldLinks, ShopifyConnectForm, ShopifyDisconnect } from "@/components/admin/moving/shopify-connect";
import { ShopCopy, type CopyRow } from "@/components/admin/moving/shop-copy";
import { COPY_FEEDS, copyDone, copyMoving, copyReady, type CopyFeed } from "@/lib/shopify-copy";
import { copyView, feedJobPage } from "@/server/shopify-copy";
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

import { advanceCopyAction, bringItOverAction, checkOldLinksAction, connectShopifyAction, disconnectShopifyAction, startCopyAction } from "./actions";

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
  const asked = (await searchParams).shopify;
  const outcome = OUTCOMES.find((o) => o === asked) ?? null;
  const offered = shopifyOffered();
  const connection = offered ? await shopifyConnection(member) : null;
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
      {!offered ? (
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
            <CheckOldLinks check={checkOldLinksAction.bind(null, store.slug)} />
            <ShopifyDisconnect disconnect={disconnectShopifyAction.bind(null, store.slug)} />
          </div>
        </Card>
      ) : (
        <Card title={w.connect.title}>
          <ShopifyConnectForm connect={connectShopifyAction.bind(null, store.slug)} />
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
  }
}

/** *Copy my shop* (D445 step 4): where each part of the copy is, from `shop_moves.copy` and the imports' own jobs. */
async function CopyPanel({ storeSlug }: { storeSlug: string }) {
  const member = await requireOwnerRole(storeSlug);
  const view = await copyView(member);
  if (!view) return null;
  const base = `/admin/${storeSlug}`;
  const files: Record<CopyFeed, string> = {
    products: `${base}/products/import`,
    customers: `${base}/customers/import`,
    orders: `${base}/orders/history-import`,
    redirects: `${base}/redirects/import`,
  };
  const rows: CopyRow[] = COPY_FEEDS.map((feed) => {
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
      needLook: dry.needLook,
    };
  });
  return (
    <ShopCopy
      started={view.state.startedAt !== null}
      moving={copyMoving(view.state)}
      ready={copyReady(view.state)}
      done={copyDone(view.state)}
      rows={rows}
      privateHref={`${base}/settings/private`}
      actions={{ start: startCopyAction.bind(null, storeSlug), advance: advanceCopyAction.bind(null, storeSlug), bring: bringItOverAction.bind(null, storeSlug) }}
    />
  );
}

