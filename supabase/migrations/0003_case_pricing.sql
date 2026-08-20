-- Adds tiered case pricing so a customer buying enough bottles of one SKU to
-- fill a case (or five cases) automatically gets that tier's per-bottle
-- price, on both the cart drawer's estimate and create-checkout-session's
-- authoritative recompute — see src/pricing.ts#effectiveUnitPriceCents,
-- the single function both sides call.
--
-- case_size / five_case_size are in bottles and are per-product (they vary
-- by category — e.g. wine cases are often 6, spirits often 12), supplied
-- later per SKU. Left null until then, which keeps that tier inactive
-- (src/cart.ts only renders a case/five-case price as clickable once its
-- size is known) rather than guessing and mispricing an order.

alter table product_variants
  add column case_size            integer check (case_size > 0),
  add column five_case_size       integer check (five_case_size > 0),
  add column five_case_price_cents integer check (five_case_price_cents >= 0);

comment on column product_variants.case_price_cents is
  'Per-bottle price once qty >= case_size (not the whole case''s total price).';
comment on column product_variants.five_case_price_cents is
  'Per-bottle price once qty >= five_case_size (not the whole batch''s total price).';
