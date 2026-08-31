import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'ml_console_session';

function equal(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 1) return null;
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter(Boolean));
}

export function hashConsolePassword(password, salt = randomBytes(16)) {
  if (!password || String(password).length < 12) throw new Error('Console password must contain at least 12 characters');
  const derived = scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export class ConsoleSessionService {
  constructor({ passwordHash, sessionSecret, publicUrl, ttlSeconds = 28800, secure = true }) {
    this.passwordHash = passwordHash;
    this.secret = Buffer.from(sessionSecret, 'base64');
    this.publicOrigin = new URL(publicUrl).origin;
    this.ttlSeconds = ttlSeconds;
    this.secure = secure;
    if (this.secret.length !== 32) throw new Error('CONSOLE_SESSION_SECRET must be a base64-encoded 32-byte key');
    this.parsePasswordHash();
  }

  parsePasswordHash() {
    const [algorithm, n, r, p, salt, expected, ...extra] = String(this.passwordHash ?? '').split('$');
    if (algorithm !== 'scrypt' || n !== '16384' || r !== '8' || p !== '1' || !salt || !expected || extra.length) {
      throw new Error('CONSOLE_PASSWORD_HASH has an unsupported format');
    }
    this.passwordSalt = Buffer.from(salt, 'base64url');
    this.expectedPassword = Buffer.from(expected, 'base64url');
    if (this.expectedPassword.length !== 64) throw new Error('CONSOLE_PASSWORD_HASH has an invalid digest');
  }

  authenticate(password) {
    if (typeof password !== 'string' || password.length > 1024) return false;
    const actual = scryptSync(password, this.passwordSalt, 64, { N: 16384, r: 8, p: 1 });
    return actual.length === this.expectedPassword.length && timingSafeEqual(actual, this.expectedPassword);
  }

  createToken(now = Date.now()) {
    const payload = Buffer.from(JSON.stringify({
      exp: Math.floor(now / 1000) + this.ttlSeconds,
      nonce: randomBytes(16).toString('base64url')
    })).toString('base64url');
    const signature = createHmac('sha256', this.secret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  verifyToken(token, now = Date.now()) {
    const [payload, signature, ...extra] = String(token ?? '').split('.');
    if (!payload || !signature || extra.length) return false;
    const expected = createHmac('sha256', this.secret).update(payload).digest('base64url');
    if (!equal(signature, expected)) return false;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return Number.isInteger(data.exp) && data.exp > Math.floor(now / 1000) && typeof data.nonce === 'string';
    } catch {
      return false;
    }
  }

  verifyRequest(request) {
    const cookies = parseCookies(request.headers.cookie);
    return this.verifyToken(cookies[COOKIE_NAME]);
  }

  originAllowed(request) {
    const origin = request.headers.origin;
    return typeof origin === 'string' && origin === this.publicOrigin;
  }

  sessionCookie(token) {
    return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${this.ttlSeconds}; HttpOnly; SameSite=Strict${this.secure ? '; Secure' : ''}`;
  }

  clearCookie() {
    return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${this.secure ? '; Secure' : ''}`;
  }
}
