import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { validatePackage, validateCandidate, candidateIssues, examplePackage, confirmedValue } from '../src/domain/candidates.js';
import { candidateWorkbook } from '../src/routes/candidates.js';

import { readyCandidate, readyCheck } from './helpers/candidate-fixture.js';

test('candidate package preserves references and only concrete SKU rows', () => {
  const data = readyCandidate();
  const parsed = validatePackage({ schemaVersion: 1, candidates: [data] });
  assert.equal(parsed[0].skus.length, 1); assert.equal(parsed[0].facts.packedWeightG.reference.source, '待研究');
  assert.deepEqual(candidateIssues(data, readyCheck()), []);
  assert.throws(() => validatePackage({ schemaVersion: 2, candidates: [data] }));
  assert.throws(() => validatePackage({ schemaVersion: 1, candidates: [data, data] }));
});
test('reference or unconfirmed SKU overrides never supply publish facts', () => {
  const data = readyCandidate(); data.facts.packedWeightG.actual.confirmed = false;
  data.facts.packedWeightG.reference.value = 500;
  assert.equal(confirmedValue(data, data.skus[0], 'packedWeightG'), undefined);
  assert.ok(candidateIssues(data, readyCheck()).some(i => i.field.endsWith('packedWeightG')));
  data.facts.packedWeightG.actual.confirmed = true;
  data.skus[0].facts.packedWeightG = { actual: { value: 700, source: '供应商', confirmed: false } };
  assert.equal(confirmedValue(data, data.skus[0], 'packedWeightG'), undefined);
});
test('category changes, expired metadata, unsupported axes and incomplete MLB cannot promote silently', () => {
  const data = readyCandidate(), check = readyCheck(); check.MLM.checkedAt = '2020-01-01';
  assert.ok(candidateIssues(data, check).some(i => i.message.includes('24小时')));
  check.MLM = readyCheck().MLM; data.sites.MLM.categoryId = 'MLM456';
  assert.ok(candidateIssues(data, check).some(i => i.message.includes('24小时')));
  data.sites.MLM.categoryId = 'MLM123';
  data.skus.push({ ...data.skus[0], id: 'second', sellerSku: 'EXAMPLE-S', size: 'Small' }); data.skus[0].size = 'Large';
  assert.ok(candidateIssues(data, check).some(i => i.message.includes('SIZE')));
  data.targetSites.push('MLB'); data.sites.MLB = { categoryId: 'MLB123', cbtCategoryId: 'CBT123', title: '', description: '' };
  assert.ok(candidateIssues(data, check).some(i => i.field === 'MLB'));
});
test('confirmed facts need provenance; images and category namespaces are validated', () => {
  const data = readyCandidate(); data.facts.material.actual.source = '';
  assert.throws(() => validateCandidate(data), /来源/);
  data.facts.material.actual.source = '供应商'; data.images[0].url = 'javascript:alert(1)';
  assert.throws(() => validateCandidate(data), /HTTPS/);
  data.images[0].url = 'https://example.com/a.jpg'; data.sites.MLM.categoryId = 'CBT123';
  assert.throws(() => validateCandidate(data), /本地类目/);
});
test('Excel has six readable sheets and preserves references, actuals, SKU links and literal text', async () => {
  const data = readyCandidate(); data.name = '=HYPERLINK("bad")'; data.facts.packedWeightG.reference.value = 420;
  const buffer = await candidateWorkbook([{ id: data.id, data, batch_id: 'test', category_checks: {}, product_id: null }]);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map(s => s.name), ['商品', '站点类目', 'SKU', '参数来源', '图片', '校验结果']);
  assert.equal(workbook.getWorksheet('商品').getCell('B2').value, data.name);
  assert.equal(workbook.getWorksheet('商品').getCell('B2').type, ExcelJS.ValueType.String);
  const facts = workbook.getWorksheet('参数来源');
  let found = false; facts.eachRow(row => { if (row.getCell(3).value === 'packedWeightG') { found = true; assert.equal(row.getCell(4).value, 420); assert.equal(row.getCell(8).value, 650); assert.equal(row.getCell(10).value, '供应商'); } });
  assert.ok(found); assert.equal(workbook.getWorksheet('SKU').getCell('K2').value, 'white');
});

test('English stage can be saved before locale copy; edits invalidate both locale reviews', () => {
  const data = readyCandidate(), check = readyCheck();
  data.sites.MLM.title = ''; data.sites.MLM.description = ''; data.sites.MLM.localizedFrom = '';
  assert.doesNotThrow(() => validateCandidate(data));
  assert.ok(candidateIssues(data, check).some(i => i.message.includes('译文')));
  data.sites.MLM.title = 'Organizador de escritorio'; data.sites.MLM.description = 'Organiza objetos de escritorio.';
  data.sites.MLM.localizedFrom = JSON.stringify([data.english.title, data.english.description, data.english.sellingPoints]);
  assert.deepEqual(candidateIssues(data, check), []);
  data.english.description = 'Edited confirmed English description.';
  assert.ok(candidateIssues(data, check).some(i => i.message.includes('英文内容已改变')));
});

test('Brazil leaf/category variation passes once localized copy is confirmed', () => {
  const data = readyCandidate(); data.targetSites = ['MLB'];
  data.sites = { MLB: { title: 'Organizador de mesa', description: 'Guarda objetos de mesa.', categoryId: 'MLB123', cbtCategoryId: 'CBT123', localizedFrom: JSON.stringify([data.english.title, data.english.description, data.english.sellingPoints]) } };
  const check = { MLB: { ok: true, categoryId: 'MLB123', checkedAt: new Date().toISOString(), variationAttributes: [{ id: 'COLOR' }] } };
  assert.deepEqual(candidateIssues(data, check), []);
  data.skus.push({ ...data.skus[0], id: 'black', sellerSku: 'EXAMPLE-BK', color: 'Black' });
  assert.deepEqual(candidateIssues(data, check), []);
  check.MLB.variationAttributes = [];
  assert.ok(candidateIssues(data, check).some(i => i.message.includes('COLOR')));
});

test('market references remain auditable and workbook exports English plus locale copy', async () => {
  const data = readyCandidate();
  data.researchSources = [{ platform: 'Amazon', url: 'https://example.com/product', notes: 'Comparable shape; weight remains unverified.' }];
  assert.doesNotThrow(() => validateCandidate(data));
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await candidateWorkbook([{ id: data.id, data, batch_id: 'batch', category_checks: {}, product_id: null }]));
  const productRow = workbook.getWorksheet('商品').getRow(2);
  assert.equal(productRow.getCell(9).value, data.english.title);
  assert.match(productRow.getCell(12).value, /Amazon/);
  const siteRow = workbook.getWorksheet('站点类目').getRow(2);
  assert.equal(siteRow.getCell(3).value, data.sites.MLM.title);
  assert.equal(siteRow.getCell(4).value, data.sites.MLM.description);
});
