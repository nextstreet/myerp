import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProductUrl, extractProductHtml, extractProductUrl, extractMercadoProduct } from '../src/integrations/marketplace-research.js';

const amazon = 'https://www.amazon.com/dp/B07BHKNTHY';
const shopee = 'https://shopee.com.br/Organizador-de-mesa-5-gavetas-i.460775116.21276485376';
const html = `<!doctype html><html><head><meta name="description" content="A metal desk organizer with compartments"></head><body><h1 id="productTitle">Metal Mesh Desk Organizer</h1><div id="feature-bullets"><span class="a-list-item">Four compartments</span></div></body></html>`;

test('only known HTTPS product-detail URLs may be fetched', () => {
  assert.equal(classifyProductUrl(amazon).platform, 'Amazon');
  assert.equal(classifyProductUrl(shopee).platform, 'Shopee');
  assert.equal(classifyProductUrl('https://produto.mercadolivre.com.br/MLB-3759734241-foo-_JM').platform, 'MLB');
  for (const url of ['http://www.amazon.com/dp/B07BHKNTHY', 'https://amazon.com.evil.test/dp/B07BHKNTHY', 'https://www.amazon.com@127.0.0.1/dp/B07BHKNTHY', 'https://www.temu.com/desk-drawer-storage-s.html']) assert.throws(() => classifyProductUrl(url));
});
test('extracts evidenced content and never treats JS shells as product content', async () => {
  const response = await extractProductUrl(amazon, async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }));
  assert.equal(response.status, 'extracted'); assert.equal(response.title, 'Metal Mesh Desk Organizer');
  assert.equal(response.description, 'A metal desk organizer with compartments');
  assert.deepEqual(response.bullets, ['Four compartments']);
  assert.equal(extractProductHtml('<!doctype html><html><title>Temu</title><p>Please enable JavaScript</p></html>', 'Temu').usable, false);
  const shell = await extractProductUrl(shopee, async () => new Response('<!doctype html><html>Please enable JavaScript</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  assert.equal(shell.status, 'unavailable'); assert.deepEqual(shell.fields, []);
});
test('extracts JSON-LD Product attributes and rejects cross-site redirects', async () => {
  const product = '<!doctype html><html><script type="application/ld+json">{"@type":"Product","name":"Desk Organizer with Drawers","description":"Two drawers and a rotating holder","additionalProperty":[{"name":"Material","value":"Plastic"}]}</script></html>';
  const parsed = extractProductHtml(product, 'Temu'); assert.equal(parsed.attributes.Material, 'Plastic'); assert.equal(parsed.usable, true);
  const redirected = await extractProductUrl(amazon, async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/internal' } }));
  assert.equal(redirected.status, 'blocked');
  const denied = await extractProductUrl(amazon, async () => new Response('denied', { status: 403 })); assert.equal(denied.httpStatus, 403);
});
test('Mercado Libre blocked HTML can use authenticated official item and category tree', async () => {
  const oauth = { authenticatedRequest: async (_account, path) => {
    if (path === '/items/MLB3759734241') return { ok: true, payload: { id: 'MLB3759734241', title: 'Organizador de mesa com duas gavetas', category_id: 'MLB123', attributes: [{ id: 'MATERIAL', value_name: 'Plástico' }] } };
    if (path.endsWith('/description')) return { ok: true, payload: { plain_text: 'Duas gavetas e porta-canetas.' } };
    return { ok: true, payload: { path_from_root: [{ id: 'MLB10', name: 'Casa' }, { id: 'MLB123', name: 'Organizadores' }] } };
  } };
  const url = 'https://produto.mercadolivre.com.br/MLB-3759734241-organizador-_JM';
  const result = await extractMercadoProduct(url, 'account', oauth, async () => new Response('blocked', { status: 403 }));
  assert.equal(result.status, 'extracted'); assert.equal(result.sourceMethod, 'official_item_api');
  assert.equal(result.categoryId, 'MLB123'); assert.deepEqual(result.categoryPath.map(x => x.name), ['Casa', 'Organizadores']);
  assert.equal(result.attributes.MATERIAL, 'Plástico');
});
