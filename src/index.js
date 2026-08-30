import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { MercadoLibreClient } from './integrations/mercadolibre/client.js';
import { buildApp } from './app.js';

const config = loadConfig();
const pool = createPool(config);
const mercadoLibreClient = new MercadoLibreClient(config.mercadoLibre);
const app = await buildApp({ config, pool, mercadoLibreClient });

const shutdown = async (signal) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
