CREATE TABLE IF NOT EXISTS seller_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meli_user_id bigint NOT NULL UNIQUE,
  nickname text,
  site_default text,
  account_type text NOT NULL DEFAULT 'global_selling',
  granted_scopes text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'connected',
  last_verified_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  seller_account_id uuid PRIMARY KEY REFERENCES seller_accounts(id) ON DELETE CASCADE,
  access_token_enc text NOT NULL,
  refresh_token_enc text,
  access_expires_at timestamptz NOT NULL,
  token_type text NOT NULL DEFAULT 'bearer',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_tokens_expiry_idx ON oauth_tokens(access_expires_at);

CREATE TABLE IF NOT EXISTS oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_states_active_idx ON oauth_states(expires_at) WHERE consumed_at IS NULL;

DROP TRIGGER IF EXISTS seller_accounts_set_updated_at ON seller_accounts;
CREATE TRIGGER seller_accounts_set_updated_at BEFORE UPDATE ON seller_accounts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
