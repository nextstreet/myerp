CREATE TABLE IF NOT EXISTS product_fact_sheets (
  product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE RESTRICT,
  manual_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_suggestions jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmed_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_generations
  ADD COLUMN IF NOT EXISTS request_key text,
  ADD COLUMN IF NOT EXISTS selected_media_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE product_media
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_media_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS ai_generation_id uuid REFERENCES ai_generations(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS ai_generations_request_key_unique_idx
  ON ai_generations(request_key)
  WHERE request_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_generations_product_created_idx
  ON ai_generations(product_id, created_at DESC);

DROP TRIGGER IF EXISTS product_fact_sheets_set_updated_at ON product_fact_sheets;
CREATE TRIGGER product_fact_sheets_set_updated_at BEFORE UPDATE ON product_fact_sheets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
