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

  app.get('/api/integrations/mercadolibre/accounts/:accountId/capabilities', async (request) => {
    if (!app.mercadoLibreOAuth) throw unavailable();
    return app.mercadoLibreOAuth.inspectCapabilities(request.params.accountId);
  });

  app.get('/api/integrations/mercadolibre/accounts/:accountId/items/:itemId', async (request) => {
    if (!app.mercadoLibreOAuth) throw unavailable();
    const itemId = String(request.params.itemId ?? '').trim().toUpperCase();
    if (!/^(MLM|MCO|MLC)\d{6,15}$/.test(itemId)) {
      const error = new Error('itemId must be a Mexico, Colombia, or Chile Mercado Libre item ID');
      error.statusCode = 400;
      error.code = 'validation_error';
      throw error;
    }
    return app.mercadoLibreOAuth.inspectItem(request.params.accountId, itemId);
  });

  app.post('/api/integrations/mercadolibre/accounts/:accountId/category-requirements', async (request) => {
    if (!app.mercadoLibreOAuth) throw unavailable();
    const categoryIds = request.body?.categoryIds;
    if (!Array.isArray(categoryIds) || categoryIds.length < 1 || categoryIds.length > 10) {
      const error = new Error('categoryIds must contain between 1 and 10 category IDs');
      error.statusCode = 400;
      error.code = 'validation_error';
      throw error;
    }
    return app.mercadoLibreOAuth.categoryRequirements(request.params.accountId, categoryIds.map(String));
  });

  app.post('/api/integrations/mercadolibre/accounts/:accountId/category-discovery', async (request) => {
    if (!app.mercadoLibreOAuth) throw unavailable();
    const query = String(request.body?.query ?? '').trim();
    const sites = request.body?.sites ?? ['MLM', 'MCO', 'MLC'];
    const limit = Math.min(Math.max(Number(request.body?.limit ?? 5), 1), 10);
    const allowedSites = new Set(['MLM', 'MCO', 'MLC']);
    if (query.length < 2 || query.length > 200) {
      const error = new Error('query must contain between 2 and 200 characters');
      error.statusCode = 400;
      error.code = 'validation_error';
      throw error;
    }
    if (!Array.isArray(sites) || !sites.length || sites.some((site) => !allowedSites.has(site))) {
      const error = new Error('sites contains an unsupported site');
      error.statusCode = 400;
      error.code = 'validation_error';
      throw error;
    }
    return app.mercadoLibreOAuth.discoverCategories(request.params.accountId, { query, sites, limit });
  });
}
