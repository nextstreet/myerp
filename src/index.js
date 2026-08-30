import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { MercadoLibreApiClient } from './integrations/mercadolibre/client.js';
import { MercadoLibreOAuthService } from './integrations/mercadolibre/oauth-service.js';
import { TokenCipher } from './integrations/mercadolibre/token-cipher.js';
import { startTokenRefreshScheduler } from './integrations/mercadolibre/token-refresher.js';
import { buildApp } from './app.js';

const config = loadConfig();
const pool = createPool(config);
const mercadoLibreOAuth = config.mercadoLibre.configured
  ? new MercadoLibreOAuthService({
      config: config.mercadoLibre,
      pool,
      cipher: new TokenCipher(config.mercadoLibre.tokenEncryptionKey),
      apiClient: new MercadoLibreApiClient(config.mercadoLibre)
    })
  : null;
const app = await buildApp({ config, pool, mercadoLibreOAuth });
const tokenScheduler = mercadoLibreOAuth
  ? startTokenRefreshScheduler({
      service: mercadoLibreOAuth,
      pool,
      logger: app.log,
      intervalSeconds: config.mercadoLibre.refreshIntervalSeconds
    })
  : null;

const shutdown = async (signal) => {
  app.log.info({ signal }, 'shutting down');
  tokenScheduler?.stop();
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
