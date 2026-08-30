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

export class MercadoLibreApiClient {
  constructor({ apiBaseUrl }) {
    this.apiBaseUrl = apiBaseUrl;
  }

  async request(path, { accessToken, method = 'GET', body, idempotencyKey } = {}) {
    if (!accessToken) {
      const error = new Error('A server-side Mercado Libre access token is required');
      error.code = 'meli_token_required';
      throw error;
    }
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
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
}
