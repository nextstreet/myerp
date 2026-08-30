import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/pool.js';
import { mergeReviewFields, updateConfirmations } from '../domain/review-merge.js';

const SITE_CODES = new Set(['MLM', 'MCO', 'MLC']);
const STATUSES = new Set([
  'pending_import', 'pending_ai', 'ai_processing', 'pending_review',
  'pending_publish', 'publishing', 'published', 'publish_failed', 'paused'
]);
const PRODUCT_REVIEW_FIELDS = [
  'sourceUrl', 'originalTitle', 'categoryHint', 'purchasePriceCny', 'packedWeightG',
  'productDimensions', 'packageDimensions', 'rawAttributes', 'notes', 'targetSites'
];
const VARIANT_REVIEW_FIELDS = [
  'sellerSku', 'color', 'size', 'otherAttributes', 'purchasePriceCny',
  'packedWeightG', 'stock', 'participateInPublish'
];
const LISTING_REVIEW_FIELDS = [
  'title', 'descriptionEnglish', 'specificationsEnglish', 'categoryId',
  'requiredAttributes', 'familyName', 'familyData', 'userProductData',
  'currency', 'targetProfitUsd', 'targetMarginRate', 'pricingBasis'
];
const SITE_CURRENCIES = Object.freeze({ MLM: 'MXN', MCO: 'COP', MLC: 'CLP' });

function badRequest(message, details) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'validation_error';
  error.details = details;
  return error;
}

function validateProduct(body) {
  const errors = [];
  if (!body || typeof body !== 'object') errors.push('body is required');
  if (!String(body?.internalCode ?? '').trim()) errors.push('internalCode is required');
  if (!String(body?.originalTitle ?? '').trim()) errors.push('originalTitle is required');
  if (!Number.isFinite(Number(body?.purchasePriceCny)) || Number(body.purchasePriceCny) < 0) errors.push('purchasePriceCny must be non-negative');
  if (!Number.isInteger(Number(body?.packedWeightG)) || Number(body.packedWeightG) <= 0) errors.push('packedWeightG must be a positive integer');
  const targetSites = body?.targetSites ?? ['MLM', 'MCO', 'MLC'];
  if (!Array.isArray(targetSites) || targetSites.some((site) => !SITE_CODES.has(site))) errors.push('targetSites contains an unsupported site');
  const variants = body?.variants ?? [];
  if (!Array.isArray(variants)) errors.push('variants must be an array');
  const skus = variants.map((item) => String(item.sellerSku ?? '').trim()).filter(Boolean);
  if (skus.length !== variants.length) errors.push('every variant needs a sellerSku');
  if (new Set(skus).size !== skus.length) errors.push('sellerSku must be unique within the product');
  if (errors.length) throw badRequest('Invalid product input', errors);
  return { targetSites, variants };
}

