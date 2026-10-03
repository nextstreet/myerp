import { examplePackage } from '../../src/domain/candidates.js';
export function readyCandidate() {
  const data = examplePackage().candidates[0];
  data.targetSites = ['MLM']; data.familyName = 'Desktop organizer'; data.descriptionEnglish = 'Compartments for desktop essentials.';
  data.sites.MLM = { title: 'Organizador de escritorio', categoryId: 'MLM123', cbtCategoryId: 'CBT123', evidence: [], attributes: {} };
  const values = { material: 'Metal', purchasePriceCny: 12, packedWeightG: 650, productDimensions: { length: 24, width: 12, height: 12, unit: 'cm' }, packageDimensions: { length: 25, width: 13, height: 13, unit: 'cm' } };
  for (const [key, value] of Object.entries(values)) data.facts[key].actual = { value, source: '供应商', confirmed: true };
  data.images = [{ id: 'white', url: 'https://example.com/white.jpg', status: 'usable', role: 'primary' }];
  Object.assign(data.skus[0], { sellerSku: 'EXAMPLE-WH', color: 'White', stock: 10, netProceedsUsd: 6, existsConfirmed: true, imageId: 'white' });
  return data;
}
export const readyCheck = () => ({ MLM: { ok: true, categoryId: 'MLM123', checkedAt: new Date().toISOString(), variationAttributes: [{ id: 'COLOR' }], path: [] } });
