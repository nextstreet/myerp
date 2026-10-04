import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import Fastify from 'fastify';
import { candidatesRoutes } from '../src/routes/candidates.js';
import { productsRoutes } from '../src/routes/products.js';
import { publishRoutes } from '../src/routes/publish.js';
import { readyCandidate } from './helpers/candidate-fixture.js';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';
import pgUtils from 'pg/lib/utils.js';

test('candidate import, official check, editable UI and transactional draft conversion', async t => {
  const pg = new PGlite();
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).sort()) {
    const sql = (await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', '');
    await pg.exec(sql);
  }
  // PGlite uses the actual PostgreSQL engine. Its rowCount equivalent is affectedRows.
  const db = { query: async (sql, args) => { const r = await pg.query(sql, args?.map(v => pgUtils.prepareValue(v))); return { ...r, rowCount: Math.max(r.affectedRows ?? 0, r.rows.length) }; } };
  db.connect = async () => ({ ...db, release() {} });
  const app = Fastify(); app.decorate('db', db);
  app.decorate('mercadoLibreOAuth', {
    authenticatedRequest: async (_id, path) => ({ ok: true, payload: { id: path.split('/').pop(), children_categories: [], path_from_root: [{ id: 'MLM123', name: 'Test leaf' }] } }),
    categoryRequirements: async (_id, ids) => ({ categories: ids.map(categoryId => ({ ok: true, categoryId, variationAttributes: [{ id: 'COLOR' }], requiredAttributes: [] })) })
  });
  app.setErrorHandler((e, _req, reply) => reply.code(e.statusCode ?? 500).send({ error: e.code, message: e.message, details: e.details }));
  await app.register(candidatesRoutes, { prefix: '/api/candidates' });
  await app.register(productsRoutes, { prefix: '/api/products' });
  await app.register(publishRoutes, { prefix: '/api/publish' });
  app.get('/console/api/session', async () => ({ authenticated: true, configured: true }));
  app.get('/api/integrations/mercadolibre/accounts', async () => [{ id: 'test-account', status: 'connected' }]);
  const request = async (method, url, body) => { const r = await app.inject({ method, url, payload: body }); return { status: r.statusCode, body: r.json() }; };
  t.after(async () => { await app.close(); await pg.close(); });
  const data = readyCandidate(), pkg = { schemaVersion: 1, candidates: [data] };
  let preview = await request('POST', '/api/candidates/import/preview', pkg);
  assert.equal(preview.body.candidates[0].action, 'create');
  const imported = await request('POST', '/api/candidates/import', pkg); assert.equal(imported.status, 200);
  const base = `/api/candidates/${data.id}`;
  let row = (await request('GET', base)).body;
  assert.equal(row.revision, 1);
  data.name = 'AI should not overwrite manual values';
  preview = await request('POST', '/api/candidates/import/preview', pkg);
  assert.equal(preview.body.candidates[0].action, 'preserve_existing');
  assert.notEqual(preview.body.candidates[0].current.name, preview.body.candidates[0].incoming.name);
  await request('POST', '/api/candidates/import', pkg);
  assert.notEqual((await request('GET', base)).body.name, data.name);
  assert.equal((await request('PUT', base, { revision: 0, data })).status, 409);
  assert.equal((await request('POST', `${base}/promote`, { revision: 1, sites: ['MLM'] })).status, 422);
  row = (await request('POST', `${base}/categories/MLM/check`, { revision: 1, accountId: 'test-account' })).body;
  assert.equal(row.categoryChecks.MLM.ok, true); assert.equal(row.revision, 2);

  // Exercise the shipped HTML and both browser scripts against real route responses.
  const dom = new JSDOM(await readFile(new URL('../src/console/index.html', import.meta.url), 'utf8'), { url: 'http://localhost/console', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.fetch = async (url, options = {}) => {
    const r = await app.inject({ method: options.method ?? 'GET', url, payload: options.body ? JSON.parse(options.body) : undefined });
    return { ok: r.statusCode < 400, status: r.statusCode, json: async () => r.json() };
  };
  vm.runInContext(await readFile(new URL('../src/console/app.js', import.meta.url), 'utf8'), dom.getInternalVMContext());
  vm.runInContext(await readFile(new URL('../src/console/candidates.js', import.meta.url), 'utf8'), dom.getInternalVMContext());
  await dom.window.loadCandidates();
  const edit = [...dom.window.document.querySelectorAll('#candidateList button')].find(b => b.textContent === '编辑候选');
  assert.ok(edit); edit.click();
  const until = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 10)); } throw Error('UI action timed out'); };
  await until(() => dom.window.document.querySelectorAll('.candidate-fact').length > 0);
  const nameInput = dom.window.document.querySelector('#candidateEditor input'); nameInput.value = 'Manual supplier product'; nameInput.dispatchEvent(new dom.window.Event('change'));
  const saveButton = [...dom.window.document.querySelectorAll('#candidateEditor button')].find(b => b.textContent === '保存草稿并检查'); saveButton.click();
  await until(() => dom.window.document.querySelector('#toast').textContent === '候选草稿已保存');
  row = (await request('GET', base)).body; assert.equal(row.name, 'Manual supplier product'); assert.equal(row.revision, 3);
  assert.equal(row.categoryChecks.MLM.ok, true);
  const result = await request('POST', `${base}/promote`, { revision: 3, sites: ['MLM'] });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const again = await request('POST', `${base}/promote`, { revision: 3, sites: ['MLM'] });
  assert.equal(again.body.id, result.body.id); assert.equal(again.body.reused, true);
  assert.equal((await db.query('SELECT * FROM products')).rows.length, 1);
  assert.equal((await db.query('SELECT * FROM products')).rows[0].packed_weight_g, 650);
  const listing = (await db.query('SELECT * FROM listings')).rows[0];
  assert.equal(listing.category_id, 'MLM123'); assert.equal(listing.family_data.globalCategoryId, 'CBT123');
  assert.equal(listing.title, 'Organizador de escritorio');
  const variant = (await db.query('SELECT * FROM variants')).rows[0]; assert.equal(variant.seller_sku, 'EXAMPLE-WH');
  assert.equal((await db.query('SELECT * FROM variant_media')).rows[0].is_primary, true);
  assert.equal((await request('PUT', base, { revision: 4, data })).status, 409);
  const facts = (await db.query('SELECT * FROM product_fact_sheets')).rows[0].confirmed_facts;
  assert.equal(facts.material, 'Metal'); assert.equal(facts.packedWeightG, 650);
  assert.equal(facts.skuFacts['EXAMPLE-WH'].packageDimensions.length, 25);
  // Duplicate supplier SKU is reported before insertion.
  const other = readyCandidate(); other.id = 'second-candidate';
  await request('POST', '/api/candidates/import', { schemaVersion: 1, candidates: [other] });
  await request('POST', '/api/candidates/second-candidate/categories/MLM/check', { revision: 1, accountId: 'test-account' });
  const failed = await request('POST', '/api/candidates/second-candidate/promote', { revision: 2, sites: ['MLM'] });
  assert.equal(failed.status, 409); assert.equal((await db.query('SELECT * FROM products')).rows.length, 1);
  assert.equal((await request('GET', '/api/candidates/second-candidate')).body.productId, null);
  // A late database failure rolls back products, media and candidate linkage.
  const third = readyCandidate(); third.id = 'rollback-candidate'; third.skus[0].sellerSku = 'ROLLBACK-SKU';
  await request('POST', '/api/candidates/import', { schemaVersion: 1, candidates: [third] });
  await request('POST', '/api/candidates/rollback-candidate/categories/MLM/check', { revision: 1, accountId: 'test-account' });
  await pg.exec(`CREATE FUNCTION test_reject_variant() RETURNS trigger AS $$ BEGIN IF NEW.seller_sku='ROLLBACK-SKU' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql; CREATE TRIGGER test_reject BEFORE INSERT ON variants FOR EACH ROW EXECUTE FUNCTION test_reject_variant();`);
  assert.equal((await request('POST', '/api/candidates/rollback-candidate/promote', { revision: 2, sites: ['MLM'] })).status, 500);
  assert.equal((await db.query('SELECT * FROM products')).rows.length, 1);
  assert.equal((await db.query('SELECT * FROM product_media')).rows.length, 1);
  assert.equal((await request('GET', '/api/candidates/rollback-candidate')).body.productId, null);
  const brazil = readyCandidate(); brazil.id = 'brazil-candidate'; brazil.targetSites = ['MLB'];
  brazil.sites = { MLB: { title: 'Organizador de mesa', description: 'Quatro divisórias.', categoryId: 'MLB123', cbtCategoryId: 'CBT123', attributes: {}, evidence: [], localizedFrom: JSON.stringify([brazil.english.title, brazil.english.description, brazil.english.sellingPoints]) } };
  brazil.skus[0].sellerSku = 'SKU-MLB';
  brazil.researchSources = [{ platform: 'Amazon', url: 'https://www.amazon.com/dp/B07BHKNTHY', notes: 'Comparable; no exact weight.' }];
  assert.equal((await request('POST', '/api/candidates/import', { schemaVersion: 1, candidates: [brazil] })).status, 200);
  const brazilBase = '/api/candidates/brazil-candidate';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<!doctype html><html><h1 id="productTitle">Desk organizer with two drawers</h1></html>', { headers: { 'content-type': 'text/html' } });
  try {
    const extraction = await request('POST', `${brazilBase}/research/extract`, { revision: 1, url: brazil.researchSources[0].url });
    assert.equal(extraction.status, 200); assert.equal(extraction.body.status, 'extracted');
    assert.equal((await request('GET', brazilBase)).body.researchSources[0].extracted, undefined); // explicit review/save only
  } finally { globalThis.fetch = realFetch; }
  const suggestion = await request('POST', `${brazilBase}/english/suggest`, { revision: 1 });
  assert.equal(suggestion.status, 503); // no paid provider configured in this isolated run
  const checked = await request('POST', `${brazilBase}/categories/MLB/check`, { revision: 1, accountId: 'test-account' });
  assert.equal(checked.body.categoryChecks.MLB.ok, true);
  await dom.window.openCandidateLocalization('brazil-candidate');
  assert.match(dom.window.document.querySelector('#localizationEditor').textContent, /巴西葡萄牙语/);
  assert.doesNotMatch(dom.window.document.querySelector('#localizationEditor').textContent, /哥伦比亚|智利/);
  const promotedBrazil = await request('POST', `${brazilBase}/promote`, { revision: 2, sites: ['MLB'] });
  assert.equal(promotedBrazil.status, 200, JSON.stringify(promotedBrazil.body));
  const brazilListing = (await db.query('SELECT * FROM listings WHERE product_id=$1', [promotedBrazil.body.id])).rows[0];
  assert.equal(brazilListing.site, 'MLB'); assert.equal(brazilListing.category_id, 'MLB123');
  assert.equal(brazilListing.description_english, brazil.english.description);
  const categoryAssessment = (await db.query('SELECT * FROM product_category_assessments WHERE product_id=$1', [promotedBrazil.body.id])).rows[0];
  assert.equal(categoryAssessment.site, 'MLB'); assert.equal(categoryAssessment.status, 'confirmed');
  const preflight = await request('GET', `/api/publish/${promotedBrazil.body.id}/preflight?sites=MLB`);
  assert.equal(preflight.status, 200, JSON.stringify(preflight.body));
  assert.ok(preflight.body.errors.every(e => e.code !== 'unsupported_site'));
  assert.ok(preflight.body.errors.some(e => e.code === 'missing_price' || e.code === 'unreviewed_variant_image'));

});
