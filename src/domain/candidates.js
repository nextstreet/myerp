import { variantAxes } from './category-assessment.js';

export const CANDIDATE_SITES = ['MLM', 'MLB', 'MCO', 'MLC'];
export const DRAFT_SITES = ['MLM', 'MLB', 'MCO', 'MLC'];
export const englishSignature = data => JSON.stringify([data.english?.title ?? '', data.english?.description ?? '', data.english?.sellingPoints ?? []]);
export function invalid(message, statusCode = 400, details) {
  return Object.assign(new Error(message), { statusCode, code: 'candidate_validation', details });
}
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
export function validateCandidate(data) {
  if (!object(data) || !/^[a-zA-Z0-9_-]{1,100}$/.test(data.id ?? '')) throw invalid('候选ID须为1–100位字母、数字、下划线或短横线');
  if (!String(data.name ?? '').trim()) throw invalid('产品名称必填');
  if (!Array.isArray(data.targetSites) || !data.targetSites.length || new Set(data.targetSites).size !== data.targetSites.length || data.targetSites.some(s => !CANDIDATE_SITES.includes(s))) throw invalid('目标站点无效');
  if (!Array.isArray(data.skus) || data.skus.length > 100 || !Array.isArray(data.images) || !object(data.sites) || !object(data.facts)) throw invalid('skus、images、sites、facts结构无效');
  if (data.english !== undefined && (!object(data.english) || typeof data.english.title !== 'string' || typeof data.english.description !== 'string' || !Array.isArray(data.english.sellingPoints) || data.english.sellingPoints.some(v => typeof v !== 'string'))) throw invalid('英文标题、描述和卖点结构无效');
  if (data.researchSources !== undefined && (!Array.isArray(data.researchSources) || data.researchSources.length > 40 || data.researchSources.some(v => !object(v) || !['MLM', 'MLB', 'Amazon', 'Temu', 'Shopee'].includes(v.platform) || typeof v.url !== 'string' || !/^https:\/\//.test(v.url) || typeof v.notes !== 'string' || JSON.stringify(v).length > 12000 || (v.extracted != null && (!object(v.extracted) || typeof v.extracted.title !== 'string'))))) throw invalid('市场来源须包含平台、HTTPS链接和摘要，最多40条且每条不超过12KB');
  if (data.images.length > 50) throw invalid('最多50张图片');
  for (const key of ['name', 'batchId', 'sourceUrl', 'notes', 'familyName', 'descriptionEnglish']) if (data[key] !== undefined && typeof data[key] !== 'string') throw invalid(`${key}须为文本`);
  const keys = data.skus.map(s => s?.id);
  if (keys.some(k => !/^[a-zA-Z0-9_-]{1,100}$/.test(k ?? '')) || new Set(keys).size !== keys.length) throw invalid('SKU ID必须存在且唯一');
  const imageIds = data.images.map(i => i?.id);
  if (imageIds.some(i => typeof i !== 'string' || !i) || new Set(imageIds).size !== imageIds.length) throw invalid('图片ID必须唯一');
  for (const image of data.images) {
    try { if (new URL(image.url).protocol !== 'https:') throw Error(); } catch { throw invalid('图片需要HTTPS链接'); }
    if (!['reference', 'pending', 'usable'].includes(image.status)) throw invalid('图片状态无效');
  }
  for (const sku of data.skus) {
    if (!object(sku) || (sku.facts && !object(sku.facts))) throw invalid('SKU参数结构无效');
    if (sku.imageId && !imageIds.includes(sku.imageId)) throw invalid('SKU关联了不存在的图片');
  }
  for (const site of data.targetSites) {
    const item = data.sites[site];
    if (!object(item)) throw invalid(`${site}资料缺失`);
    for (const key of ['title', 'description', 'categoryId', 'cbtCategoryId']) if (item[key] !== undefined && typeof item[key] !== 'string') throw invalid(`${site}.${key}须为文本`);
    if (item.attributes !== undefined && !object(item.attributes)) throw invalid(`${site}.attributes须为属性对象`);
    if (item.categoryId && !new RegExp(`^${site}\\d+$`).test(item.categoryId)) throw invalid(`${site}必须使用本地类目ID`);
    if (item.cbtCategoryId && !/^CBT\d+$/.test(item.cbtCategoryId)) throw invalid('CBT类目ID无效');
  }
  for (const facts of [data.facts, ...data.skus.map(s => s.facts ?? {})]) {
    for (const fact of Object.values(facts)) {
      if (!object(fact)) throw invalid('参数须包含reference/actual来源记录');
      for (const record of [fact.reference, fact.actual].filter(Boolean)) {
        if (!object(record) || !('value' in record)) throw invalid('参数记录缺少value');
        if (record.confirmed && !String(record.source ?? '').trim()) throw invalid('已确认参数必须记录来源');
      }
    }
  }
  const result = structuredClone(data);
  result.english ??= { title: data.familyName || '', description: data.descriptionEnglish || '', sellingPoints: [] };
  result.researchSources ??= [];
  for (const key of ['material', 'purchasePriceCny', 'packedWeightG', 'productDimensions', 'packageDimensions']) result.facts[key] ??= { reference: { value: '', source: '', unit: '' }, actual: { value: '', source: '', confirmed: false } };
  return result;
}
export function validatePackage(body) {
  if (body?.schemaVersion !== 1 || !Array.isArray(body.candidates) || !body.candidates.length || body.candidates.length > 50) throw invalid('需要schemaVersion: 1及1–50个candidates');
  const candidates = body.candidates.map(validateCandidate);
  if (new Set(candidates.map(c => c.id)).size !== candidates.length) throw invalid('批次中候选ID重复');
  return candidates;
}
export function confirmedValue(data, sku, key) {
  // An explicit SKU fact takes precedence; an unconfirmed override cannot fall back.
  const fact = sku?.facts?.[key] ?? data.facts[key];
  return fact?.actual?.confirmed === true ? fact.actual.value : undefined;
}
export function candidateIssues(data, checks = {}, selectedSites = data.targetSites, now = Date.now()) {
  const issues = [];
  const add = (field, message) => issues.push({ field, message });
  if (!Array.isArray(selectedSites) || !selectedSites.length || new Set(selectedSites).size !== selectedSites.length || selectedSites.some(s => !data.targetSites.includes(s))) return [{ field: 'targetSites', message: '请选择候选范围内的目标站点' }];
  if (!String(data.english?.title ?? '').trim() || !String(data.english?.description ?? '').trim()) add('english', '请先完成英文标题和英文描述');
  if (String(data.english?.title ?? '').length > 60 || /[\u3400-\u9fff]/u.test(data.english?.title ?? '')) add('english.title', '英文Family名称须不超过60字符且不能包含中文');
  const kept = data.skus.filter(s => s.keep !== false);
  if (!kept.length) add('skus', '至少保留一个SKU');
  const skuNames = new Set();
  const combinations = new Set();
  for (const sku of kept) {
    if (sku.existsConfirmed !== true) add(sku.id, '货源SKU存在性待确认');
    const name = String(sku.sellerSku ?? '').trim();
    if (!name || skuNames.has(name)) add(sku.id, 'Seller SKU缺失或重复');
    skuNames.add(name);
    const combination = JSON.stringify([sku.color ?? '', sku.size ?? '', sku.pattern ?? '']);
    if (combinations.has(combination)) add(sku.id, '颜色/尺寸/图案组合重复，请区分真实规格');
    combinations.add(combination);
    if (!Number.isInteger(sku.stock) || sku.stock < 0) add(sku.id, '库存须为非负整数');
    if (!positive(sku.netProceedsUsd)) add(sku.id, '请填写建议净收益USD');
    for (const key of ['packedWeightG', 'purchasePriceCny']) {
      const v = confirmedValue(data, sku, key);
      if (key === 'packedWeightG' ? !Number.isInteger(v) || v <= 0 : typeof v !== 'number' || !Number.isFinite(v) || v < 0) add(`${sku.id}.${key}`, '实际采购价/包装重量待确认或无效');
    }
    for (const key of ['productDimensions', 'packageDimensions']) {
      const v = confirmedValue(data, sku, key);
      if (!object(v) || !['length', 'width', 'height'].every(k => positive(v[k])) || v.unit !== 'cm') add(`${sku.id}.${key}`, '实际长宽高须以cm确认');
    }
    if (!String(confirmedValue(data, sku, 'material') ?? '').trim()) add(`${sku.id}.material`, '材质待确认');
    const image = data.images.find(i => i.id === sku.imageId);
    if (!image || image.status !== 'usable') add(`${sku.id}.image`, '请选择已确认可刊登的主图');
  }
  const axes = variantAxes(kept.map(s => ({ color: s.color, size: s.size, otherAttributes: s.pattern ? { PATTERN: s.pattern } : {} })));
  if (kept.length > 1 && !axes.length) add('skus', '多SKU需要类目允许的明确规格轴');
  const cbtIds = new Set(selectedSites.map(s => data.sites[s]?.cbtCategoryId).filter(Boolean));
  if (cbtIds.size > 1) add('sites', '一个正式Family不能使用多个CBT类目；请拆分候选');
  for (const site of selectedSites) {
    if (!DRAFT_SITES.includes(site)) add(site, '当前站点无法转正式草稿');
    if (!String(data.sites[site]?.title ?? '').trim() || !String(data.sites[site]?.description ?? '').trim()) add(site, '当地语言标题或描述缺失');
    if (data.sites[site]?.localizedFrom !== englishSignature(data)) add(site, '英文内容已改变或译文尚未确认，请在翻译页重新审核');
    const check = checks[site];
    const age = now - Date.parse(check?.checkedAt);
    if (!check?.ok || check.categoryId !== data.sites[site]?.categoryId || !Number.isFinite(age) || age < 0 || age > 86400000) add(site, '需重新读取官方末级类目和属性（有效24小时）');
    else for (const axis of axes) if (!check.variationAttributes.some(a => a.id === axis)) add(site, `本地类目不支持${axis}，请拆分候选或调整真实规格`);
    if (!/^CBT\d+$/.test(data.sites[site]?.cbtCategoryId ?? '')) add(site, 'CBT映射待填写；转入后仍须核验Child PK并执行远程预检');
  }
  return issues;
}
export function examplePackage() {
  return { schemaVersion: 1, candidates: [{ id: 'example-organizer', name: '示例收纳用品（演示数据）', batchId: 'demo', targetSites: ['MLM', 'MLB'], sourceUrl: '', notes: '仅演示结构，类目与产品参数尚未研究', english: { title: '', description: '', sellingPoints: [] }, researchSources: [], facts: Object.fromEntries(['material', 'purchasePriceCny', 'packedWeightG', 'productDimensions', 'packageDimensions'].map(k => [k, { reference: { value: '', source: '待研究', unit: '' }, actual: { value: '', source: '', confirmed: false } }])), sites: { MLM: { title: '', description: '', categoryId: '', cbtCategoryId: '', evidence: [] }, MLB: { title: '', description: '', categoryId: '', cbtCategoryId: '', evidence: [] } }, images: [], skus: [{ id: 'sku-01', sellerSku: '', color: '', size: '', pattern: '', stock: 10, netProceedsUsd: null, keep: true, existsConfirmed: false, facts: {}, imageId: '' }] }] };
}
