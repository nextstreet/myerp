ALTER TABLE product_media
  ADD COLUMN IF NOT EXISTS mercado_upload_error text,
  ADD COLUMN IF NOT EXISTS mercado_uploaded_at timestamptz;

ALTER TABLE variants
  ADD COLUMN IF NOT EXISTS global_net_proceeds_usd numeric(14, 2)
    CHECK (global_net_proceeds_usd IS NULL OR global_net_proceeds_usd > 0);

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS mercado_libre_family_id text;

ALTER TABLE listing_variants
  ADD COLUMN IF NOT EXISTS mercado_libre_global_item_id text,
  ADD COLUMN IF NOT EXISTS mercado_libre_item_id text,
  ADD COLUMN IF NOT EXISTS publish_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS publish_error jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE publish_jobs
  ADD COLUMN IF NOT EXISTS variant_id uuid REFERENCES variants(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS operation text NOT NULL DEFAULT 'publish';

CREATE INDEX IF NOT EXISTS publish_jobs_product_operation_idx
  ON publish_jobs(product_id, operation, created_at DESC);

CREATE INDEX IF NOT EXISTS listing_variants_item_idx
  ON listing_variants(mercado_libre_item_id)
  WHERE mercado_libre_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS listing_variants_global_item_idx
  ON listing_variants(mercado_libre_global_item_id)
  WHERE mercado_libre_global_item_id IS NOT NULL;
