import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { storesOf } from "@/components/admin/admin-shell-parts";
import { Attention, Section, Stat, StatGrid } from "@/components/admin/overview-parts";
import { StoreCard } from "@/components/admin/store-card";
import { ButtonLink, Card, Chip, List, ListRow, PageHeader, RowAmount, RowDate, RowId, RowText } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { attentionFor, changeText, money, totalSales } from "@/lib/control-center";
import { requireAccount } from "@/server/auth";
import { controlCenter } from "@/server/control-center";
import { listHostings } from "@/server/hosts";

export const metadata: Metadata = { title: "Control center" };

/**
 * The store owner's control center (D107): every store they run at a glance,
 * what needs them first, the week's figures and the latest orders. Where
 * someone has no stores of their own to run, the way in is the place they
 * work: their store, the platform, or their hosting.
 */
export default async function ControlCenterPage() {
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const words = adminText(lang, "home");
  const { common: c, center: w } = words;
  const statuses = adminText(lang, "common").orderStatus;
  const [stores, hostings] = await Promise.all([storesOf(account), listHostings(account)]);
  const owner = stores.some((store) => store.role === "owner");
  if (!owner) {
    if (stores.length === 1 && hostings.length === 0 && !account.platformAdmin) redirect(`/admin/${stores[0].slug}`);
    if (stores.length > 0) redirect("/admin/stores");
    if (hostings.length > 0) redirect("/admin/hosting");
    if (account.platformAdmin) redirect("/admin/platform");
    return (
      <PageHeader title={w.title} meta={[w.noAccess]} />
    );
  }

  const center = await controlCenter(account);
  const attention = attentionFor(center.stores, undefined, words.attention);
  const sales = totalSales(center.stores);
  const orders = sales.reduce((sum, f) => sum + f.orders, 0);
  const priorOrders = sales.reduce((sum, f) => sum + f.priorOrders, 0);
  const toSend = center.stores.reduce((sum, s) => sum + s.toSend, 0);
  const low = center.stores.reduce((sum, s) => sum + s.lowStock + s.belowLevel, 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={c.eyebrow}
        title={w.title}
        meta={[center.stores.length === 1 ? w.oneStore : fillWords(w.allStores, { count: center.stores.length })]}
        actions={
          <ButtonLink href="/admin/stores" size="header">
            {w.manage}
          </ButtonLink>
        }
      />

      <Attention items={attention} empty={w.nothing} words={words.attention} />

      <Section id="week-heading" title={c.week}>
        <StatGrid>
          {sales.length === 0 ? <Stat label={c.sales} value="–" sub={c.noSales} /> : sales.slice(0, 2).map((f) => <Stat key={f.currency} label={fillWords(c.salesIn, { currency: f.currency })} value={money(f.week, f.currency, locale)} sub={changeText(f.week, f.prior, c)} />)}
          <Stat label={c.orders} value={orders} sub={changeText(orders, priorOrders, c)} />
          <Stat label={c.waitingToBeSent} value={toSend} sub={toSend > 0 ? w.acrossStores : w.allSent} />
          {sales.length < 2 && <Stat label={c.runningLow} value={low} sub={low > 0 ? w.lowSub : w.stockFine} />}
          {center.ai.requests > 0 && sales.length < 2 && <Stat label={w.aiRequests} value={center.ai.requests} sub={center.ai.failed > 0 ? fillWords(w.failed, { n: center.ai.failed }) : undefined} href="/admin/account/usage" />}
        </StatGrid>
      </Section>

      <Section id="stores-heading" title={w.yourStores} action={<ButtonLink kind="link" href="/admin/stores">{w.allStoresLink}</ButtonLink>}>
        <div className="grid gap-4 xl:grid-cols-2">
          {center.stores.map((store) => (
            <StoreCard key={store.slug} store={store} words={words} locale={locale} />
          ))}
        </div>
      </Section>

      {center.latest.length > 0 && (
        <Card title={c.latestOrders}>
          <List label={c.latestOrders}>
            {center.latest.map((order) => (
              <ListRow key={order.id} href={`/admin/${order.storeSlug}/orders/${order.id}`}>
                <RowId>#{order.number}</RowId>
                <RowText>
                  {order.storeName}
                  {order.name ? ` · ${order.name}` : ""}
                </RowText>
                <Chip>{statuses[order.status as keyof typeof statuses] ?? order.status}</Chip>
                <RowDate>
                  <time dateTime={order.placedAt}>{order.placedAt.slice(0, 10)}</time>
                </RowDate>
                <RowAmount>{money(order.totalMinor, order.currency, locale)}</RowAmount>
              </ListRow>
            ))}
          </List>
        </Card>
      )}

      {hostings.length > 0 && (
        <Card title={c.hosting}>
          <List label={c.hosting}>
            {hostings.map((h) => (
              <ListRow key={h.slug} href={`/admin/hosting/${h.slug}`}>
                <RowId>{h.name}</RowId>
                <RowText>{fillWords(c.asHost, { name: h.hostName })}</RowText>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
