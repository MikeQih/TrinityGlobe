-- -----------------------------------------------------------------------
-- Resolves the products.json merge conflict between `dev` and `main`
-- (main's automated "Update Products" pipeline added 4 real products and
-- updated several real prices while dev was adding sku/caseSize fields the
-- pipeline has no idea exist — see PROJECT_STATUS.md for the full
-- comparison). This migration is the database-side half of that
-- resolution: the 4 new products need a real product_variants + inventory
-- row before they're actually sellable (products.json alone only affects
-- what's *displayed* — create-checkout-session.ts and get_available_stock
-- both key off product_variants/inventory by sku), and Martell VSOP's
-- price genuinely changed on main.
--
-- Stock for all 4 new SKUs is seeded at the same temporary baseline (50)
-- as every other SKU — see PROJECT_STATUS.md's standing note that this
-- number is not real inventory and must be replaced with a real count
-- before launch, same caveat as everything else already at 50.
-- -----------------------------------------------------------------------

insert into product_variants (sku, name_snapshot, unit_price_cents, case_price_cents, case_size)
values
  ('COGNAC-LOUIS-XIII', 'LOUIS XIII', 380000, 370000, 12),
  ('COGNAC-MARTELL-NOBLIGE', 'Martell Noblige', 10500, 10000, 12),
  ('WHISKY-HAKUSHU-DISTILLERS-RESERVE-700ML', 'HAKUSHU DISTILLER''S RESERVE 700ML 43%', 13500, 13000, 12),
  ('WINE-SIGAUT-CHAMBOLLE-SENTIERS-2022', 'Domaine Anne et Hervé Sigaut 2022 Chambolle-Musigny 1er Cru Les Sentiers Vieilles Vignes', 23000, 22200, 12);

insert into inventory (sku, website_stock)
values
  ('COGNAC-LOUIS-XIII', 50),
  ('COGNAC-MARTELL-NOBLIGE', 50),
  ('WHISKY-HAKUSHU-DISTILLERS-RESERVE-700ML', 50),
  ('WINE-SIGAUT-CHAMBOLLE-SENTIERS-2022', 50);

-- Martell VSOP: same product, same SKU, same database identity (no history
-- broken) — main's pipeline genuinely re-priced it (S$90/S$85 -> S$100/S$95)
-- and swapped its photo. The photo change lives only in products.json
-- (product_variants has no image column), so only the price half needs a
-- database update.
update product_variants
set unit_price_cents = 10000, case_price_cents = 9500
where sku = 'COGNAC-MARTELL-VSOP';

-- The other 18 real price changes main's pipeline made while the branches
-- were diverged (dev never touched these, so there's no conflict — just a
-- values sync). Without this, products.json would *display* main's new
-- prices while create-checkout-session.ts kept charging the stale
-- product_variants price it's actually authoritative for — a real
-- customer-facing price mismatch, not a cosmetic one.
update product_variants as pv
set unit_price_cents = v.bottle_cents, case_price_cents = v.case_cents
from (values
  ('COGNAC-MARTELL-CORDON-BLEU', 22000, 21000),
  ('WHISKY-MACALLAN-12-SHERRY-OAK', 15500, 15000),
  ('CHAMP-DOM-PERIGNON-2015', 28500, 28000),
  ('CHAMP-DOM-PERIGNON-2013', 31000, 30000),
  ('WINE-PENFOLDS-BIN-389', 11000, 10500),
  ('WINE-PENFOLDS-BIN-407', 13000, 11500),
  ('BAIJIU-MOUTAI-FEITIAN', 31000, 30000),
  ('BAIJIU-MOUTAI-15-YEAR', 125000, 120000),
  ('BAIJIU-MOUTAI-30-YEAR', 300000, 280000),
  ('BAIJIU-MOUTAI-50-YEAR', 500000, 480000),
  ('BAIJIU-WULIANGYE', 21000, 20000),
  ('BAIJIU-GUOJIAO-1573', 21000, 19500),
  ('BAIJIU-YANGHE-NEW-SKY-BLUE', 4500, 4000),
  ('BAIJIU-YANGHE-SKY-BLUE-42', 8000, 7500),
  ('BAIJIU-YANGHE-SKY-BLUE-52', 9000, 8500),
  ('BAIJIU-YANGHE-DREAM-BLUE-CRYSTAL-40-8', 11500, 11000),
  ('BAIJIU-YANGHE-DREAM-BLUE-CRYSTAL-52', 13500, 13000),
  ('BAIJIU-YANGHE-DREAM-BLUE-M9', 29500, 28000),
  ('BAIJIU-YANGHE-DREAM-BLUE-HANDCRAFTED', 35000, 34000)
) as v(sku, bottle_cents, case_cents)
where pv.sku = v.sku;
