-- Delivery options at checkout (D135): what a carrier offered a shopper's cart. Private: only server code with a direct
-- connection reads it. A cart's chosen quote (`carts.delivery_quote_id`) is only honoured when the quote is the cart's own,
-- for its country and not expired, which `chosenDelivery()` checks, so cart and order always read the same price.
ALTER TABLE commerce.delivery_quotes ENABLE ROW LEVEL SECURITY;
