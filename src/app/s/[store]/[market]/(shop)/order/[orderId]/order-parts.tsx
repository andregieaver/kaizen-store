import { storePartDrawer } from "@/components/store-part-frame";

import {
  OrderAccount,
  OrderAddress,
  OrderBookings,
  OrderContinue,
  OrderDetails,
  OrderDocuments,
  OrderParcels,
  OrderDownloads,
  OrderLines,
  OrderStatus,
  OrderSubscription,
  OrderTerms,
  OrderTotals,
} from "./order-section";

/** What a page built for the order confirmation draws of the shop (D113, D117): only the order's own sections (bloat review step 2.9). */
export const orderParts = storePartDrawer(({ part, store, market, route, query }) => {
  const order = route.param ? { store, market, orderId: route.param, query } : null;
  switch (part) {
    case "order":
      return route.param ? <OrderDetails store={store} market={market} orderId={route.param} query={query} /> : null;
    case "order_status":
      return order && <OrderStatus {...order} />;
    case "order_account":
      return order && <OrderAccount {...order} />;
    case "order_bookings":
      return order && <OrderBookings {...order} />;
    case "order_parcels":
      return order && <OrderParcels {...order} />;
    case "order_lines":
      return order && <OrderLines {...order} />;
    case "order_totals":
      return order && <OrderTotals {...order} />;
    case "order_documents":
      return order && <OrderDocuments {...order} />;
    case "order_subscription":
      return order && <OrderSubscription {...order} />;
    case "order_downloads":
      return order && <OrderDownloads {...order} />;
    case "order_address":
      return order && <OrderAddress {...order} />;
    case "order_terms":
      return order && <OrderTerms {...order} />;
    case "order_continue":
      return order && <OrderContinue {...order} />;
    default:
      return null;
  }
});
