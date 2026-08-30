import test from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitive } from '../src/integrations/mercadolibre/client.js';

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
