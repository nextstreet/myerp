ALTER TABLE products
  ADD COLUMN IF NOT EXISTS workflow_type text NOT NULL DEFAULT 'new_product';

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_workflow_type_check;
ALTER TABLE products ADD CONSTRAINT products_workflow_type_check
  CHECK (workflow_type IN ('new_product', 'add_variants'));

CREATE TABLE IF NOT EXISTS product_category_assessments (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  site site_code NOT NULL,
  search_query text NOT NULL,
  ai_rationale text,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_category_id text,
  selected_category_name text,
  variation_attributes jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_variant_axes jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_variant_axes jsonb NOT NULL DEFAULT '[]'::jsonb,
  supports_variations boolean,
  status text NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'confirmed', 'unsupported', 'lookup_failed')),
  checked_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  PRIMARY KEY (product_id, site)
);

CREATE INDEX IF NOT EXISTS product_category_assessments_status_idx
  ON product_category_assessments(product_id, status);
