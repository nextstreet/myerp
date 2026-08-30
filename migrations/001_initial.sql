CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE product_status AS ENUM (
    'pending_import', 'pending_ai', 'ai_processing', 'pending_review',
    'pending_publish', 'publishing', 'published', 'publish_failed', 'paused'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE site_code AS ENUM ('MLM', 'MCO', 'MLC');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_code text NOT NULL UNIQUE,
  source_url text,
  original_title text NOT NULL,
  category_hint text,
  purchase_price_cny numeric(12, 4) NOT NULL CHECK (purchase_price_cny >= 0),
  packed_weight_g integer NOT NULL CHECK (packed_weight_g > 0),
  product_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  package_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  target_sites site_code[] NOT NULL DEFAULT ARRAY['MLM','MCO','MLC']::site_code[],
  status product_status NOT NULL DEFAULT 'pending_ai',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  seller_sku text NOT NULL UNIQUE,
  color text,
  size text,
  other_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  purchase_price_cny numeric(12, 4) CHECK (purchase_price_cny >= 0),
  packed_weight_g integer CHECK (packed_weight_g > 0),
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  participate_in_publish boolean NOT NULL DEFAULT true,
  confirmed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS variants_product_id_idx ON variants(product_id);

CREATE TABLE IF NOT EXISTS product_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  media_type text NOT NULL CHECK (media_type IN ('image', 'video', 'archive')),
  role text NOT NULL DEFAULT 'original',
  storage_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  prompt text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS variant_media (
  variant_id uuid NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  media_id uuid NOT NULL REFERENCES product_media(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (variant_id, media_id)
);

CREATE TABLE IF NOT EXISTS listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  site site_code NOT NULL,
  title text,
  description_english text,
  specifications_english jsonb NOT NULL DEFAULT '{}'::jsonb,
  category_id text,
  required_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  family_name text,
  family_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_product_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  currency text NOT NULL,
  target_profit_usd numeric(12, 4),
  target_margin_rate numeric(8, 6),
  pricing_basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  publish_status text NOT NULL DEFAULT 'draft',
  mercado_libre_item_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, site)
);

CREATE TABLE IF NOT EXISTS listing_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  price numeric(14, 2) NOT NULL CHECK (price >= 0),
  promotional_price numeric(14, 2) CHECK (promotional_price >= 0),
  currency text NOT NULL,
  mercado_libre_user_product_id text,
  mercado_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(listing_id, variant_id)
);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  listing_id uuid REFERENCES listings(id) ON DELETE RESTRICT,
  site site_code NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  request_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  http_status integer,
  error_code text,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS ai_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  listing_id uuid REFERENCES listings(id) ON DELETE RESTRICT,
  generation_type text NOT NULL,
  provider text NOT NULL,
  model text,
  prompt_version text NOT NULL,
  input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_set_updated_at ON products;
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS variants_set_updated_at ON variants;
CREATE TRIGGER variants_set_updated_at BEFORE UPDATE ON variants
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS listings_set_updated_at ON listings;
CREATE TRIGGER listings_set_updated_at BEFORE UPDATE ON listings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
