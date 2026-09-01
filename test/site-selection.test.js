import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSelectedSites, scopeFamilyToSites } from '../src/domain/site-selection.js';

test('selected publish sites preserve canonical order and support one country', () => {
  assert.deepEqual(normalizeSelectedSites(['MLC'], ['MLM', 'MCO', 'MLC']), ['MLC']);
  assert.deepEqual(normalizeSelectedSites(['MLC', 'MLM'], ['MLM', 'MCO', 'MLC']), ['MLM', 'MLC']);
});

test('publishing requires an explicit non-empty site selection', () => {
  assert.throws(() => normalizeSelectedSites([], ['MLM', 'MCO', 'MLC']), { code: 'publish_sites_required' });
  assert.throws(() => normalizeSelectedSites(['MLA'], ['MLM', 'MCO', 'MLC']), { code: 'unsupported_publish_site' });
});

test('family scope filters both product target sites and listings', () => {
  const family = { product: { targetSites: ['MLM', 'MCO', 'MLC'] }, listings: [{ site: 'MLM' }, { site: 'MCO' }, { site: 'MLC' }] };
  const scoped = scopeFamilyToSites(family, ['MCO']);
  assert.deepEqual(scoped.product.targetSites, ['MCO']);
  assert.deepEqual(scoped.listings.map((item) => item.site), ['MCO']);
});
