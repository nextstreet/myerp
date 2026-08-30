function unavailable() {
  const error = new Error('Mercado Libre OAuth is not configured on the server');
  error.code = 'meli_not_configured';
  error.statusCode = 503;
  return error;
}

function safeCallbackHtml(success) {
  const title = success ? 'Mercado Libre connected' : 'Mercado Libre connection failed';
  const message = success
    ? 'Authorization completed. You may return to the listing console.'
    : 'Authorization could not be completed. Return to the listing console and try again.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

export async function mercadoLibreRoutes(app) {
  app.post('/api/integrations/mercadolibre/oauth/connect', async () => {
    if (!app.mercadoLibreOAuth) throw unavailable();
    return app.mercadoLibreOAuth.createAuthorizationRequest();
  });

  app.get('/oauth/callback', async (request, reply) => {
    if (!app.mercadoLibreOAuth) throw unavailable();
    if (request.query?.error) {
      reply.code(400).type('text/html; charset=utf-8');
      return safeCallbackHtml(false);
    }
    try {
      const account = await app.mercadoLibreOAuth.exchangeAuthorizationCode({
        code: request.query?.code,
        state: request.query?.state
      });
      if (app.config.mercadoLibre.successRedirectUrl) {
        const redirect = new URL(app.config.mercadoLibre.successRedirectUrl);
        redirect.searchParams.set('meli', 'connected');
        redirect.searchParams.set('account_id', account.id);
        return reply.redirect(redirect.toString());
      }
      reply.type('text/html; charset=utf-8');
      return safeCallbackHtml(true);
    } catch (error) {
      request.log.warn({ code: error.code }, 'Mercado Libre OAuth callback failed');
      reply.code(error.statusCode && error.statusCode < 500 ? error.statusCode : 502).type('text/html; charset=utf-8');
      return safeCallbackHtml(false);
    }
  });

  app.get('/api/integrations/mercadolibre/accounts', async () => {
    if (!app.mercadoLibreOAuth) throw unavailable();
    return { accounts: await app.mercadoLibreOAuth.listAccounts() };
  });

  app.post('/api/integrations/mercadolibre/accounts/:accountId/refresh', async (request) => {
    if (!app.mercadoLibreOAuth) throw unavailable();
    return app.mercadoLibreOAuth.refreshAccessToken(request.params.accountId);
  });

  app.post('/api/integrations/mercadolibre/accounts/:accountId/smoke-test', async (request) => {
    if (!app.mercadoLibreOAuth) throw unavailable();
    return app.mercadoLibreOAuth.smokeTest(request.params.accountId);
  });
}
