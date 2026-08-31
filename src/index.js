import { loadConfig } from './config.js';
import { createPool, registerSiteCodeArrayParser } from './db/pool.js';
import { MercadoLibreApiClient } from './integrations/mercadolibre/client.js';
import { MercadoLibreOAuthService } from './integrations/mercadolibre/oauth-service.js';
import { TokenCipher } from './integrations/mercadolibre/token-cipher.js';
import { startTokenRefreshScheduler } from './integrations/mercadolibre/token-refresher.js';
import { buildApp } from './app.js';
import { ConsoleSessionService } from './auth/console-session.js';
import { createAiProvider } from './integrations/ai/provider.js';

const config = loadConfig();
const pool = createPool(config);
// Register the site_code[] array parser before the server accepts requests so
// target_sites is always returned as a real JS array (no first-query race).
await registerSiteCodeArrayParser(pool);
const mercadoLibreOAuth = config.mercadoLibre.configured
  ? new MercadoLibreOAuthService({
      config: config.mercadoLibre,
      pool,
      cipher: new TokenCipher(config.mercadoLibre.tokenEncryptionKey),
      apiClient: new MercadoLibreApiClient(config.mercadoLibre)
    })
  : null;
const consoleSession = config.console.configured
  ? new ConsoleSessionService({
      passwordHash: config.console.passwordHash,
      sessionSecret: config.console.sessionSecret,
      publicUrl: config.console.publicUrl,
      ttlSeconds: config.console.sessionTtlSeconds,
      secure: config.console.publicUrl.startsWith('https://')
    })
  : null;
const aiProvider = createAiProvider(config.ai);
const app = await buildApp({ config, pool, mercadoLibreOAuth, consoleSession, aiProvider });
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
