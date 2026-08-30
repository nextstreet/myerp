import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db/pool.js';
import { MercadoLibreApiClient } from '../src/integrations/mercadolibre/client.js';
import { MercadoLibreOAuthService } from '../src/integrations/mercadolibre/oauth-service.js';
import { TokenCipher } from '../src/integrations/mercadolibre/token-cipher.js';

const config = loadConfig();
if (!config.mercadoLibre.configured) throw new Error('Mercado Libre OAuth is not configured');
const pool = createPool(config);
const service = new MercadoLibreOAuthService({
  config: config.mercadoLibre,
  pool,
  cipher: new TokenCipher(config.mercadoLibre.tokenEncryptionKey),
  apiClient: new MercadoLibreApiClient(config.mercadoLibre)
});

try {
  const result = await pool.query(`
    SELECT seller_account_id FROM oauth_tokens
    WHERE access_expires_at <= now() + interval '30 minutes'
  `);
  for (const row of result.rows) {
    await service.refreshAccessToken(row.seller_account_id);
    console.log(`Refreshed Mercado Libre account ${row.seller_account_id}`);
  }
} finally {
  await pool.end();
}
