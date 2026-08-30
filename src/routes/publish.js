import { buildInternalUpDraft, preflightProductFamily } from '../domain/up-mapper.js';

function toProduct(row) {
  return {
    id: row.id,
    internalCode: row.internal_code,
    originalTitle: row.original_title,
    familyName: row.family_name,
    purchasePriceCny: Number(row.purchase_price_cny),
    packedWeightG: row.packed_weight_g,
    rawAttributes: row.raw_attributes,
    targetSites: row.target_sites
  };
}

function toVariant(row) {
  return {
    id: row.id,
    sellerSku: row.seller_sku,
    color: row.color,
    size: row.size,
    otherAttributes: row.other_attributes,
    purchasePriceCny: row.purchase_price_cny === null ? null : Number(row.purchase_price_cny),
    packedWeightG: row.packed_weight_g,
    stock: row.stock,
    participateInPublish: row.participate_in_publish
  };
}

async function loadFamily(db, productId) {
  const [productResult, variantResult, listingResult, mediaResult] = await Promise.all([
    db.query(`
      SELECT p.*, COALESCE((SELECT family_name FROM listings WHERE product_id = p.id AND family_name IS NOT NULL LIMIT 1), p.original_title) AS family_name
      FROM products p WHERE p.id = $1
    `, [productId]),
    db.query('SELECT * FROM variants WHERE product_id = $1 ORDER BY created_at', [productId]),
    db.query('SELECT * FROM listings WHERE product_id = $1 ORDER BY site', [productId]),
    db.query(`
      SELECT vm.variant_id, pm.id AS media_id
      FROM variant_media vm
      JOIN product_media pm ON pm.id = vm.media_id
      JOIN variants v ON v.id = vm.variant_id
      WHERE v.product_id = $1 AND pm.media_type = 'image'
      ORDER BY vm.variant_id, vm.sort_order
    `, [productId])
  ]);
  if (!productResult.rowCount) {
    const error = new Error('Product not found');
    error.statusCode = 404;
    error.code = 'product_not_found';
    throw error;
  }
  const mediaByVariant = {};
  for (const row of mediaResult.rows) (mediaByVariant[row.variant_id] ??= []).push(row.media_id);
  const listings = listingResult.rows.map((row) => ({
    site: row.site,
    title: row.title,
    categoryId: row.category_id,
    currency: row.currency,
    price: row.pricing_basis?.normalPrice ?? null,
    requiredAttributes: row.required_attributes
  }));
  return {
    product: toProduct(productResult.rows[0]),
    variants: variantResult.rows.map(toVariant),
    listings,
    mediaByVariant
  };
}

export async function publishRoutes(app) {
  app.get('/:productId/preflight', async (request) => {
    const family = await loadFamily(app.db, request.params.productId);
    return preflightProductFamily(family);
  });

  app.get('/:productId/draft', async (request) => {
    const family = await loadFamily(app.db, request.params.productId);
    return buildInternalUpDraft(family);
  });

  app.post('/:productId/live', async (request) => {
    if (request.body?.confirmation !== 'PUBLISH') {
      const error = new Error('Explicit PUBLISH confirmation is required');
      error.statusCode = 400;
      error.code = 'publish_confirmation_required';
      throw error;
    }
    app.mercadoLibre.assertPublishingEnabled();
    const error = new Error('Official site-specific UP publishing adapter is not enabled in v0.1.0');
    error.statusCode = 501;
    error.code = 'publishing_adapter_pending';
    throw error;
  });
}
