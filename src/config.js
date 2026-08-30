import 'dotenv/config';

function integer(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function bool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === 'true';
}

function csv(value) {
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function loadConfig() {
  const config = {
    env: process.env.NODE_ENV ?? 'development',
    host: process.env.HOST ?? '0.0.0.0',
    port: integer('PORT', 3100),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    apiKey: process.env.APP_API_KEY ?? '',
    corsOrigins: csv(process.env.CORS_ORIGINS ?? 'http://localhost:8080'),
    databaseUrl: process.env.DATABASE_URL ?? '',
    databaseSsl: bool('DATABASE_SSL'),
    storage: {
      driver: process.env.STORAGE_DRIVER ?? 'local',
      localRoot: process.env.STORAGE_LOCAL_ROOT ?? './storage',
      maxImageBytes: integer('MAX_IMAGE_BYTES', 15_000_000),
      maxVideoBytes: integer('MAX_VIDEO_BYTES', 250_000_000)
    },
    ai: {
      provider: process.env.AI_PROVIDER ?? 'disabled',
      baseUrl: process.env.AI_BASE_URL ?? '',
      apiKey: process.env.AI_API_KEY ?? '',
      model: process.env.AI_MODEL ?? ''
    },
    mercadoLibre: {
      clientId: process.env.MELI_CLIENT_ID ?? '',
      clientSecret: process.env.MELI_CLIENT_SECRET ?? '',
      redirectUri: process.env.MELI_REDIRECT_URI ?? '',
      accessToken: process.env.MELI_ACCESS_TOKEN ?? '',
      refreshToken: process.env.MELI_REFRESH_TOKEN ?? '',
      publishEnabled: bool('MELI_PUBLISH_ENABLED'),
      apiBaseUrl: process.env.MELI_API_BASE_URL ?? 'https://api.mercadolibre.com'
    }
  };

  if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
  if (config.env === 'production' && config.apiKey.length < 32) {
    throw new Error('APP_API_KEY must contain at least 32 characters in production');
  }
  if (config.storage.driver !== 'local') {
    throw new Error('Only local storage is implemented in v0.1.0');
  }
  return config;
}
