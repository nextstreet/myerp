import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { productsRoutes } from './routes/products.js';
import { pricingRoutes } from './routes/pricing.js';
import { publishRoutes } from './routes/publish.js';
import { mediaRoutes } from './routes/media.js';
import { mercadoLibreRoutes } from './routes/mercadolibre.js';
import { consoleRoutes } from './routes/console.js';
import { aiStudioRoutes } from './routes/ai-studio.js';
import packageJson from '../package.json' with { type: 'json' };

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left ?? ''));
  const rightBuffer = Buffer.from(String(right ?? ''));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function buildApp({ config, pool, mercadoLibreOAuth = null, consoleSession = null, aiProvider = null }) {
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
          'body.access_token', 'body.refresh_token', 'body.client_secret', 'body.password'
        ],
        censor: '[REDACTED]'
      }
    },
    bodyLimit: Math.max(config.storage.maxImageBytes, 1_000_000)
  });

  const allowedOrigins = new Set(config.corsOrigins);
  if (config.console.publicUrl) allowedOrigins.add(new URL(config.console.publicUrl).origin);
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) callback(null, true);
      else callback(new Error('Origin not allowed'), false);
    }
  });
  await app.register(multipart, {
    limits: { files: 50, fileSize: config.storage.maxVideoBytes }
  });

  app.decorate('config', config);
  app.decorate('db', pool);
  app.decorate('mercadoLibreOAuth', mercadoLibreOAuth);
  app.decorate('consoleSession', consoleSession);
  app.decorate('aiProvider', aiProvider);

  app.get('/health', async () => {
    await pool.query('SELECT 1');
    return {
      ok: true,
      service: 'mercado-libre-ai-listing-console',
      version: packageJson.version,
      mercadoLibreOAuthConfigured: config.mercadoLibre.configured,
      consoleConfigured: config.console.configured,
      aiProviderConfigured: config.ai.configured,
      aiImageGenerationConfigured: Boolean(aiProvider?.supportsImages)
    };
  });

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const supplied = request.headers['x-api-key'];
    const apiKeyValid = Boolean(config.apiKey && supplied && secureEqual(supplied, config.apiKey));
    const consoleValid = Boolean(consoleSession?.verifyRequest(request));
    if (!config.apiKey && config.env !== 'production' && !consoleSession) return;
    if (!apiKeyValid && !consoleValid) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!apiKeyValid && consoleValid && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
        && !consoleSession.originAllowed(request)) {
      return reply.code(403).send({ error: 'origin_not_allowed' });
    }
  });

  await app.register(consoleRoutes);
  await app.register(productsRoutes, { prefix: '/api/products' });
  await app.register(mediaRoutes, { prefix: '/api/products' });
  await app.register(pricingRoutes, { prefix: '/api/pricing' });
  await app.register(publishRoutes, { prefix: '/api/publish' });
  await app.register(mercadoLibreRoutes);
  await app.register(aiStudioRoutes, { prefix: '/api/ai' });

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
