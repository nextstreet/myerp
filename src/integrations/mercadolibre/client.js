const SENSITIVE_KEYS = /authorization|access_token|refresh_token|client_secret|cookie/i;

export function redactSensitive(value) {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      SENSITIVE_KEYS.test(key) ? '[REDACTED]' : redactSensitive(child)
    ]));
  }
  return value;
}

export class MercadoLibreClient {
  constructor(config) {
    this.config = config;
  }

  isConfigured() {
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.accessToken);
  }

  async request(path, { method = 'GET', body, idempotencyKey } = {}) {
    if (!this.isConfigured()) {
      const error = new Error('Mercado Libre OAuth is not configured on the server');
      error.code = 'meli_not_configured';
      throw error;
    }
    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.accessToken}`,
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    return {
      ok: response.ok,
      status: response.status,
      payload: redactSensitive(payload)
    };
  }

  assertPublishingEnabled() {
    if (!this.config.publishEnabled) {
      const error = new Error('Live publishing is disabled by MELI_PUBLISH_ENABLED');
      error.code = 'publishing_disabled';
      throw error;
    }
  }
}
