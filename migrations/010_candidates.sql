CREATE TABLE IF NOT EXISTS candidates (
  id text PRIMARY KEY,
  batch_id text NOT NULL DEFAULT '',
  data jsonb NOT NULL,
  category_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  product_id uuid UNIQUE REFERENCES products(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidates_batch_idx ON candidates(batch_id, updated_at DESC);
CREATE TRIGGER candidates_set_updated_at BEFORE UPDATE ON candidates
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
