ALTER TABLE products
  ADD COLUMN IF NOT EXISTS confirmed_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS confirmed_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE product_media
  ADD COLUMN IF NOT EXISTS external_url text,
  ADD COLUMN IF NOT EXISTS alt_text text;

ALTER TABLE seller_accounts
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS capabilities_checked_at timestamptz;

CREATE INDEX IF NOT EXISTS listings_product_site_idx ON listings(product_id, site);
CREATE INDEX IF NOT EXISTS product_media_product_sort_idx ON product_media(product_id, sort_order, created_at);
