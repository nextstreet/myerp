import { buildInternalUpDraft, preflightProductFamily } from '../domain/up-mapper.js';
import { effectiveMediaForVariants } from '../domain/media-selection.js';
import { normalizeSelectedSites, scopeFamilyToSites } from '../domain/site-selection.js';
import { buildGlobalUpFamilyPreview } from '../integrations/mercadolibre/global-up-mapper.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withTransaction } from '../db/pool.js';
import { normalizeFamilyPublishResult } from '../integrations/mercadolibre/publish-result.js';
import { compareCbtCategory } from '../domain/publish-target.js';
import { assessVariationSupport, sameVariantAxes, variantAxes } from '../domain/category-assessment.js';
import { resolveWorkflowPublishMode } from '../domain/publish-workflow.js';

function toProduct(row) {
  return {
    id: row.id,
    internalCode: row.internal_code,
    originalTitle: row.original_title,
    familyName: row.family_name,
    purchasePriceCny: Number(row.purchase_price_cny),
    packedWeightG: row.packed_weight_g,
    rawAttributes: row.raw_attributes,
    targetSites: row.target_sites,
    workflowType: row.workflow_type ?? 'new_product'
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
    globalNetProceedsUsd: row.global_net_proceeds_usd === null ? null : Number(row.global_net_proceeds_usd),
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
      SELECT vm.variant_id,COALESCE(vm.is_primary,false) AS is_primary,pm.id AS media_id,pm.external_url,pm.storage_key,
        pm.mercado_picture_id,pm.validation_status,pm.mime_type,pm.original_filename
      FROM product_media pm
      LEFT JOIN variant_media vm ON vm.media_id=pm.id
      WHERE pm.product_id = $1 AND pm.media_type = 'image'
      ORDER BY vm.variant_id NULLS LAST,vm.is_primary DESC,vm.sort_order,pm.sort_order,pm.created_at
    `, [productId])
  ]);
  if (!productResult.rowCount) {
    const error = new Error('Product not found');
    error.statusCode = 404;
    error.code = 'product_not_found';
    throw error;
  }
  const mediaByVariant = effectiveMediaForVariants({
    variants: variantResult.rows, mediaRows: mediaResult.rows
  });
  const pricesBySite = {};
  for (const row of listingVariantResult.rows) {
    (pricesBySite[row.site] ??= {})[row.variant_id] = Number(row.price);
  }
  const product = toProduct(productResult.rows[0]);
  const targetSites = Array.isArray(product.targetSites)
    ? product.targetSites
    : String(product.targetSites ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean);
  // CBT category data, attributes and sale terms belong to the global Family,
  // even though the review UI stores them inside a site listing. Preserve the
  // first non-empty reviewed values across all product listings before the
  // caller scopes the publish operation to one or more sites.
  const globalFamilyData = listingResult.rows.reduce((result, row) => {
    const data = row.family_data ?? {};
    if (!result.globalCategoryId && (data.globalCategoryId || data.global_category_id)) {
      result.globalCategoryId = data.globalCategoryId ?? data.global_category_id;
    }
    if (!result.globalAttributes && data.globalAttributes && Object.keys(data.globalAttributes).length) {
      result.globalAttributes = data.globalAttributes;
    }
    if (!result.globalSaleTerms && Array.isArray(data.globalSaleTerms) && data.globalSaleTerms.length) {
      result.globalSaleTerms = data.globalSaleTerms;
    }
    return result;
  }, {});
  const listings = listingResult.rows.filter((row) => targetSites.includes(row.site)).map((row) => ({
    id: row.id,
    site: row.site,
    title: row.title,
    descriptionEnglish: row.description_english,
    categoryId: row.category_id,
    currency: row.currency,
    price: row.pricing_basis?.normalPrice ?? null,
    requiredAttributes: row.required_attributes,
    familyName: row.family_name,
    mercadoLibreFamilyId: row.mercado_libre_family_id ?? null,
    mercadoLibreItemId: row.mercado_libre_item_id ?? null,
    familyData: {
      ...(row.family_data ?? {}),
      ...(globalFamilyData.globalAttributes ? { globalAttributes: globalFamilyData.globalAttributes } : {}),
      ...(globalFamilyData.globalSaleTerms ? { globalSaleTerms: globalFamilyData.globalSaleTerms } : {})
    },
    globalCategoryId: globalFamilyData.globalCategoryId ?? null,
    variantPrices: pricesBySite[row.site] ?? {}
  }));
  return {
    product,
    variants: variantResult.rows.map(toVariant),
    listings,
    mediaByVariant
  };
}

function requestedSites(request, family) {
  const raw = request.body?.sites ?? String(request.query?.sites ?? '').split(',').filter(Boolean);
  try {
    return normalizeSelectedSites(raw, family.product.targetSites);
  } catch (error) {
    error.statusCode = 400;
    throw error;
  }
}

async function resolvePublishTarget(app, accountId, request, family) {
  const mode = resolveWorkflowPublishMode(family.product.workflowType, request.body?.publishMode);
  if (mode === 'create') return { mode };
  const sourceItemId = String(request.body?.existingItemId ?? '').trim().toUpperCase();
  const persistedFamilyIds = [...new Set(family.listings
    .map((listing) => listing.mercadoLibreFamilyId)
    .map((id) => String(id ?? '').trim())
    .filter(Boolean))];

  if (sourceItemId && /^\d+$/.test(sourceItemId)) {
    return {
      mode,
      sourceItemId: null,
      sourceCbtItemId: null,
      sitelessFamilyId: sourceItemId,
      existingCategoryId: family.listings[0]?.familyData?.globalCategoryId ?? null,
      existingFamilyName: family.listings.find((listing) => listing.familyName)?.familyName ?? null,
      categoryVerification: 'manual_family_id',
      duplicateSourceSkus: [],
      resolution: { source: 'manual_family_id', persistedFamilyIds }
    };
  }
  if (!sourceItemId) {
    if (persistedFamilyIds.length > 1) {
      throw problem('Multiple persisted Family IDs exist; choose one explicitly',
        'existing_family_id_ambiguous', 422, { persistedFamilyIds });
    }
    if (!persistedFamilyIds.length) {
      throw problem('An existing Family ID or a source item ID is required for existing Family mode',
        'existing_family_id_required', 422, { persistedFamilyIds });
    }
    return {
      mode,
      sourceItemId: null,
      sourceCbtItemId: null,
      sitelessFamilyId: persistedFamilyIds[0],
      existingCategoryId: family.listings[0]?.familyData?.globalCategoryId ?? null,
      existingFamilyName: family.listings.find((listing) => listing.familyName)?.familyName ?? null,
      categoryVerification: 'persisted',
      duplicateSourceSkus: [],
      resolution: { source: 'persisted_family_id', persistedFamilyIds }
    };
  }
  if (!/^(CBT|MLM|MCO|MLC)\d+$/.test(sourceItemId)) {
    throw problem('A valid Family ID or owned CBT/marketplace item ID is required for existing Family mode',
      'existing_family_source_item_required');
  }

  const inspection = await app.mercadoLibreOAuth.inspectItem(accountId, sourceItemId);
  const apiFamilyId = String(
    inspection.globalItem?.familyId ?? inspection.item?.familyId ?? inspection.userProduct?.familyId ?? ''
  ).trim();
  const sitelessFamilyId = apiFamilyId || (persistedFamilyIds.length === 1 ? persistedFamilyIds[0] : '');
  if (!sitelessFamilyId) {
    throw problem('The source item does not expose a Siteless Family ID and no unambiguous persisted Family ID is available',
      'existing_family_id_unavailable', 422, {
        sourceItemId,
        persistedFamilyIds,
        cbtItemId: inspection.globalItem?.id ?? inspection.item?.cbtItemId ?? null,
        userProductId: inspection.userProduct?.id ?? inspection.item?.userProductId ?? null,
        lookups: inspection.lookups ?? {}
      });
  }
  const expectedCategoryId = family.listings.find((listing) => listing.globalCategoryId)?.globalCategoryId ?? null;
  const globalCategoryId = inspection.globalItem?.categoryId ?? null;
  const localCategoryId = inspection.item?.categoryId ?? null;
  const categoryComparison = compareCbtCategory(expectedCategoryId, globalCategoryId, localCategoryId);
  const existingCategoryId = categoryComparison.existingCategoryId;
  if (categoryComparison.status === 'mismatched') {
    throw problem('The source Family belongs to a different CBT category', 'existing_family_category_mismatch', 422,
      { sourceItemId, expectedCategoryId, existingCategoryId: globalCategoryId });
  }
  const inspectedSkus = new Set();
  for (const inspected of [inspection.item, inspection.globalItem]) {
    if (inspected?.sellerCustomField) inspectedSkus.add(String(inspected.sellerCustomField));
    const sku = inspected?.attributes?.find((attribute) => attribute.id === 'SELLER_SKU')?.valueName;
    if (sku) inspectedSkus.add(String(sku));
  }
  const requestedSkus = family.variants.filter((variant) => variant.participateInPublish !== false)
    .map((variant) => variant.sellerSku);
  const duplicateSourceSkus = requestedSkus.filter((sku) => inspectedSkus.has(String(sku)));
  return {
    mode,
    sourceItemId,
    sourceCbtItemId: inspection.globalItem?.id ?? inspection.item?.cbtItemId ?? null,
    sitelessFamilyId,
    existingCategoryId,
    existingFamilyName: inspection.globalItem?.familyName ?? inspection.item?.familyName ?? null,
    categoryVerification: categoryComparison.status,
    duplicateSourceSkus,
    resolution: {
      globalItemId: inspection.globalItem?.id ?? null,
      localItemId: inspection.item?.id ?? null,
      userProductId: inspection.userProduct?.id ?? inspection.item?.userProductId ?? null,
      lookups: inspection.lookups ?? {},
      source: apiFamilyId ? 'item_api' : 'persisted_family_id',
      persistedFamilyIds
    }
  };
}

async function categoryGate(app, family) {
  const selectedVariants = family.variants.filter((variant) => variant.participateInPublish !== false);
  if (selectedVariants.length <= 1) return [];
  const result = await app.db.query(`
    SELECT site,selected_category_id,supports_variations,status,required_variant_axes,missing_variant_axes
    FROM product_category_assessments WHERE product_id=$1 AND site=ANY($2::site_code[])
  `, [family.product.id, family.product.targetSites]);
  const bySite = new Map(result.rows.map((row) => [row.site, row]));
  const currentAxes = variantAxes(selectedVariants);
  const errors = [];
  for (const listing of family.listings) {
    const assessment = bySite.get(listing.site);
    if (!assessment || !['confirmed', 'unsupported'].includes(assessment.status)) {
      errors.push({ code: 'category_assessment_required', site: listing.site });
      continue;
    }
    if (!sameVariantAxes(assessment.required_variant_axes ?? [], currentAxes)) {
      errors.push({ code: 'category_assessment_stale', site: listing.site,
        assessedAxes: assessment.required_variant_axes ?? [], currentAxes });
    } else if (assessment.selected_category_id !== listing.categoryId) {
      errors.push({ code: 'category_assessment_stale', site: listing.site,
        assessedCategoryId: assessment.selected_category_id, listingCategoryId: listing.categoryId });
    } else if (assessment.supports_variations !== true) {
      errors.push({ code: 'category_does_not_support_variant_axes', site: listing.site,
        missingAxes: assessment.missing_variant_axes ?? [] });
    }
  }
  return errors;
}

function appendPreflightErrors(preflight, errors) {
  if (!errors.length) return preflight;
  return { ...preflight, valid: false, errors: [...preflight.errors, ...errors] };
}

function remoteVariationIssues(family, requirements) {
  if (family.variants.filter((variant) => variant.participateInPublish !== false).length <= 1) return [];
  const categoryIds = [
    ...family.listings.map((listing) => ({ site: listing.site, categoryId: listing.categoryId })),
    { site: 'CBT', categoryId: family.listings.find((listing) => listing.globalCategoryId)?.globalCategoryId ?? null }
  ].filter((item) => item.categoryId);
  return categoryIds.flatMap(({ site, categoryId }) => {
    const metadata = requirements.categories.find((category) => category.categoryId === categoryId);
    if (!metadata?.ok) return [{ code: 'variation_metadata_lookup_failed', site, categoryId }];
    const assessment = assessVariationSupport(family.variants, metadata.variationAttributes);
    return assessment.supported ? [] : [{ code: 'category_does_not_support_variant_axes', site, categoryId,
      requiredAxes: assessment.requiredAxes, allowedAxes: assessment.allowedAxes, missingAxes: assessment.missingAxes }];
  });
}

function problem(message, code, statusCode = 400, details) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function pictureId(payload) {
  return payload?.id ?? payload?.picture_id ?? payload?.variations?.[0]?.id ?? null;
}

async function uploadRequiredPictures(app, accountId, family) {
  const unique = new Map();
  for (const images of Object.values(family.mediaByVariant)) {
    for (const image of images) unique.set(image.id, image);
  }
  const uploaded = [];
  const skipped = [];
  const externalOnly = [...unique.values()].filter((media) => !media.mercadoPictureId && media.externalUrl);
  if (externalOnly.length) {
    throw problem('External image links must be downloaded and uploaded into Tianchuan ERP before Mercado Libre upload',
      'external_media_requires_local_upload', 422, { mediaIds: externalOnly.map((media) => media.id) });
  }
  const unreviewed = [...unique.values()].filter((media) => !media.mercadoPictureId && media.validationStatus !== 'ready');
  if (unreviewed.length) {
    throw problem('Every selected image must be marked ready before Mercado Libre upload',
      'media_review_required', 422, { mediaIds: unreviewed.map((media) => media.id) });
  }
  for (const media of unique.values()) {
    if (media.mercadoPictureId) {
      skipped.push({ mediaId: media.id, reason: 'already_uploaded' });
      continue;
    }
    if (!media.storageKey) throw problem('A selected image has no local file or external URL', 'media_source_missing', 422, { mediaId: media.id });
    const root = resolve(app.config.storage.localRoot);
    const path = resolve(root, media.storageKey);
    if (!path.startsWith(`${root}/`)) throw problem('Invalid media storage path', 'invalid_storage_path', 500);
    const bytes = await readFile(path);
    const response = await app.mercadoLibreOAuth.uploadPicture(accountId, {
      bytes,
      mimeType: media.mimeType,
      filename: media.originalFilename
    });
    const id = response.ok ? pictureId(response.payload) : null;
    if (!id) {
      const code = response.payload?.error ?? `http_${response.status}`;
      await app.db.query(`
        UPDATE product_media SET validation_status='rejected',mercado_upload_error=$2 WHERE id=$1
      `, [media.id, String(code).slice(0, 500)]);
      throw problem(`Mercado Libre picture upload returned HTTP ${response.status}`, 'meli_picture_upload_failed', 502, { mediaId: media.id, httpStatus: response.status, providerCode: code });
    }
    await app.db.query(`
      UPDATE product_media SET mercado_picture_id=$2,validation_status='ready',
        mercado_upload_error=NULL,mercado_uploaded_at=now() WHERE id=$1
    `, [media.id, id]);
    uploaded.push({ mediaId: media.id, mercadoPictureId: id });
  }
  return { uploaded, skipped };
}

async function recordPublishJobs(app, family, requestKey, values) {
  for (const listing of family.listings) {
    await app.db.query(`
      INSERT INTO publish_jobs (
        product_id,listing_id,site,idempotency_key,operation,request_summary,response_summary,
        http_status,error_code,error_message,status,completed_at
      ) VALUES ($1,$2,$3,$4,'family_publish',$5,$6,$7,$8,$9,$10,now())
      ON CONFLICT (idempotency_key) DO UPDATE SET
        response_summary=EXCLUDED.response_summary,http_status=EXCLUDED.http_status,
        error_code=EXCLUDED.error_code,error_message=EXCLUDED.error_message,
        status=EXCLUDED.status,completed_at=now()
    `, [family.product.id, listing.id, listing.site, `publish:${requestKey}:${listing.site}`,
      values.requestSummary, values.responseSummary, values.httpStatus,
      values.errorCode ?? null, values.errorMessage ?? null, values.status]);
  }
}

function missingRequiredAttributesFor(family, requirements) {
  const missing = [];
  const selectedVariants = family.variants.filter((variant) => variant.participateInPublish !== false);
  const variantAttributeIds = new Set(Object.keys(selectedVariants[0]?.otherAttributes ?? {}).filter((id) =>
    selectedVariants.every((variant) => Object.hasOwn(variant.otherAttributes ?? {}, id))
  ).map((id) => id.toUpperCase()));
  for (const category of requirements.categories) {
    const listing = family.listings.find((item) => item.categoryId === category.categoryId);
    const globalAttributes = family.listings.find((item) => item.familyData?.globalAttributes)?.familyData?.globalAttributes ?? {};
    const supplied = new Set([
      ...Object.keys(listing?.requiredAttributes ?? {}),
      ...Object.keys(category.categoryId?.startsWith('CBT') ? globalAttributes : {}),
      ...variantAttributeIds
    ].map((id) => id.toUpperCase()));
    for (const attribute of category.requiredAttributes) {
      if (!supplied.has(String(attribute.id).toUpperCase()) && !['SELLER_SKU', 'COLOR', 'SIZE'].includes(attribute.id)) {
        missing.push({ categoryId: category.categoryId, site: listing?.site ?? 'CBT', attributeId: attribute.id, name: attribute.name });
      }
    }
  }
  return missing;
}

async function persistPublishResult(app, family, normalized, rawPayload) {
  const variantsBySku = new Map(family.variants.map((variant) => [variant.sellerSku, variant]));
  const expected = family.variants.filter((variant) => variant.participateInPublish !== false);
  const returnedSkus = new Set(normalized.userProducts.map((item) => item.sellerSku).filter(Boolean));
  const missingSkus = expected.map((variant) => variant.sellerSku).filter((sku) => !returnedSkus.has(sku));
  const failedProducts = normalized.userProducts.filter((item) => item.error);
  const incompleteIdentifiers = normalized.userProducts.flatMap((item) => {
    const missing = [];
    if (!item.userProductId) missing.push('userProductId');
    if (!item.globalItemId) missing.push('globalItemId');
    for (const listing of family.listings) {
      if (!item.sites.find((site) => site.site === listing.site)?.itemId) missing.push(`itemId:${listing.site}`);
    }
    return missing.length ? [{ sellerSku: item.sellerSku, missing }] : [];
  });
  const complete = Boolean(normalized.familyId) && !missingSkus.length && !failedProducts.length
    && !incompleteIdentifiers.length;
  // HTTP success with incomplete identifiers is not a proven publication and
  // is also not a safe-to-retry failure: Mercado Libre may already have
  // created some resources. Keep it in an explicit reconciliation state.
  const publishStatus = complete ? 'published' : 'reconciliation_required';

  // Normalize an arbitrary value into something PostgreSQL can safely store in
  // a jsonb column, then serialize it explicitly as a JSON string. node-postgres
  // binds a JS array argument as a PostgreSQL array literal (not JSON), which is
  // invalid for a jsonb column and raises 22P02; explicit string serialization
  // sidesteps that ambiguity for objects, arrays and scalars alike.
  const jsonb = (value) => {
    if (value == null) return '{}';
    if (typeof value === 'string') return JSON.stringify({ message: value });
    return JSON.stringify(value);
  };

  await withTransaction(app.db, async (client) => {
    for (const item of normalized.userProducts) {
      const variant = variantsBySku.get(item.sellerSku);
      if (!variant) continue;
      for (const listing of family.listings) {
        const siteResult = item.sites.find((site) => site.site === listing.site);
        await client.query(`
          UPDATE listing_variants SET mercado_libre_user_product_id=$3,
            mercado_libre_global_item_id=COALESCE($4,mercado_libre_global_item_id),
            mercado_libre_item_id=COALESCE($5,mercado_libre_item_id),
            mercado_payload=$6,publish_status=$7,publish_error=$8
          WHERE listing_id=$1 AND variant_id=$2
        `, [listing.id, variant.id, item.userProductId, item.globalItemId, siteResult?.itemId ?? null,
          jsonb(item.raw), item.error || siteResult?.error || !siteResult?.itemId ? 'failed' : 'published',
          jsonb(item.error ?? siteResult?.error ?? (!siteResult?.itemId ? { code: 'item_id_missing' } : {}))]);
      }
    }
    for (const listing of family.listings) {
      const siteProducts = normalized.userProducts.map((item) => ({
        sellerSku: String(item.sellerSku ?? ''),
        userProductId: item.userProductId == null ? null : String(item.userProductId),
        globalItemId: item.globalItemId == null ? null : String(item.globalItemId),
        itemId: item.sites.find((site) => site.site === listing.site)?.itemId == null
          ? null
          : String(item.sites.find((site) => site.site === listing.site)?.itemId)
      }));
      // siteProducts is a JS array; node-postgres binds an array as a PostgreSQL
      // array literal, which is invalid JSON for the jsonb column and raises 22P02
      // (invalid input syntax for type json). Serialize it explicitly so the jsonb
      // column receives a real JSON array.
      await client.query(`
        UPDATE listings SET mercado_libre_family_id=$2,family_data=family_data || $3,user_product_data=$4,
          publish_status=$6,mercado_libre_item_id=COALESCE($5,mercado_libre_item_id)
        WHERE id=$1
      `, [listing.id, normalized.familyId, JSON.stringify({ familyId: normalized.familyId }), JSON.stringify(siteProducts),
        siteProducts.find((item) => item.itemId)?.itemId ?? null, publishStatus]);
    }
    await client.query('UPDATE products SET status=$2 WHERE id=$1', [family.product.id, publishStatus]);
  });
  return {
    complete,
    issues: {
      missingFamilyId: !normalized.familyId,
      missingSkus,
      failedSellerSkus: failedProducts.map((item) => item.sellerSku).filter(Boolean),
      incompleteIdentifiers
    },
    familyId: normalized.familyId,
    userProducts: normalized.userProducts,
    providerResponse: rawPayload
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
    const loaded = await loadFamily(app.db, request.params.productId);
    const family = scopeFamilyToSites(loaded, requestedSites(request, loaded));
    return appendPreflightErrors(preflightProductFamily(family), await categoryGate(app, family));
  });

  app.get('/:productId/draft', async (request) => {
    const family = await loadFamily(app.db, request.params.productId);
    return buildInternalUpDraft(family);
  });

  app.get('/:productId/global-up-preview', async (request) => {
    const loaded = await loadFamily(app.db, request.params.productId);
    const family = scopeFamilyToSites(loaded, requestedSites(request, loaded));
    const preflight = appendPreflightErrors(preflightProductFamily(family), await categoryGate(app, family));
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
    const loaded = await loadFamily(app.db, request.params.productId);
    const family = scopeFamilyToSites(loaded, requestedSites(request, loaded));
    const publishTarget = await resolvePublishTarget(app, accountId, request, family);
    const targetedFamily = { ...family, publishTarget };
    const local = appendPreflightErrors(preflightProductFamily(family), await categoryGate(app, family));
    const capabilities = await app.mercadoLibreOAuth.inspectCapabilities(accountId);
    const previewForCategory = local.valid ? buildGlobalUpFamilyPreview(targetedFamily) : null;
    const globalCategoryId = family.listings.find((listing) => listing.globalCategoryId)?.globalCategoryId ?? null;
    const categoryIds = [...family.listings.map((listing) => listing.categoryId), globalCategoryId].filter(Boolean);
    const categoryRequirements = await app.mercadoLibreOAuth.categoryRequirements(accountId, categoryIds);
    const missingRequiredAttributes = missingRequiredAttributesFor(family, categoryRequirements);
    const missingGlobalAttributes = missingRequiredAttributes.filter((item) => item.categoryId?.startsWith('CBT'));
    const preview = previewForCategory;
    const remoteErrors = [];
    const remoteWarnings = [];
    if (!capabilities.globalSelling) remoteErrors.push({ code: 'account_not_global_selling' });
    if (!capabilities.userProductSeller) remoteErrors.push({ code: 'user_product_seller_tag_missing' });
    const globalCategoryMetadata = categoryRequirements.categories.find((item) => item.categoryId === globalCategoryId);
    if (globalCategoryId && !globalCategoryMetadata?.ok) remoteErrors.push({ code: 'global_category_metadata_lookup_failed' });
    if (missingGlobalAttributes.length) remoteErrors.push({ code: 'global_required_attributes_missing', count: missingGlobalAttributes.length });
    if (!globalCategoryId) remoteErrors.push({ code: 'global_category_missing' });
    remoteErrors.push(...remoteVariationIssues(family, categoryRequirements));
    if (publishTarget.mode === 'update' && publishTarget.categoryVerification !== 'matched') {
      remoteWarnings.push({ code: 'existing_family_global_category_not_exposed' });
    }
    if (publishTarget.duplicateSourceSkus?.length) {
      remoteWarnings.push({ code: 'source_item_sku_already_selected', sellerSkus: publishTarget.duplicateSourceSkus });
    }
    if (publishTarget.mode === 'update' && publishTarget.existingFamilyName
      && publishTarget.existingFamilyName !== family.product.familyName) {
      remoteWarnings.push({ code: 'existing_family_name_preserved', value: publishTarget.existingFamilyName });
    }
    const missingPublishablePictures = preview?.request.body.filter((item) => !item.pictures.length).length ?? 0;
    if (missingPublishablePictures) remoteErrors.push({ code: 'picture_upload_pending', count: missingPublishablePictures });
    const response = {
      ok: local.valid && remoteErrors.length === 0,
      readOnly: true,
      livePublishAttempted: false,
      local,
      capabilities,
      categoryRequirements,
      missingRequiredAttributes,
      missingGlobalAttributes,
      remoteErrors,
      remoteWarnings,
      preview,
      publishTarget
    };
    for (const site of family.product.targetSites) {
      await app.db.query(`
        INSERT INTO publish_jobs (
          product_id,site,idempotency_key,request_summary,response_summary,http_status,
          error_code,error_message,status,completed_at
        ) VALUES ($1,$2,$3,$4,$5,200,$6,$7,$8,now())
      `, [family.product.id, site, `preflight:${randomUUID()}`,
        { operation: 'read_only_remote_preflight', accountId, variantCount: local.summary.variantCount,
          publishMode: publishTarget.mode, sitelessFamilyId: publishTarget.sitelessFamilyId ?? null },
        { ok: response.ok, errorCount: remoteErrors.length, warningCount: remoteWarnings.length, missingRequiredAttributeCount: missingRequiredAttributes.length,
          missingGlobalAttributeCount: missingGlobalAttributes.length },
        remoteErrors[0]?.code ?? null, remoteErrors.length ? 'Remote preflight requires corrections' : null,
        response.ok ? 'validation_passed' : 'validation_failed']);
    }
    return response;
  });

  app.post('/:productId/upload-pictures', async (request) => {
    if (!app.mercadoLibreOAuth) throw problem('Mercado Libre OAuth is not configured', 'meli_not_configured', 503);
    if (request.body?.confirmation !== 'UPLOAD_PICTURES') {
      throw problem('Explicit UPLOAD_PICTURES confirmation is required', 'picture_upload_confirmation_required');
    }
    const accountId = request.body?.accountId;
    if (!accountId) throw problem('accountId is required', 'validation_error');
    const family = await loadFamily(app.db, request.params.productId);
    const result = await uploadRequiredPictures(app, accountId, family);
    return { ok: true, liveListingCreated: false, ...result };
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
    if (!app.mercadoLibreOAuth) throw problem('Mercado Libre OAuth is not configured', 'meli_not_configured', 503);
    const accountId = request.body?.accountId;
    const requestKey = String(request.body?.requestKey ?? '').trim();
    if (!accountId || requestKey.length < 16 || requestKey.length > 120) {
      throw problem('accountId and a 16-120 character requestKey are required', 'validation_error');
    }
    const loaded = await loadFamily(app.db, request.params.productId);
    const family = scopeFamilyToSites(loaded, requestedSites(request, loaded));
    const isUpdateMode = resolveWorkflowPublishMode(family.product.workflowType, request.body?.publishMode) === 'update';
    const replayKey = `publish:${requestKey}:${family.listings[0]?.site ?? 'MLM'}`;
    // The reconciliation guard prevents republishing a Family that Mercado
    // Libre already accepted but whose result we could not fully confirm (a
    // re-POST could create a duplicate Family). It is only meaningful for
    // create mode: an update (PUT) targets an explicit, already-existing
    // Siteless Family and is idempotent, so it must not be blocked by an
    // outstanding un-reconciled create.
    if (!isUpdateMode) {
      const reconciliation = await app.db.query(`
        SELECT id FROM publish_jobs
        WHERE product_id=$1 AND operation='family_publish'
          AND response_summary->>'providerAccepted'='true' AND status<>'published'
        LIMIT 1
      `, [request.params.productId]);
      if (reconciliation.rowCount) {
        throw problem('A previous Mercado Libre request was accepted but its result was not fully reconciled. Do not republish.',
          'publish_reconciliation_required', 409);
      }
    }
    const existing = await app.db.query(`
      SELECT id,response_summary,status,error_code FROM publish_jobs
      WHERE product_id=$1 AND idempotency_key=$2 LIMIT 1
    `, [request.params.productId, replayKey]);
    if (existing.rows[0]?.status === 'published') {
      return { ok: true, idempotentReplay: true, ...existing.rows[0].response_summary };
    }
    if (existing.rowCount && existing.rows[0].error_code !== 'meli_transport_error') {
      throw problem('This publish request key is already in progress or was rejected. Use a new key only after correcting the data.',
        'publish_request_already_claimed', 409);
    }

    // Resolve provider state only after the idempotent replay checks. A
    // temporary read failure must not hide a result that was already recorded.
    const publishTarget = await resolvePublishTarget(app, accountId, request, family);
    const targetedFamily = { ...family, publishTarget };

    const local = appendPreflightErrors(preflightProductFamily(family), await categoryGate(app, family));
    if (!local.valid) throw problem('Product family failed local preflight', 'preflight_failed', 422, local);
    const capabilities = await app.mercadoLibreOAuth.inspectCapabilities(accountId);
    if (!capabilities.globalSelling || !capabilities.userProductSeller) {
      throw problem('Connected account is not enabled for Global Selling UP publication', 'meli_up_capability_missing', 422, capabilities);
    }
    const preview = buildGlobalUpFamilyPreview(targetedFamily);
    if (!preview.summary.globalCategoryId) throw problem('CBT global category is required', 'global_category_missing', 422);
    const requirements = await app.mercadoLibreOAuth.categoryRequirements(accountId, [
      preview.summary.globalCategoryId, ...family.listings.map((listing) => listing.categoryId)
    ].filter(Boolean));
    const missingRequiredAttributes = missingRequiredAttributesFor(family, requirements);
    const missingGlobalAttributes = missingRequiredAttributes.filter((item) => item.categoryId?.startsWith('CBT'));
    const variationIssues = remoteVariationIssues(family, requirements);
    if (!requirements.ok || missingGlobalAttributes.length || variationIssues.length) {
      throw problem('Current Mercado Libre category requirements are not satisfied', 'required_attributes_missing', 422,
        { missingRequiredAttributes: missingGlobalAttributes, variationIssues });
    }
    if (preview.request.body.some((item) => !item.pictures.length)) {
      throw problem('Every selected variant needs at least one Mercado Libre picture ID', 'picture_upload_pending', 422);
    }

    const claimed = existing.rowCount
      ? await app.db.query(`
          UPDATE publish_jobs SET status='publishing',error_code=NULL,error_message=NULL,
            completed_at=NULL,retry_count=retry_count+1
          WHERE id=$1 AND status='failed' AND error_code='meli_transport_error' RETURNING id
        `, [existing.rows[0].id])
      : await app.db.query(`
          INSERT INTO publish_jobs (
            product_id,listing_id,site,idempotency_key,operation,request_summary,status
          ) VALUES ($1,$2,$3,$4,'family_publish',$5,'publishing')
          ON CONFLICT (idempotency_key) DO NOTHING RETURNING id
        `, [family.product.id, family.listings[0].id, family.listings[0].site, replayKey,
          { endpoint: preview.request.endpoint, variantCount: local.summary.variantCount }]);
    if (!claimed.rowCount) {
      throw problem('This publish request key is already in progress or previously failed; inspect the job before retrying', 'publish_request_already_claimed', 409);
    }

    await app.db.query("UPDATE products SET status='publishing' WHERE id=$1", [family.product.id]);
    let response;
    try {
      response = await app.mercadoLibreOAuth.authenticatedRequest(
        accountId,
        preview.request.endpoint,
        { method: preview.request.method, body: preview.request.body, idempotencyKey: requestKey }
      );
    } catch (error) {
      await app.db.query("UPDATE products SET status='publish_failed' WHERE id=$1", [family.product.id]);
      await recordPublishJobs(app, family, requestKey, {
        requestSummary: { endpoint: preview.request.endpoint, variantCount: local.summary.variantCount },
        responseSummary: { ok: false, transportError: true }, httpStatus: null,
        errorCode: 'meli_transport_error', errorMessage: error.message, status: 'failed'
      });
      throw problem('Mercado Libre publication request could not be completed', 'meli_transport_error', 502);
    }
    if (!response.ok) {
      const code = response.payload?.error ?? response.payload?.cause?.[0]?.code ?? `http_${response.status}`;
      const message = response.payload?.message ?? 'Mercado Libre family publication failed';
      await app.db.query("UPDATE products SET status='publish_failed' WHERE id=$1", [family.product.id]);
      await recordPublishJobs(app, family, requestKey, {
        requestSummary: { endpoint: preview.request.endpoint, variantCount: local.summary.variantCount },
        responseSummary: { ok: false, providerCode: code }, httpStatus: response.status,
        errorCode: String(code).slice(0, 200), errorMessage: String(message).slice(0, 1000), status: 'failed'
      });
      throw problem(`Mercado Libre publication returned HTTP ${response.status}`, 'meli_family_publish_failed', 502, { providerCode: code, providerMessage: message });
    }
    const selectedSellerSkus = family.variants
      .filter((variant) => variant.participateInPublish !== false)
      .map((variant) => variant.sellerSku);
    const normalized = normalizeFamilyPublishResult(response.payload, selectedSellerSkus);
    if (!normalized.familyId && publishTarget.mode === 'update') normalized.familyId = publishTarget.sitelessFamilyId;
    if (normalized.providerRejected) {
      const first = normalized.userProducts[0];
      const code = first?.error ?? 'meli_family_validation_failed';
      const partial = normalized.providerPartiallyAccepted === true;
      await app.db.query(`UPDATE products SET status=$2 WHERE id=$1`, [family.product.id,
        partial ? 'reconciliation_required' : 'publish_failed']);
      await recordPublishJobs(app, family, requestKey, {
        requestSummary: { endpoint: preview.request.endpoint, variantCount: local.summary.variantCount },
        responseSummary: { ok: false, providerRejected: true, providerAccepted: partial, partialAcceptance: partial, providerCode: code },
        httpStatus: response.status, errorCode: String(code).slice(0, 200),
        errorMessage: JSON.stringify(normalized.userProducts.map((u) => u.raw)).slice(0, 1500),
        status: partial ? 'reconciliation_required' : 'failed'
      });
      throw problem(partial
        ? 'Mercado Libre accepted part of the Family and rejected part of it. Do not republish until reconciled.'
        : 'Mercado Libre rejected the Family during batch validation',
      partial ? 'meli_family_partial_acceptance' : 'meli_family_validation_rejected', partial ? 409 : 422,
        { providerCode: code, reasons: normalized.userProducts.map((u) => u.raw) });
    }
    let saved;
    try {
      saved = await persistPublishResult(app, family, normalized, response.payload);
      if (!saved.complete) {
        throw problem('Mercado Libre accepted the Family but returned an incomplete identifier mapping. Do not republish.',
          'meli_partial_family_response', 502, saved.issues);
      }
    } catch (error) {
      await app.db.query("UPDATE products SET status='reconciliation_required' WHERE id=$1", [family.product.id]);
      const rawBody = JSON.stringify(response?.payload ?? null);
      await recordPublishJobs(app, family, requestKey, {
        requestSummary: { endpoint: preview.request.endpoint, variantCount: local.summary.variantCount },
        responseSummary: { ok: false, partialResponse: true, providerAccepted: true }, httpStatus: response.status,
        errorCode: error.code ?? 'meli_result_persist_failed', errorMessage: `${error.message}\nPAYLOAD: ${rawBody?.slice(0, 3000)}\n${error.stack ?? ''}`.slice(0, 6000), status: 'reconciliation_required'
      });
      throw error;
    }
    const responseSummary = { ok: true, familyId: saved.familyId, userProducts: saved.userProducts.map((item) => ({ sellerSku: item.sellerSku, userProductId: item.userProductId, sites: item.sites })) };
    await recordPublishJobs(app, family, requestKey, {
      requestSummary: { endpoint: preview.request.endpoint, variantCount: local.summary.variantCount },
      responseSummary, httpStatus: response.status, status: 'published'
    });
    return { ok: true, idempotentReplay: false, ...responseSummary };
  });
}
