import test from 'node:test';
import assert from 'node:assert/strict';
import { MercadoLibreApiClient, redactSensitive } from '../src/integrations/mercadolibre/client.js';

test('recursive API log redaction removes credentials', () => {
  const redacted = redactSensitive({
    access_token: 'secret-a',
    nested: { refresh_token: 'secret-b', ok: 'visible' },
    items: [{ client_secret: 'secret-c' }]
  });
  assert.deepEqual(redacted, {
    access_token: '[REDACTED]',
    nested: { refresh_token: '[REDACTED]', ok: 'visible' },
    items: [{ client_secret: '[REDACTED]' }]
  });
});

test('picture upload uses authenticated multipart without logging the token', async () => {
  const originalFetch = globalThis.fetch;
  let observed;
  globalThis.fetch = async (url, options) => {
    observed = { url, options };
    return { ok: true, status: 201, async json() { return { id: 'PIC-DEMO' }; } };
  };
  try {
    const client = new MercadoLibreApiClient({ apiBaseUrl: 'https://api.example.test' });
    const response = await client.uploadPicture({
      accessToken: 'server-only-token', bytes: Buffer.from('demo'), mimeType: 'image/png', filename: 'demo.png'
    });
    assert.equal(response.payload.id, 'PIC-DEMO');
    assert.equal(observed.url, 'https://api.example.test/pictures/items/upload');
    assert.equal(observed.options.headers.authorization, 'Bearer server-only-token');
    assert.ok(observed.options.body instanceof FormData);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
