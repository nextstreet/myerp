import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { productsRoutes } from './routes/products.js';
import { pricingRoutes } from './routes/pricing.js';
import { publishRoutes } from './routes/publish.js';
import { mediaRoutes } from './routes/media.js';
import { mercadoLibreRoutes } from './routes/mercadolibre.js';

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''));
  const rightBuffer = Buffer.from(String(right ?? ''));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function buildApp({ config, pool, mercadoLibreOAuth = null }) {
  const app = Fastify({
    // Default request logs include the full callback URL and could expose the
    // short-lived OAuth code/state. Application logs below use explicit,
    // non-sensitive fields instead.
    disableRequestLogging: true,
    logger: {
      level: config.logLevel,
      redact: {
        paths: [
          'req.headers.authorization', 'req.headers.cookie', 'req.headers.x-api-key',
          'body.access_token', 'body.refresh_token', 'body.client_secret'
        ],
        censor: '[REDACTED]'
      }
    },
    bodyLimit: Math.max(config.storage.maxImageBytes, 1_000_000)
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) callback(null, true);
      else callback(new Error('Origin not allowed'), false);
    }
  });
  await app.register(multipart, {
    limits: { files: 50, fileSize: config.storage.maxVideoBytes }
  });

  app.decorate('config', config);
  app.decorate('db', pool);
  app.decorate('mercadoLibreOAuth', mercadoLibreOAuth);

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return {
      ok: true,
      service: 'mercado-libre-ai-listing-console',
      version: '0.4.0',
      mercadoLibreOAuthConfigured: config.mercadoLibre.configured
    };
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (!config.apiKey && config.env !== 'production') return;
    const supplied = request.headers['x-api-key'];
    if (!supplied || !secureEqual(supplied, config.apiKey)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  await app.register(productsRoutes, { prefix: '/api/products' });
  await app.register(mediaRoutes, { prefix: '/api/products' });
  await app.register(pricingRoutes, { prefix: '/api/pricing' });
  await app.register(publishRoutes, { prefix: '/api/publish' });
  await app.register(mercadoLibreRoutes);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, code: error.code }, 'request failed');
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    reply.code(status).send({
      error: error.code ?? 'internal_error',
      message: status < 500 || config.env !== 'production' ? error.message : 'Internal server error',
      ...(error.details ? { details: error.details } : {})
    });
  });

  return app;
}