function productRow(row) {
  return {
    id: row.id,
    internalCode: row.internal_code,
    sourceUrl: row.source_url,
    originalTitle: row.original_title,
    categoryHint: row.category_hint,
    purchasePriceCny: Number(row.purchase_price_cny),
    packedWeightG: row.packed_weight_g,
    productDimensions: row.product_dimensions,
    packageDimensions: row.package_dimensions,
    rawAttributes: row.raw_attributes,
    notes: row.notes,
    targetSites: row.target_sites,
    status: row.status,
    confirmedFields: row.confirmed_fields ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function variantRow(row) {
  return {
    id: row.id,
    productId: row.product_id,
    sellerSku: row.seller_sku,
    color: row.color,
    size: row.size,
    otherAttributes: row.other_attributes,
    purchasePriceCny: row.purchase_price_cny === null ? null : Number(row.purchase_price_cny),
    packedWeightG: row.packed_weight_g,
    stock: row.stock,
    participateInPublish: row.participate_in_publish,
    confirmedFields: row.confirmed_fields,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listingRow(row) {
  return {
    id: row.id,
    productId: row.product_id,
    site: row.site,
    title: row.title,
    descriptionEnglish: row.description_english,
    specificationsEnglish: row.specifications_english,
    categoryId: row.category_id,
    requiredAttributes: row.required_attributes,
    familyName: row.family_name,
    familyData: row.family_data,
    userProductData: row.user_product_data,
    currency: row.currency,
    targetProfitUsd: row.target_profit_usd === null ? null : Number(row.target_profit_usd),
    targetMarginRate: row.target_margin_rate === null ? null : Number(row.target_margin_rate),
    pricingBasis: row.pricing_basis,
    publishStatus: row.publish_status,
    mercadoLibreItemId: row.mercado_libre_item_id,
    confirmedFields: row.confirmed_fields ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateReviewValues(values, type) {
  const errors = [];
  if (type === 'product') {
    if (!String(values.originalTitle ?? '').trim()) errors.push('originalTitle is required');
    if (!Number.isFinite(Number(values.purchasePriceCny)) || Number(values.purchasePriceCny) < 0) errors.push('purchasePriceCny must be non-negative');
    if (!Number.isInteger(Number(values.packedWeightG)) || Number(values.packedWeightG) <= 0) errors.push('packedWeightG must be a positive integer');
    if (!Array.isArray(values.targetSites) || values.targetSites.some((site) => !SITE_CODES.has(site))) errors.push('targetSites contains an unsupported site');
  }
  if (type === 'variant') {
    if (!String(values.sellerSku ?? '').trim()) errors.push('sellerSku is required');
    if (!Number.isInteger(Number(values.stock)) || Number(values.stock) < 0) errors.push('stock must be a non-negative integer');
  }
  if (type === 'listing') {
    if (!SITE_CODES.has(values.site)) errors.push('unsupported site');
    if (!String(values.currency ?? '').trim()) errors.push('currency is required');
  }
  if (errors.length) throw badRequest(`Invalid ${type} input`, errors);
}

export async function productsRoutes(app) {
  app.get('/', async (request) => {
    const limit = Math.min(Math.max(Number(request.query?.limit ?? 50), 1), 200);
    const status = request.query?.status;
    if (status && !STATUSES.has(status)) throw badRequest('Unsupported status');
    const result = await app.db.query(`
      SELECT p.*, COUNT(v.id)::integer AS variant_count,
        (SELECT pm.id FROM product_media pm WHERE pm.product_id=p.id AND pm.media_type='image' ORDER BY pm.sort_order,pm.created_at LIMIT 1) AS thumbnail_media_id
      FROM products p
      LEFT JOIN variants v ON v.product_id = p.id
      WHERE ($1::product_status IS NULL OR p.status = $1)
      GROUP BY p.id
      ORDER BY p.updated_at DESC
      LIMIT $2
    `, [status ?? null, limit]);
    return result.rows.map((row) => ({
      ...productRow(row),
      variantCount: row.variant_count,
      thumbnailMediaId: row.thumbnail_media_id ?? null
    }));
  });

  app.get('/:id', async (request, reply) => {
    const [productResult, variantResult, listingResult, mediaResult] = await Promise.all([
      app.db.query('SELECT * FROM products WHERE id = $1', [request.params.id]),
      app.db.query('SELECT * FROM variants WHERE product_id = $1 ORDER BY created_at', [request.params.id]),
      app.db.query('SELECT * FROM listings WHERE product_id = $1 ORDER BY site', [request.params.id]),
      app.db.query('SELECT * FROM product_media WHERE product_id = $1 ORDER BY sort_order, created_at', [request.params.id])
    ]);
    if (!productResult.rowCount) return reply.code(404).send({ error: 'product_not_found' });
    return {
      ...productRow(productResult.rows[0]),
      variants: variantResult.rows.map(variantRow),
      listings: listingResult.rows.map(listingRow),
      media: mediaResult.rows
    };
  });

  app.post('/', async (request, reply) => {
    const body = request.body;
    const { targetSites, variants } = validateProduct(body);
    if (body.status && !STATUSES.has(body.status)) throw badRequest('Unsupported status');
    const productId = randomUUID();

    await withTransaction(app.db, async (client) => {
      await client.query(`
        INSERT INTO products (
          id, internal_code, source_url, original_title, category_hint,
          purchase_price_cny, packed_weight_g, product_dimensions,
          package_dimensions, raw_attributes, notes, target_sites, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      `, [
        productId, body.internalCode.trim(), body.sourceUrl ?? null, body.originalTitle.trim(),
        body.categoryHint ?? null, Number(body.purchasePriceCny), Number(body.packedWeightG),
        body.productDimensions ?? {}, body.packageDimensions ?? {}, body.rawAttributes ?? {},
        body.notes ?? null, targetSites, body.status ?? 'pending_ai'
      ]);

      for (const variant of variants) {
        await client.query(`
          INSERT INTO variants (
            product_id, seller_sku, color, size, other_attributes,
            purchase_price_cny, packed_weight_g, stock, participate_in_publish
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [
          productId, variant.sellerSku.trim(), variant.color ?? null, variant.size ?? null,
          variant.otherAttributes ?? {}, variant.purchasePriceCny ?? null,
          variant.packedWeightG ?? null, variant.stock ?? 0,
          variant.participateInPublish !== false
        ]);
      }
    });

    reply.code(201);
    return { id: productId, internalCode: body.internalCode, variantCount: variants.length };
  });

  app.patch('/:id', async (request, reply) => {
    const current = await app.db.query('SELECT * FROM products WHERE id = $1', [request.params.id]);
    if (!current.rowCount) return reply.code(404).send({ error: 'product_not_found' });
    const row = productRow(current.rows[0]);
    const source = request.query?.source === 'ai' ? 'ai' : 'human';
    const merged = mergeReviewFields(row, request.body, row.confirmedFields, PRODUCT_REVIEW_FIELDS, source);
    validateReviewValues(merged.values, 'product');
    const result = await app.db.query(`
      UPDATE products SET
        source_url=$2, original_title=$3, category_hint=$4, purchase_price_cny=$5,
        packed_weight_g=$6, product_dimensions=$7, package_dimensions=$8,
        raw_attributes=$9, notes=$10, target_sites=$11
      WHERE id=$1 RETURNING *
    `, [
      request.params.id, merged.values.sourceUrl || null, merged.values.originalTitle.trim(),
      merged.values.categoryHint || null, Number(merged.values.purchasePriceCny),
      Number(merged.values.packedWeightG), merged.values.productDimensions ?? {},
      merged.values.packageDimensions ?? {}, merged.values.rawAttributes ?? {},
      merged.values.notes || null, merged.values.targetSites
    ]);
    return { product: productRow(result.rows[0]), ignoredConfirmedFields: merged.ignoredConfirmedFields };
  });

  app.post('/:id/variants', async (request, reply) => {
    const values = {
      sellerSku: request.body?.sellerSku,
      color: request.body?.color ?? null,
      size: request.body?.size ?? null,
      otherAttributes: request.body?.otherAttributes ?? {},
      purchasePriceCny: request.body?.purchasePriceCny ?? null,
      packedWeightG: request.body?.packedWeightG ?? null,
      stock: request.body?.stock ?? 0,
      participateInPublish: request.body?.participateInPublish !== false
    };
    validateReviewValues(values, 'variant');
    const result = await app.db.query(`
      INSERT INTO variants (
        product_id, seller_sku, color, size, other_attributes, purchase_price_cny,
        packed_weight_g, stock, participate_in_publish
      ) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE EXISTS (SELECT 1 FROM products WHERE id=$1)
      RETURNING *
    `, [request.params.id, values.sellerSku.trim(), values.color, values.size, values.otherAttributes,
      values.purchasePriceCny, values.packedWeightG, Number(values.stock), values.participateInPublish]);
    if (!result.rowCount) return reply.code(404).send({ error: 'product_not_found' });
    reply.code(201);
    return variantRow(result.rows[0]);
  });

  app.patch('/:id/variants/:variantId', async (request, reply) => {
    const current = await app.db.query('SELECT * FROM variants WHERE id=$1 AND product_id=$2', [request.params.variantId, request.params.id]);
    if (!current.rowCount) return reply.code(404).send({ error: 'variant_not_found' });
    const row = variantRow(current.rows[0]);
    const source = request.query?.source === 'ai' ? 'ai' : 'human';
    const merged = mergeReviewFields(row, request.body, row.confirmedFields, VARIANT_REVIEW_FIELDS, source);
    validateReviewValues(merged.values, 'variant');
    const result = await app.db.query(`
      UPDATE variants SET seller_sku=$3,color=$4,size=$5,other_attributes=$6,
        purchase_price_cny=$7,packed_weight_g=$8,stock=$9,participate_in_publish=$10
      WHERE id=$1 AND product_id=$2 RETURNING *
    `, [request.params.variantId, request.params.id, merged.values.sellerSku.trim(), merged.values.color,
      merged.values.size, merged.values.otherAttributes ?? {}, merged.values.purchasePriceCny,
      merged.values.packedWeightG, Number(merged.values.stock), merged.values.participateInPublish]);
    return { variant: variantRow(result.rows[0]), ignoredConfirmedFields: merged.ignoredConfirmedFields };
  });

  app.put('/:id/listings/:site', async (request, reply) => {
    const site = request.params.site;
    if (!SITE_CODES.has(site)) throw badRequest('Unsupported site');
    const existing = await app.db.query('SELECT * FROM listings WHERE product_id=$1 AND site=$2', [request.params.id, site]);
    const current = existing.rowCount ? listingRow(existing.rows[0]) : {
      site, title: null, descriptionEnglish: null, specificationsEnglish: {}, categoryId: null,
      requiredAttributes: {}, familyName: null, familyData: {}, userProductData: [],
      currency: SITE_CURRENCIES[site], targetProfitUsd: null, targetMarginRate: null,
      pricingBasis: {}, confirmedFields: {}
    };
    const source = request.query?.source === 'ai' ? 'ai' : 'human';
    const merged = mergeReviewFields(current, request.body, current.confirmedFields, LISTING_REVIEW_FIELDS, source);
    validateReviewValues(merged.values, 'listing');
    const result = await app.db.query(`
      INSERT INTO listings (
        product_id,site,title,description_english,specifications_english,category_id,
        required_attributes,family_name,family_data,user_product_data,currency,
        target_profit_usd,target_margin_rate,pricing_basis
      ) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
        WHERE EXISTS (SELECT 1 FROM products WHERE id=$1)
      ON CONFLICT (product_id,site) DO UPDATE SET
        title=EXCLUDED.title,description_english=EXCLUDED.description_english,
        specifications_english=EXCLUDED.specifications_english,category_id=EXCLUDED.category_id,
        required_attributes=EXCLUDED.required_attributes,family_name=EXCLUDED.family_name,
        family_data=EXCLUDED.family_data,user_product_data=EXCLUDED.user_product_data,
        currency=EXCLUDED.currency,target_profit_usd=EXCLUDED.target_profit_usd,
        target_margin_rate=EXCLUDED.target_margin_rate,pricing_basis=EXCLUDED.pricing_basis
      RETURNING *
    `, [request.params.id, site, merged.values.title || null, merged.values.descriptionEnglish || null,
      merged.values.specificationsEnglish ?? {}, merged.values.categoryId || null,
      merged.values.requiredAttributes ?? {}, merged.values.familyName || null,
      merged.values.familyData ?? {}, merged.values.userProductData ?? [], merged.values.currency,
      merged.values.targetProfitUsd, merged.values.targetMarginRate, merged.values.pricingBasis ?? {}]);
    if (!result.rowCount) return reply.code(404).send({ error: 'product_not_found' });
    return { listing: listingRow(result.rows[0]), ignoredConfirmedFields: merged.ignoredConfirmedFields };
  });

  app.post('/:id/confirmations', async (request, reply) => {
    const entityType = request.body?.entityType;
    const fields = request.body?.fields;
    const entityId = request.body?.entityId;
    if (!Array.isArray(fields) || !fields.length || fields.some((field) => typeof field !== 'string')) {
      throw badRequest('fields must be a non-empty string array');
    }
    const allowed = entityType === 'product' ? PRODUCT_REVIEW_FIELDS
      : entityType === 'variant' ? VARIANT_REVIEW_FIELDS
      : entityType === 'listing' ? LISTING_REVIEW_FIELDS : [];
    if (!allowed.length || fields.some((field) => !allowed.includes(field))) throw badRequest('Unsupported confirmation field');
    let query;
    let parameters;
    if (entityType === 'product') {
      query = 'SELECT confirmed_fields FROM products WHERE id=$1'; parameters = [request.params.id];
    } else if (entityType === 'variant') {
      query = 'SELECT confirmed_fields FROM variants WHERE id=$1 AND product_id=$2'; parameters = [entityId, request.params.id];
    } else {
      query = 'SELECT confirmed_fields FROM listings WHERE id=$1 AND product_id=$2'; parameters = [entityId, request.params.id];
    }
    const current = await app.db.query(query, parameters);
    if (!current.rowCount) return reply.code(404).send({ error: 'review_entity_not_found' });
    const confirmedFields = updateConfirmations(current.rows[0].confirmed_fields, fields, request.body?.confirmed !== false);
    const table = entityType === 'product' ? 'products' : entityType === 'variant' ? 'variants' : 'listings';
    const result = await app.db.query(`UPDATE ${table} SET confirmed_fields=$1 WHERE id=$2 RETURNING confirmed_fields`, [confirmedFields, entityType === 'product' ? request.params.id : entityId]);
    return { entityType, entityId: entityType === 'product' ? request.params.id : entityId, confirmedFields: result.rows[0].confirmed_fields };
  });

  app.patch('/:id/status', async (request, reply) => {
    const status = request.body?.status;
    if (!STATUSES.has(status)) throw badRequest('Unsupported status');
    if (status === 'publishing' || status === 'published') {
      throw badRequest('Publishing states can only be set by the publish workflow');
    }
    const result = await app.db.query('UPDATE products SET status = $1 WHERE id = $2 RETURNING *', [status, request.params.id]);
    if (!result.rowCount) return reply.code(404).send({ error: 'product_not_found' });
    return productRow(result.rows[0]);
  });
}
