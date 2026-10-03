import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { withTransaction } from '../db/pool.js';
import { validateCandidate, validatePackage, candidateIssues, confirmedValue, invalid, examplePackage } from '../domain/candidates.js';

const rowView = r => ({ ...r.data, revision: r.revision, categoryChecks: r.category_checks, productId: r.product_id, updatedAt: r.updated_at, issues: candidateIssues(r.data, r.category_checks) });
async function get(db, id, lock = false) {
  const r = await db.query(`SELECT * FROM candidates WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!r.rowCount) throw invalid('候选商品不存在', 404);
  return r.rows[0];
}
function revision(row, expected) {
  if (row.revision !== expected) throw invalid('资料已变化，请刷新后重试', 409);
}
export async function candidateWorkbook(rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '天船ERP';
  const add = (name, headers, values) => {
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(headers); values.forEach(v => sheet.addRow(v.map(x => x === undefined || x === null ? '' : typeof x === 'object' ? JSON.stringify(x) : x)));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF244C66' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    sheet.columns.forEach((column, i) => { column.width = i ? 28 : 24; });
    sheet.eachRow(r => { r.alignment = { vertical: 'top', wrapText: true }; });
  };
  add('商品', ['candidate_id', '产品名称', '批次', '目标站点', '货源链接', '备注', '正式草稿ID', '导出用途'], rows.map(r => [r.id, r.data.name, r.batch_id, r.data.targetSites.join(','), r.data.sourceUrl, r.data.notes, r.product_id, '候选工作表，非妙手上传模板']));
  add('站点类目', ['candidate_id', '站点', '标题', '描述', '本地类目ID', 'CBT类目ID', '官方类目路径', '官方规格属性', '核验时间', '竞品依据'], rows.flatMap(r => r.data.targetSites.map(s => [r.id, s, r.data.sites[s].title, r.data.sites[s].description, r.data.sites[s].categoryId, r.data.sites[s].cbtCategoryId, r.category_checks[s]?.path, r.category_checks[s]?.variationAttributes, r.category_checks[s]?.checkedAt, r.data.sites[s].evidence])));
  add('SKU', ['candidate_id', 'sku_id', 'Seller SKU', '颜色', '尺寸', '图案', '保留', '存在已确认', '库存', '净收益USD', '主图ID'], rows.flatMap(r => r.data.skus.map(s => [r.id, s.id, s.sellerSku, s.color, s.size, s.pattern, s.keep !== false, s.existsConfirmed === true, s.stock, s.netProceedsUsd, s.imageId])));
  add('参数来源', ['candidate_id', 'sku_id', '参数', '参考值', '参考单位', '参考来源', '参考URL', '实际值', '实际单位', '实际来源', '实际URL', '已确认'], rows.flatMap(r => [['', r.data.facts], ...r.data.skus.map(s => [s.id, s.facts ?? {}])].flatMap(([skuId, facts]) => Object.entries(facts).map(([key, f]) => [r.id, skuId, key, f.reference?.value, f.reference?.unit, f.reference?.source, f.reference?.url, f.actual?.value, f.actual?.unit, f.actual?.source, f.actual?.url, f.actual?.confirmed === true]))));
  add('图片', ['candidate_id', '图片ID', 'URL', '状态', '用途', '图片方案'], rows.flatMap(r => r.data.images.map(i => [r.id, i.id, i.url, i.status, i.role, i.prompt])));
  add('校验结果', ['candidate_id', '字段', '问题'], rows.flatMap(r => candidateIssues(r.data, r.category_checks).map(i => [r.id, i.field, i.message])));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
export async function candidatesRoutes(app) {
  app.get('/template', async (_req, reply) => reply.header('content-disposition', 'attachment; filename="candidate-template.json"').send(examplePackage()));
  app.get('/', async req => {
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 100));
    const result = await app.db.query('SELECT * FROM candidates WHERE ($1::text IS NULL OR batch_id=$1) ORDER BY updated_at DESC LIMIT $2', [req.query?.batchId || null, limit]);
    return result.rows.map(rowView);
  });
  app.post('/import/preview', async req => {
    const candidates = validatePackage(req.body);
    const current = await app.db.query('SELECT * FROM candidates WHERE id=ANY($1::text[])', [candidates.map(c => c.id)]);
    return { candidates: candidates.map(c => {
      const old = current.rows.find(r => r.id === c.id);
      return { id: c.id, name: c.name, action: old ? 'preserve_existing' : 'create', current: old?.data, incoming: c, issues: candidateIssues(c) };
    }) };
  });
  app.post('/import', async req => {
    const candidates = validatePackage(req.body);
    return withTransaction(app.db, async db => {
      const created = [], preserved = [];
      for (const c of candidates) {
        const r = await db.query('INSERT INTO candidates(id,batch_id,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO NOTHING RETURNING id', [c.id, c.batchId ?? '', JSON.stringify(c)]);
        (r.rowCount ? created : preserved).push(c.id);
      }
      return { created, preserved };
    });
  });
  app.get('/export', async (_req, reply) => {
    const r = await app.db.query('SELECT * FROM candidates ORDER BY updated_at DESC LIMIT 200');
    return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', 'attachment; filename="candidates.xlsx"').send(await candidateWorkbook(r.rows));
  });
  app.get('/:id', async req => rowView(await get(app.db, req.params.id)));
  app.put('/:id', async req => withTransaction(app.db, async db => {
    const row = await get(db, req.params.id, true); revision(row, req.body?.revision);
    if (row.product_id) throw invalid('已转正式草稿，请在正式商品页修改', 409);
    const data = validateCandidate(req.body.data);
    if (data.id !== row.id) throw invalid('不能修改候选ID');
    const r = await db.query('UPDATE candidates SET data=$2::jsonb,batch_id=$3,revision=revision+1 WHERE id=$1 RETURNING *', [row.id, JSON.stringify(data), data.batchId ?? '']);
    return rowView(r.rows[0]);
  }));
  app.post('/:id/categories/:site/check', async req => {
    const row = await get(app.db, req.params.id); revision(row, req.body?.revision);
    if (row.product_id) throw invalid('已转正式草稿，请在正式商品页核验', 409);
    const site = req.params.site, categoryId = row.data.sites[site]?.categoryId;
    if (!row.data.targetSites.includes(site) || !new RegExp(`^${site}\\d+$`).test(categoryId ?? '')) throw invalid('请先填写并保存对应站点末级类目ID');
    if (!app.mercadoLibreOAuth || !req.body.accountId) throw invalid('需要已授权的美客多账号');
    const detail = await app.mercadoLibreOAuth.authenticatedRequest(req.body.accountId, `/categories/${categoryId}`);
    const requirements = await app.mercadoLibreOAuth.categoryRequirements(req.body.accountId, [categoryId]);
    const attrs = requirements.categories[0];
    const ok = Boolean(detail.ok && detail.payload?.id === categoryId && Array.isArray(detail.payload.children_categories) && detail.payload.children_categories.length === 0 && attrs?.ok);
    const check = { ok, categoryId, accountId: req.body.accountId, checkedAt: new Date().toISOString(), path: detail.payload?.path_from_root ?? [], variationAttributes: attrs?.variationAttributes ?? [], requiredAttributes: attrs?.requiredAttributes ?? [], message: ok ? '官方末级类目及本地variation属性已读取；CBT/Child PK仍须远程预检' : '类目无法读取、不是末级或属性读取失败' };
    const r = await app.db.query('UPDATE candidates SET category_checks=jsonb_set(category_checks,ARRAY[$2]::text[],$3::jsonb),revision=revision+1 WHERE id=$1 AND revision=$4 RETURNING *', [row.id, site, JSON.stringify(check), row.revision]);
    if (!r.rowCount) throw invalid('资料已变化，请刷新后重新核验', 409);
    return rowView(r.rows[0]);
  });
  app.get('/:id/export', async (req, reply) => {
    const row = await get(app.db, req.params.id);
    if (req.query?.format === 'json') return reply.header('content-disposition', `attachment; filename="${row.id}.json"`).send({ schemaVersion: 1, candidates: [row.data] });
    return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').header('content-disposition', `attachment; filename="${row.id}.xlsx"`).send(await candidateWorkbook([row]));
  });
  app.post('/:id/promote', async req => withTransaction(app.db, async db => {
    const row = await get(db, req.params.id, true);
    if (row.product_id) return { id: row.product_id, reused: true };
    revision(row, req.body?.revision);
    const data = row.data, selected = req.body.sites;
    const issues = candidateIssues(data, row.category_checks, selected);
    if (issues.length) throw invalid('转正式草稿前请处理缺失项', 422, { errors: issues });
    const id = randomUUID(), skus = data.skus.filter(s => s.keep !== false), first = skus[0];
    const existing = await db.query('SELECT seller_sku FROM variants WHERE seller_sku=ANY($1::text[])', [skus.map(s => s.sellerSku.trim())]);
    if (existing.rowCount) throw invalid('Seller SKU已被正式商品使用，请修改', 409, { errors: existing.rows.map(r => ({ field: r.seller_sku, message: 'Seller SKU已存在' })) });
    await db.query(`INSERT INTO products(id,internal_code,source_url,original_title,purchase_price_cny,packed_weight_g,product_dimensions,package_dimensions,raw_attributes,notes,target_sites,status,workflow_type)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,'pending_review','new_product')`, [id, `CAND-${data.id}`, data.sourceUrl || null, data.name, confirmedValue(data, first, 'purchasePriceCny'), confirmedValue(data, first, 'packedWeightG'), JSON.stringify(confirmedValue(data, first, 'productDimensions')), JSON.stringify(confirmedValue(data, first, 'packageDimensions')), JSON.stringify({ candidateId: data.id, material: confirmedValue(data, first, 'material') }), data.notes ?? '', selected]);
    const imageMap = new Map();
    for (const image of data.images.filter(i => i.status === 'usable')) {
      const mediaId = randomUUID(); imageMap.set(image.id, mediaId);
      await db.query(`INSERT INTO product_media(id,product_id,media_type,role,storage_key,original_filename,mime_type,byte_size,sort_order,external_url,validation_status) VALUES($1,$2,'image',$3,$4,$5,'image/jpeg',0,$6,$7,'pending')`, [mediaId, id, image.role ?? 'original', `external:${mediaId}`, `${image.id}.jpg`, imageMap.size - 1, image.url]);
    }
    for (const sku of skus) {
      const variantId = randomUUID();
      await db.query(`INSERT INTO variants(id,product_id,seller_sku,color,size,other_attributes,purchase_price_cny,packed_weight_g,stock,global_net_proceeds_usd) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)`, [variantId, id, sku.sellerSku.trim(), sku.color || null, sku.size || null, JSON.stringify(sku.pattern ? { PATTERN: sku.pattern } : {}), confirmedValue(data, sku, 'purchasePriceCny'), confirmedValue(data, sku, 'packedWeightG'), sku.stock, sku.netProceedsUsd]);
      await db.query('INSERT INTO variant_media(variant_id,media_id,sort_order,is_primary) VALUES($1,$2,0,true)', [variantId, imageMap.get(sku.imageId)]);
      for (const image of data.images.filter(i => i.status === 'usable' && i.role === 'shared' && i.id !== sku.imageId)) await db.query('INSERT INTO variant_media(variant_id,media_id,sort_order,is_primary) VALUES($1,$2,$3,false)', [variantId, imageMap.get(image.id), imageMap.size]);
    }
    for (const site of selected) {
      const item = data.sites[site];
      await db.query(`INSERT INTO listings(product_id,site,title,description_english,category_id,currency,family_name,required_attributes,family_data) VALUES($1,$2,$3,$4,$5,'USD',$6,$7::jsonb,$8::jsonb)`, [id, site, item.title, data.descriptionEnglish ?? '', item.categoryId, data.familyName ?? '', JSON.stringify(item.attributes ?? {}), JSON.stringify({globalCategoryId: item.cbtCategoryId})]);
    }
    await db.query('INSERT INTO product_fact_sheets(product_id,confirmed_facts) VALUES($1,$2::jsonb)', [id, JSON.stringify({ ...Object.fromEntries(Object.entries(data.facts).filter(([,f]) => f.actual?.confirmed === true).map(([key,f]) => [key,f.actual.value])), skuFacts: Object.fromEntries(skus.map(s => [s.sellerSku, Object.fromEntries(Object.keys(data.facts).map(key => [key, confirmedValue(data, s, key)]))])) })]);
    // Snapshot stays in candidates; never claim imported category evidence is a live UP preflight.
    await db.query('UPDATE candidates SET product_id=$2,revision=revision+1 WHERE id=$1', [row.id, id]);
    return { id, reused: false, nextStep: '请在正式商品中核验CBT/Child PK、图片及远程预检；尚未发布' };
  }));
}
