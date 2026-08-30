import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { TokenCipher } from '../src/integrations/mercadolibre/token-cipher.js';

test('OAuth tokens round-trip through AES-256-GCM without plaintext leakage', () => {
  const cipher = new TokenCipher(randomBytes(32).toString('base64'));
  const plaintext = 'test-access-token-value';
  const encrypted = cipher.encrypt(plaintext, 'access:123');
  assert.ok(encrypted.startsWith('v1:'));
  assert.equal(encrypted.includes(plaintext), false);
  assert.equal(cipher.decrypt(encrypted, 'access:123'), plaintext);
});

test('encrypted tokens cannot be decrypted with a different context', () => {
  const cipher = new TokenCipher(randomBytes(32).toString('base64'));
  const encrypted = cipher.encrypt('test-refresh-token', 'refresh:123');
  assert.throws(() => cipher.decrypt(encrypted, 'access:123'));
});

test('tampered encrypted token is rejected', () => {
  const cipher = new TokenCipher(randomBytes(32).toString('base64'));
  const encrypted = cipher.encrypt('secret', 'access:123');
  const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => cipher.decrypt(tampered, 'access:123'));
});
