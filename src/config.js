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

function optionalUrl(name, fallback = '') {
  const value = process.env[name] ?? fallback;
  if (!value) return '';
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }
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
      model: process.env.AI_MODEL ?? '',
      visionModel: process.env.AI_VISION_MODEL ?? process.env.AI_MODEL ?? '',
      imageModel: process.env.AI_IMAGE_MODEL ?? '',
      requestTimeoutMs: integer('AI_REQUEST_TIMEOUT_MS', 120000),
      maxInputImages: integer('AI_MAX_INPUT_IMAGES', 8),
      maxInputImageBytes: integer('AI_MAX_INPUT_IMAGE_BYTES', 5_000_000),
      generatedImageSize: process.env.AI_GENERATED_IMAGE_SIZE ?? '1024x1024'
    },
    console: {
      passwordHash: process.env.CONSOLE_PASSWORD_HASH ?? '',
      sessionSecret: process.env.CONSOLE_SESSION_SECRET ?? '',
      publicUrl: optionalUrl('CONSOLE_PUBLIC_URL'),
      sessionTtlSeconds: integer('CONSOLE_SESSION_TTL_SECONDS', 28800)
    },
    mercadoLibre: {
      clientId: process.env.MELI_CLIENT_ID ?? '',
      clientSecret: process.env.MELI_CLIENT_SECRET ?? '',
      redirectUri: process.env.MELI_REDIRECT_URI ?? '',
      tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? '',
      scope: process.env.MELI_SCOPE ?? 'offline_access',
      authBaseUrl: optionalUrl('MELI_AUTH_BASE_URL', 'https://global-selling.mercadolibre.com'),
      apiBaseUrl: optionalUrl('MELI_API_BASE_URL', 'https://api.mercadolibre.com'),
      successRedirectUrl: optionalUrl('OAUTH_SUCCESS_REDIRECT_URL'),
      stateTtlSeconds: integer('OAUTH_STATE_TTL_SECONDS', 600),
      refreshIntervalSeconds: integer('TOKEN_REFRESH_INTERVAL_SECONDS', 600),
      publishEnabled: bool('MELI_PUBLISH_ENABLED'),
    }
  };

  if (!config.databaseUrl) throw new Error('DATABASE_URL is required');
  if (config.env === 'production' && config.apiKey.length < 32) {
    throw new Error('APP_API_KEY must contain at least 32 characters in production');
  }
  if (config.storage.driver !== 'local') {
    throw new Error('Only local storage is implemented in v0.6.0');
  }
  const supportedAiProviders = new Set(['disabled', 'openai-compatible']);
  if (!supportedAiProviders.has(config.ai.provider)) throw new Error(`Unsupported AI_PROVIDER: ${config.ai.provider}`);
  config.ai.configured = config.ai.provider !== 'disabled'
    && Boolean(config.ai.baseUrl && config.ai.apiKey && config.ai.model);
  if (config.ai.provider !== 'disabled' && !config.ai.configured) {
    throw new Error('AI_BASE_URL, AI_API_KEY and AI_MODEL are required when AI_PROVIDER is enabled');
  }
  if (config.ai.maxInputImages < 1 || config.ai.maxInputImages > 20) {
    throw new Error('AI_MAX_INPUT_IMAGES must be between 1 and 20');
  }
  if (!/^\d+x\d+$/.test(config.ai.generatedImageSize)) {
    throw new Error('AI_GENERATED_IMAGE_SIZE must use WIDTHxHEIGHT format');
  }
  const consoleValues = [config.console.passwordHash, config.console.sessionSecret, config.console.publicUrl];
  config.console.configured = consoleValues.every(Boolean);
  if (consoleValues.some(Boolean) && !config.console.configured) {
    throw new Error('CONSOLE_PASSWORD_HASH, CONSOLE_SESSION_SECRET and CONSOLE_PUBLIC_URL must be configured together');
  }
  if (config.console.configured) {
    const consoleKey = Buffer.from(config.console.sessionSecret, 'base64');
    if (consoleKey.length !== 32) throw new Error('CONSOLE_SESSION_SECRET must be a base64-encoded 32-byte key');
  }
  const meliValues = [
    config.mercadoLibre.clientId,
    config.mercadoLibre.clientSecret,
    config.mercadoLibre.redirectUri,
    config.mercadoLibre.tokenEncryptionKey
  ];
  const meliConfigured = meliValues.every(Boolean);
  if (meliValues.some(Boolean) && !meliConfigured) {
    throw new Error('MELI_CLIENT_ID, MELI_CLIENT_SECRET, MELI_REDIRECT_URI and TOKEN_ENCRYPTION_KEY must be configured together');
  }
  if (meliConfigured) {
    const key = Buffer.from(config.mercadoLibre.tokenEncryptionKey, 'base64');
    if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    try {
      new URL(config.mercadoLibre.redirectUri);
    } catch {
      throw new Error('MELI_REDIRECT_URI must be a valid absolute URL');
    }
  }
  config.mercadoLibre.configured = meliConfigured;
  return config;
}
