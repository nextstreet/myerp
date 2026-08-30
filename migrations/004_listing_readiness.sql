ALTER TABLE product_media
  ADD COLUMN IF NOT EXISTS mercado_picture_id text,
  ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'pending';

ALTER TABLE variant_media
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

ALTER TABLE listing_variants
  ADD COLUMN IF NOT EXISTS pricing_basis jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS product_media_meli_picture_unique_idx
  ON product_media(mercado_picture_id)
  WHERE mercado_picture_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS variant_media_one_primary_idx
  ON variant_media(variant_id)
  WHERE is_primary = true;
