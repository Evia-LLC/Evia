-- Who sells a catalogue product, when the import says so.
--
-- The Products page's button reads "Shop at {retailer}" and must name the
-- product's own retailer. A catalogue import may give it per product
-- ("retailer": "Sephora"); when it does not, the name is worked out from the
-- product link at read time (shared/retailer.ts), so existing rows need no
-- backfill and stay NULL. (Formerly server/db/migrations/016_catalogue_retailer.sql
-- on the visual-rebuild branch, before persistence moved to Supabase.)
ALTER TABLE public.catalogue_products ADD COLUMN IF NOT EXISTS retailer TEXT;
