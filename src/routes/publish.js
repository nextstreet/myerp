import { buildInternalUpDraft, preflightProductFamily } from '../domain/up-mapper.js';
import { buildGlobalUpFamilyPreview } from '../integrations/mercadolibre/global-up-mapper.js';
import { randomUUID } from 'node:crypto';

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
  const [productResult, variantResult, listingResult, listingVariantResult, mediaResult] = await Promise.all([
    db.query(`
      SELECT p.*, COALESCE((SELECT family_name FROM listings WHERE product_id = p.id AND family_name IS NOT NULL LIMIT 1), p.original_title) AS family_name
      FROM products p WHERE p.id = $1
    `, [productId]),
    db.query('SELECT * FROM variants WHERE product_id = $1 ORDER BY created_at', [productId]),
    db.query('SELECT * FROM listings WHERE product_id = $1 ORDER BY site', [productId]),
    db.query(`
      SELECT lv.*,l.site FROM listing_variants lv
      JOIN listings l ON l.id=lv.listing_id WHERE l.product_id=$1
    `, [productId]),
    db.query(`
      SELECT vm.variant_id,vm.is_primary,pm.id AS media_id,pm.external_url,pm.storage_key,
        pm.mercado_picture_id,pm.validation_status
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
  for (const row of mediaResult.rows) (mediaByVariant[row.variant_id] ??= []).push({
    id: row.media_id,
    externalUrl: row.external_url,
    storageKey: row.storage_key,
    mercadoPictureId: row.mercado_picture_id,
    validationStatus: row.validation_status,
    isPrimary: row.is_primary
  });
  const pricesBySite = {};
  for (const row of listingVariantResult.rows) {
    (pricesBySite[row.site] ??= {})[row.variant_id] = Number(row.price);
  }
  const listings = listingResult.rows.map((row) => ({
    site: row.site,
    title: row.title,
    categoryId: row.category_id,
    currency: row.currency,
    price: row.pricing_basis?.normalPrice ?? null,
    requiredAttributes: row.required_attributes,
    variantPrices: pricesBySite[row.site] ?? {}
  }));
  return {
    product: toProduct(productResult.rows[0]),
    variants: variantResult.rows.map(toVariant),
    listings,
    mediaByVariant
  };
}

export async function publishRoutes(app) {
  app.get('/jobs', async (request) => {
    const limit = Math.min(Math.max(Number(request.query?.limit ?? 50), 1), 200);
    const result = await app.db.query(`
      SELECT id,product_id,listing_id,site,idempotency_key,request_summary,response_summary,
        http_status,error_code,error_message,retry_count,status,created_at,completed_at
      FROM publish_jobs
      WHERE ($1::uuid IS NULL OR product_id=$1)
      ORDER BY created_at DESC LIMIT $2
    `, [request.query?.productId ?? null, limit]);
    return { jobs: result.rows };
  });

  app.get('/:productId/preflight', async (request) => {
    const family = await loadFamily(app.db, request.params.productId);
    return preflightProductFamily(family);
  });

  app.get('/:productId/draft', async (request) => {
    const family = await loadFamily(app.db, request.params.productId);
    return buildInternalUpDraft(family);
  });

  app.get('/:productId/global-up-preview', async (request) => {
    const family = await loadFamily(app.db, request.params.productId);
    const preflight = preflightProductFamily(family);
    if (!preflight.valid) {
      const error = new Error('Product family failed local preflight');
      error.statusCode = 422;
      error.code = 'preflight_failed';
      error.details = preflight;
      throw error;
    }
    return buildGlobalUpFamilyPreview(family);
  });

  app.post('/:productId/remote-preflight', async (request) => {
    if (!app.mercadoLibreOAuth) {
      const error = new Error('Mercado Libre OAuth is not configured on the server');
      error.statusCode = 503;
      error.code = 'meli_not_configured';
      throw error;
    }
    const accountId = request.body?.accountId;
    if (!accountId) {
      const error = new Error('accountId is required');
      error.statusCode = 400;
      error.code = 'validation_error';
      throw error;
    }
    const family = await loadFamily(app.db, request.params.productId);
    const local = preflightProductFamily(family);
    const capabilities = await app.mercadoLibreOAuth.inspectCapabilities(accountId);
    const categoryIds = family.listings.map((listing) => listing.categoryId).filter(Boolean);
    const categoryRequirements = await app.mercadoLibreOAuth.categoryRequirements(accountId, categoryIds);
    const missingRequiredAttributes = [];
    for (const category of categoryRequirements.categories) {
      const listing = family.listings.find((item) => item.categoryId === category.categoryId);
      const supplied = new Set(Object.keys(listing?.requiredAttributes ?? {}));
      for (const attribute of category.requiredAttributes) {
        if (!supplied.has(attribute.id)) missingRequiredAttributes.push({
          categoryId: category.categoryId,
          site: listing?.site ?? null,
          attributeId: attribute.id,
          name: attribute.name
        });
      }
    }
    const preview = local.valid ? buildGlobalUpFamilyPreview(family) : null;
    const remoteErrors = [];
    if (!capabilities.globalSelling) remoteErrors.push({ code: 'account_not_global_selling' });
    if (!capabilities.userProductSeller) remoteErrors.push({ code: 'user_product_seller_tag_missing' });
    if (!categoryRequirements.ok) remoteErrors.push({ code: 'category_metadata_lookup_failed' });
    if (missingRequiredAttributes.length) remoteErrors.push({ code: 'required_attributes_missing', count: missingRequiredAttributes.length });
    const missingPublishablePictures = preview?.body.filter((item) => !item.pictures.length).length ?? 0;
    if (missingPublishablePictures) remoteErrors.push({ code: 'picture_upload_pending', count: missingPublishablePictures });
    const response = {
      ok: local.valid && remoteErrors.length === 0,
      readOnly: true,
      livePublishAttempted: false,
      local,
      capabilities,
      categoryRequirements,
      missingRequiredAttributes,
      remoteErrors,
      preview
    };
    for (const site of family.product.targetSites) {
      await app.db.query(`
        INSERT INTO publish_jobs (
          product_id,site,idempotency_key,request_summary,response_summary,http_status,
          error_code,error_message,status,completed_at
        ) VALUES ($1,$2,$3,$4,$5,200,$6,$7,$8,now())
      `, [family.product.id, site, `preflight:${randomUUID()}`,
        { operation: 'read_only_remote_preflight', accountId, variantCount: local.summary.variantCount },
        { ok: response.ok, errorCount: remoteErrors.length, missingRequiredAttributeCount: missingRequiredAttributes.length },
        remoteErrors[0]?.code ?? null, remoteErrors.length ? 'Remote preflight requires corrections' : null,
        response.ok ? 'validation_passed' : 'validation_failed']);
    }
    return response;
  });

  app.post('/:productId/live', async (request) => {
    if (request.body?.confirmation !== 'PUBLISH') {
      const error = new Error('Explicit PUBLISH confirmation is required');
      error.statusCode = 400;
      error.code = 'publish_confirmation_required';
      throw error;
    }
    if (!app.config.mercadoLibre.publishEnabled) {
      const error = new Error('Live publishing is disabled by MELI_PUBLISH_ENABLED');
      error.code = 'publishing_disabled';
      error.statusCode = 403;
      throw error;
    }
    const error = new Error('Official site-specific UP publishing adapter is not enabled in v0.5.0');
    error.statusCode = 501;
    error.code = 'publishing_adapter_pending';
    throw error;
  });
}
