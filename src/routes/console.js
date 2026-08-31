import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../console');
const attempts = new Map();

// Relaxed for testing: allow many attempts in a short window, then a brief cooldown.
// Not a production-grade throttle; tune before putting this behind a public login.
function rateLimited(ip, now = Date.now()) {
  const windowMs = 60 * 1000;   // 1-minute window
  const maxAttempts = 200;      // generous threshold for interactive testing
  const current = attempts.get(ip);
  if (!current || current.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }
  current.count += 1;
  return current.count > maxAttempts;
}

export async function consoleRoutes(app) {
  app.get('/console', async (_request, reply) => {
    reply.type('text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('content-security-policy', "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer');
    return reply.send(await readFile(join(root, 'index.html')));
  });

  app.get('/console/styles.css', async (_request, reply) => {
    reply.type('text/css; charset=utf-8').header('cache-control', 'public, max-age=300');
    return reply.send(await readFile(join(root, 'styles.css')));
  });

  app.get('/console/app.js', async (_request, reply) => {
    reply.type('application/javascript; charset=utf-8').header('cache-control', 'public, max-age=300');
    return reply.send(await readFile(join(root, 'app.js')));
  });

  app.get('/console/api/session', async (request, reply) => {
    if (!app.consoleSession) return reply.code(503).send({ configured: false, authenticated: false });
    return { configured: true, authenticated: app.consoleSession.verifyRequest(request) };
  });

  app.post('/console/api/login', async (request, reply) => {
    if (!app.consoleSession) return reply.code(503).send({ error: 'console_not_configured' });
    if (!app.consoleSession.originAllowed(request)) return reply.code(403).send({ error: 'origin_not_allowed' });
    const ip = request.ip;
    if (rateLimited(ip)) return reply.code(429).send({ error: 'too_many_login_attempts' });
    if (!app.consoleSession.authenticate(request.body?.password)) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    attempts.delete(ip);
    reply.header('set-cookie', app.consoleSession.sessionCookie(app.consoleSession.createToken()));
    return { ok: true };
  });

  app.post('/console/api/logout', async (request, reply) => {
    if (app.consoleSession && !app.consoleSession.originAllowed(request)) {
      return reply.code(403).send({ error: 'origin_not_allowed' });
    }
    if (app.consoleSession) reply.header('set-cookie', app.consoleSession.clearCookie());
    return { ok: true };
  });
}
