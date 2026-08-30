import test from 'node:test';
import assert from 'node:assert/strict';
import { MercadoLibreOAuthService } from '../src/integrations/mercadolibre/oauth-service.js';

test('authorization request targets Global Selling and stores only a state hash', async () => {
  const calls = [];
  const service = new MercadoLibreOAuthService({
    config: {
      authBaseUrl: 'https://global-selling.mercadolibre.com',
      apiBaseUrl: 'https://api.mercadolibre.com',
      clientId: '123456',
      redirectUri: 'https://example.com/oauth/callback',
      scope: 'offline_access',
      stateTtlSeconds: 600
    },
    pool: { query: async (sql, values) => { calls.push({ sql, values }); return { rowCount: 1, rows: [{}] }; } },
    cipher: {},
    apiClient: {}
  });
  const result = await service.createAuthorizationRequest();
  const url = new URL(result.authorizationUrl);
  const state = url.searchParams.get('state');
  assert.equal(url.origin, 'https://global-selling.mercadolibre.com');
  assert.equal(url.pathname, '/authorization');
  assert.equal(url.searchParams.get('client_id'), '123456');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.com/oauth/callback');
  assert.equal(url.searchParams.get('scope'), 'offline_access');
  assert.ok(state.length >= 32);
  assert.notEqual(calls[0].values[0], state);
  assert.match(calls[0].values[0], /^[a-f0-9]{64}$/);
});

test('category discovery keeps independent MLM, MCO and MLC results', async () => {
  const paths = [];
  const service = new MercadoLibreOAuthService({ config: {}, pool: {}, cipher: {}, apiClient: {} });
  service.authenticatedRequest = async (_accountId, path) => {
    paths.push(path);
    const site = path.split('/')[2];
    return { ok: true, status: 200, payload: [{ category_id: `${site}-CAT`, category_name: 'Organizer' }] };
  };
  const result = await service.discoverCategories('account-1', { query: 'organizador de escritorio' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.results.map((item) => item.site), ['MLM', 'MCO', 'MLC']);
  assert.deepEqual(result.results.map((item) => item.suggestions[0].categoryId), ['MLM-CAT', 'MCO-CAT', 'MLC-CAT']);
  assert.ok(paths.every((path) => path.includes('domain_discovery/search')));
});
