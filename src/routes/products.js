import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db/pool.js';

const SITE_CODES = new Set(['MLM', 'MCO', 'MLC']);
const STATUSES = new Set([
  'pending_import', 'pending_ai', 'ai_processing', 'pending_review',
  'pending_publish', 'publishing', 'published', 'publish_failed', 'paused'
]);

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

export async function productsRoutes(app) {
  app.get('/', async (request) => {
    const limit = Math.min(Math.max(Number(request.query?.limit ?? 50), 1), 200);
    const status = request.query?.status;
    if (status && !STATUSES.has(status)) throw badRequest('Unsupported status');
    const result = await app.db.query(`
      SELECT p.*, COUNT(v.id)::integer AS variant_count
      FROM products p
      LEFT JOIN variants v ON v.product_id = p.id
      WHERE ($1::product_status IS NULL OR p.status = $1)
      GROUP BY p.id
      ORDER BY p.updated_at DESC
      LIMIT $2
    `, [status ?? null, limit]);
    return result.rows.map((row) => ({ ...productRow(row), variantCount: row.variant_count }));
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
      listings: listingResult.rows,
      media: mediaResult.rows
    };
  });

  app.post('/', async (request, reply) => {
    const body = request.body;
    const { targetSites, variants } = validateProduct(body);
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
