import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ConsoleSessionService, hashConsolePassword } from '../src/auth/console-session.js';

const NON_SECRET_TEST_PASSWORD = `test-${'x'.repeat(20)}`;

function service() {
  return new ConsoleSessionService({
    passwordHash: hashConsolePassword(NON_SECRET_TEST_PASSWORD),
    sessionSecret: randomBytes(32).toString('base64'),
    publicUrl: 'https://mercado.example.com',
    ttlSeconds: 60,
    secure: true
  });
}

test('console password is hashed and verified without storing plaintext', () => {
  const auth = service();
  assert.equal(auth.passwordHash.includes(NON_SECRET_TEST_PASSWORD), false);
  assert.equal(auth.authenticate(NON_SECRET_TEST_PASSWORD), true);
  assert.equal(auth.authenticate(`${NON_SECRET_TEST_PASSWORD}-invalid`), false);
});

test('console session is signed, expires and uses secure cookie flags', () => {
  const auth = service();
  const now = Date.now();
  const token = auth.createToken(now);
  assert.equal(auth.verifyToken(token, now + 30_000), true);
  assert.equal(auth.verifyToken(`${token}x`, now + 30_000), false);
  assert.equal(auth.verifyToken(token, now + 61_000), false);
  assert.match(auth.sessionCookie(token), /HttpOnly; SameSite=Strict; Secure/);
});
