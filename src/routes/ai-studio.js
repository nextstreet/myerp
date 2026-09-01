import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  AI_STUDIO_SITES,
  assertFactObject,
  generationFacts,
  factExtractionPrompt,
  imagePlanPrompt,
  listingCopyPrompt,
  productBaseFacts,
  validateFactExtraction,
  validateImagePlan,
  validateListingDrafts,
  whiteBackgroundPrompt
} from '../domain/ai-studio.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function problem(message, code = 'validation_error', statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function requireRequestKey(value) {
  if (!UUID_PATTERN.test(String(value ?? ''))) throw problem('requestKey must be a UUID');
  return value;
}

function productRow(row, variants) {
  return {
    id: row.id,
    originalTitle: row.original_title,
    categoryHint: row.category_hint,
    purchasePriceCny: Number(row.purchase_price_cny),
    packedWeightG: row.packed_weight_g,
    productDimensions: row.product_dimensions,
    packageDimensions: row.package_dimensions,
    rawAttributes: row.raw_attributes,
    notes: row.notes,
    targetSites: row.target_sites,
    variants: variants.map((variant) => ({
      id: variant.id,
      sellerSku: variant.seller_sku,
      color: variant.color,
      size: variant.size,
      otherAttributes: variant.other_attributes,
      purchasePriceCny: variant.purchase_price_cny === null ? null : Number(variant.purchase_price_cny),
      packedWeightG: variant.packed_weight_g
    }))
  };
}

async function loadProduct(app, productId) {
  const [product, variants] = await Promise.all([
    app.db.query('SELECT * FROM products WHERE id=$1', [productId]),
    app.db.query('SELECT * FROM variants WHERE product_id=$1 ORDER BY created_at', [productId])
  ]);
  if (!product.rowCount) throw problem('Product not found', 'product_not_found', 404);
  return productRow(product.rows[0], variants.rows);
}

async function factSheet(app, productId) {
  const result = await app.db.query('SELECT * FROM product_fact_sheets WHERE product_id=$1', [productId]);
  const row = result.rows[0];
  return row ? {
    manualFacts: row.manual_facts,
    aiSuggestions: row.ai_suggestions,
    confirmedFacts: row.confirmed_facts,
    confidence: row.confidence,
    evidence: row.evidence,
    revision: row.revision,
    updatedAt: row.updated_at
  } : {
    manualFacts: {}, aiSuggestions: {}, confirmedFacts: {}, confidence: {}, evidence: {}, revision: 0, updatedAt: null
  };
}

async function loadSelectedImages(app, productId, ids) {
  if (!Array.isArray(ids)) throw problem('selectedMediaIds must be an array');
  if (ids.length > app.config.ai.maxInputImages) {
    throw problem(`At most ${app.config.ai.maxInputImages} images may be analyzed at once`);
  }
  if (!ids.length) return [];
  if (ids.some((id) => !UUID_PATTERN.test(String(id))) || new Set(ids).size !== ids.length) {
    throw problem('selectedMediaIds must contain unique UUIDs');
  }
  const result = await app.db.query(`
    SELECT id,role,storage_key,original_filename,mime_type,byte_size,external_url
    FROM product_media WHERE product_id=$1 AND id=ANY($2::uuid[]) AND media_type='image'
  `, [productId, ids]);
  if (result.rowCount !== ids.length) throw problem('One or more selected images were not found', 'media_not_found', 404);
  const byId = new Map(result.rows.map((row) => [row.id, row]));
  const root = resolve(app.config.storage.localRoot);
  const images = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row.external_url) throw problem('External images must be uploaded before AI analysis', 'external_media_unsupported', 400);
    if (!SAFE_IMAGE_TYPES.has(row.mime_type)) throw problem(`Unsupported AI image type: ${row.mime_type}`);
    if (Number(row.byte_size) > app.config.ai.maxInputImageBytes) {
      throw problem(`${row.original_filename} exceeds the AI input size limit`, 'ai_input_too_large', 413);
    }
    const target = resolve(root, row.storage_key);
    if (!target.startsWith(`${root}/`)) throw problem('Invalid storage path', 'invalid_storage_path', 500);
    images.push({
      id: row.id,
      role: row.role,
      filename: row.original_filename,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      buffer: await readFile(target)
    });
  }
  return images;
}

async function beginGeneration(app, { productId, listingId = null, type, requestKey, mediaIds = [], inputSummary = {} }) {
  const id = randomUUID();
  const result = await app.db.query(`
    INSERT INTO ai_generations (
      id,product_id,listing_id,generation_type,provider,model,prompt_version,
      input_summary,output,status,request_key,selected_media_ids
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{}','running',$9,$10)
    ON CONFLICT (request_key) WHERE request_key IS NOT NULL DO NOTHING
    RETURNING *
  `, [id, productId, listingId, type, app.aiProvider.name,
    ['marketing_image', 'white_background'].includes(type) ? app.config.ai.imageModel : app.config.ai.model,
    'ai-studio-v1', inputSummary, requestKey, mediaIds]);
  if (result.rowCount) return { id, existing: null };
  const existing = await app.db.query('SELECT * FROM ai_generations WHERE request_key=$1', [requestKey]);
  if (existing.rows[0]?.status === 'completed') return { id: existing.rows[0].id, existing: existing.rows[0].output };
  throw problem('An AI task with this requestKey is already running or failed', 'ai_request_conflict', 409);
}

async function completeGeneration(app, id, output) {
  await app.db.query(`
    UPDATE ai_generations SET output=$2,status='completed',completed_at=now(),error_code=NULL,error_message=NULL
    WHERE id=$1
  `, [id, output]);
}

async function failGeneration(app, id, error) {
  await app.db.query(`
    UPDATE ai_generations SET status='failed',error_code=$2,error_message=$3,completed_at=now()
    WHERE id=$1
  `, [id, error.code ?? 'ai_task_failed', String(error.message ?? 'AI task failed').slice(0, 1000)]).catch(() => {});
}

async function saveGeneratedImage(app, { productId, generationId, role, prompt, sourceMediaIds, image }) {
  if (image.buffer.length > app.config.storage.maxImageBytes) {
    throw problem('Generated image exceeds configured storage limit', 'generated_image_too_large', 413);
  }
  const mediaId = randomUUID();
  const relativeKey = `${productId}/${mediaId}.png`;
  const root = resolve(app.config.storage.localRoot);
  const target = resolve(root, relativeKey);
  if (!target.startsWith(`${root}/`)) throw problem('Invalid storage path', 'invalid_storage_path', 500);
  await mkdir(resolve(root, productId), { recursive: true });
  await writeFile(target, image.buffer, { flag: 'wx' });
  try {
    const result = await app.db.query(`
      INSERT INTO product_media (
        id,product_id,media_type,role,storage_key,original_filename,mime_type,
        byte_size,prompt,validation_status,metadata,source_media_ids,ai_generation_id
      ) VALUES ($1,$2,'image',$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11) RETURNING *
    `, [mediaId, productId, role, relativeKey, `${role}-${mediaId}.png`, image.mimeType,
      image.buffer.length, prompt, { revisedPrompt: image.revisedPrompt }, sourceMediaIds, generationId]);
    return result.rows[0];
  } catch (error) {
    await unlink(target).catch(() => {});
    throw error;
  }
}

async function categoryRequirements(app, productId, accountId) {
  const listings = await app.db.query(
    'SELECT site,category_id FROM listings WHERE product_id=$1 AND category_id IS NOT NULL ORDER BY site',
    [productId]
  );
  const categoryIds = listings.rows.map((row) => row.category_id);
  if (!categoryIds.length) return { ok: true, categories: [], note: 'No confirmed category IDs yet' };
  if (!accountId || !app.mercadoLibreOAuth) {
    return { ok: false, categories: [], note: 'Mercado Libre account was not supplied; attribute metadata omitted' };
  }
  return app.mercadoLibreOAuth.categoryRequirements(accountId, categoryIds);
}

export async function aiStudioRoutes(app) {
  app.get('/products/:productId/workspace', async (request) => {
    const product = await loadProduct(app, request.params.productId);
    const [sheet, generations] = await Promise.all([
      factSheet(app, request.params.productId),
      app.db.query(`
        SELECT id,generation_type,provider,model,output,status,error_code,error_message,selected_media_ids,created_at,completed_at
        FROM ai_generations WHERE product_id=$1 ORDER BY created_at DESC LIMIT 30
      `, [request.params.productId])
    ]);
    return {
      provider: {
        name: app.aiProvider.name,
        configured: app.aiProvider.configured,
        imageGenerationConfigured: app.aiProvider.supportsImages
      },
      factSheet: sheet,
      effectiveFacts: generationFacts({
        baseFacts: productBaseFacts(product),
        manualFacts: sheet.manualFacts,
        confirmedFacts: sheet.confirmedFacts
      }),
      generations: generations.rows
    };
  });

  app.put('/products/:productId/facts', async (request) => {
    await loadProduct(app, request.params.productId);
    const hasManual = Object.hasOwn(request.body ?? {}, 'manualFacts');
    const hasConfirmed = Object.hasOwn(request.body ?? {}, 'confirmedFacts');
    if (!hasManual && !hasConfirmed) throw problem('manualFacts or confirmedFacts is required');
    const manual = hasManual ? assertFactObject(request.body.manualFacts, 'manualFacts') : null;
    const confirmed = hasConfirmed ? assertFactObject(request.body.confirmedFacts, 'confirmedFacts') : null;
    const result = await app.db.query(`
      INSERT INTO product_fact_sheets (product_id,manual_facts,confirmed_facts)
      VALUES ($1,COALESCE($2::jsonb,'{}'::jsonb),COALESCE($3::jsonb,'{}'::jsonb))
      ON CONFLICT (product_id) DO UPDATE SET
        manual_facts=CASE WHEN $4 THEN EXCLUDED.manual_facts ELSE product_fact_sheets.manual_facts END,
        confirmed_facts=CASE WHEN $5 THEN EXCLUDED.confirmed_facts ELSE product_fact_sheets.confirmed_facts END,
        revision=product_fact_sheets.revision+1
      RETURNING *
    `, [request.params.productId, manual, confirmed, hasManual, hasConfirmed]);
    return { ok: true, revision: result.rows[0].revision };
  });

  app.post('/products/:productId/analyze', async (request) => {
    const requestKey = requireRequestKey(request.body?.requestKey);
    const product = await loadProduct(app, request.params.productId);
    const mediaIds = request.body?.selectedMediaIds ?? [];
    const images = await loadSelectedImages(app, request.params.productId, mediaIds);
    const sheet = await factSheet(app, request.params.productId);
    const start = await beginGeneration(app, {
      productId: request.params.productId,
      type: 'fact_extraction', requestKey, mediaIds,
      inputSummary: { imageCount: images.length, includesManualFacts: Object.keys(sheet.manualFacts).length > 0 }
    });
    if (start.existing) return { generationId: start.id, ...start.existing, reused: true };
    await app.db.query("UPDATE products SET status='ai_processing' WHERE id=$1", [request.params.productId]);
    try {
      const prompt = factExtractionPrompt({
        product: generationFacts({ baseFacts: productBaseFacts(product), manualFacts: sheet.manualFacts, confirmedFacts: sheet.confirmedFacts }),
        selectedMedia: images
      });
      const output = validateFactExtraction(await app.aiProvider.generateJson({ ...prompt, images }));
      await app.db.query(`
        INSERT INTO product_fact_sheets (product_id,ai_suggestions,confidence,evidence)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (product_id) DO UPDATE SET
          ai_suggestions=EXCLUDED.ai_suggestions,confidence=EXCLUDED.confidence,
          evidence=EXCLUDED.evidence,revision=product_fact_sheets.revision+1
      `, [request.params.productId, output.suggestions, output.confidence, output.evidence]);
      await completeGeneration(app, start.id, output);
      await app.db.query("UPDATE products SET status='pending_review' WHERE id=$1", [request.params.productId]);
      return { generationId: start.id, ...output };
    } catch (error) {
      await failGeneration(app, start.id, error);
      await app.db.query("UPDATE products SET status='pending_ai' WHERE id=$1", [request.params.productId]).catch(() => {});
      throw error;
    }
  });

  app.post('/products/:productId/listing-drafts', async (request) => {
    const requestKey = requireRequestKey(request.body?.requestKey);
    const selectedSites = request.body?.selectedSites ?? AI_STUDIO_SITES;
    if (!Array.isArray(selectedSites) || !selectedSites.length || selectedSites.some((site) => !AI_STUDIO_SITES.includes(site))) {
      throw problem('selectedSites contains an unsupported site');
    }
    const product = await loadProduct(app, request.params.productId);
    const sheet = await factSheet(app, request.params.productId);
    const requirements = await categoryRequirements(app, request.params.productId, request.body?.accountId);
    const start = await beginGeneration(app, {
      productId: request.params.productId, type: 'listing_copy', requestKey,
      inputSummary: { selectedSites, categoryMetadataIncluded: requirements.categories.length > 0 }
    });
    if (start.existing) return { generationId: start.id, ...start.existing, reused: true };
    try {
      const facts = generationFacts({
        baseFacts: productBaseFacts(product), manualFacts: sheet.manualFacts,
        confirmedFacts: sheet.confirmedFacts
      });
      const output = validateListingDrafts(await app.aiProvider.generateJson({
        ...listingCopyPrompt({ facts, categoryRequirements: requirements, selectedSites })
      }), selectedSites);
      await completeGeneration(app, start.id, output);
      return { generationId: start.id, ...output, categoryRequirements: requirements };
    } catch (error) {
      await failGeneration(app, start.id, error);
      throw error;
    }
  });

  app.post('/products/:productId/image-plan', async (request) => {
    const requestKey = requireRequestKey(request.body?.requestKey);
    const product = await loadProduct(app, request.params.productId);
    const sheet = await factSheet(app, request.params.productId);
    const start = await beginGeneration(app, {
      productId: request.params.productId, type: 'image_plan', requestKey,
      inputSummary: { requestedCount: '7-10' }
    });
    if (start.existing) return { generationId: start.id, ...start.existing, reused: true };
    try {
      const facts = generationFacts({
        baseFacts: productBaseFacts(product), manualFacts: sheet.manualFacts,
        confirmedFacts: sheet.confirmedFacts
      });
      const output = validateImagePlan(await app.aiProvider.generateJson({ ...imagePlanPrompt({ facts }) }));
      await completeGeneration(app, start.id, output);
      return { generationId: start.id, ...output };
    } catch (error) {
      await failGeneration(app, start.id, error);
      throw error;
    }
  });

  app.post('/products/:productId/white-background', async (request) => {
    const requestKey = requireRequestKey(request.body?.requestKey);
    const mediaId = String(request.body?.referenceMediaId ?? '');
    const product = await loadProduct(app, request.params.productId);
    const [reference] = await loadSelectedImages(app, request.params.productId, [mediaId]);
    const sheet = await factSheet(app, request.params.productId);
    const facts = generationFacts({
      baseFacts: productBaseFacts(product), manualFacts: sheet.manualFacts,
      confirmedFacts: sheet.confirmedFacts
    });
    const prompt = whiteBackgroundPrompt(facts);
    const start = await beginGeneration(app, {
      productId: request.params.productId, type: 'white_background', requestKey, mediaIds: [mediaId],
      inputSummary: { referenceMediaId: mediaId }
    });
    if (start.existing) return { generationId: start.id, ...start.existing, reused: true };
    try {
      const image = await app.aiProvider.generateImage({ prompt, referenceImage: reference });
      const media = await saveGeneratedImage(app, {
        productId: request.params.productId, generationId: start.id, role: 'white_background', prompt,
        sourceMediaIds: [mediaId], image
      });
      const output = { mediaId: media.id, role: media.role };
      await completeGeneration(app, start.id, output);
      return { generationId: start.id, ...output };
    } catch (error) {
      await failGeneration(app, start.id, error);
      throw error;
    }
  });

  app.post('/products/:productId/generate-image', async (request) => {
    const requestKey = requireRequestKey(request.body?.requestKey);
    const mediaId = String(request.body?.referenceMediaId ?? '');
    const prompt = String(request.body?.prompt ?? '').trim();
    if (!prompt || prompt.length > 5000) throw problem('prompt must contain between 1 and 5000 characters');
    const role = String(request.body?.role ?? 'generated').trim().slice(0, 80) || 'generated';
    await loadProduct(app, request.params.productId);
    const [reference] = await loadSelectedImages(app, request.params.productId, [mediaId]);
    const fidelityPrompt = [
      prompt,
      'Use the supplied product as the exact visual source of truth.',
      'Do not change geometry, proportions, structural details, material, surface pattern, dimensions or color.',
      'Do not add a logo, watermark, price, discount or unsupported claim.'
    ].join(' ');
    const start = await beginGeneration(app, {
      productId: request.params.productId, type: 'marketing_image', requestKey, mediaIds: [mediaId],
      inputSummary: { referenceMediaId: mediaId, role }
    });
    if (start.existing) return { generationId: start.id, ...start.existing, reused: true };
    try {
      const image = await app.aiProvider.generateImage({ prompt: fidelityPrompt, referenceImage: reference });
      const media = await saveGeneratedImage(app, {
        productId: request.params.productId, generationId: start.id, role, prompt: fidelityPrompt,
        sourceMediaIds: [mediaId], image
      });
      const output = { mediaId: media.id, role: media.role };
      await completeGeneration(app, start.id, output);
      return { generationId: start.id, ...output };
    } catch (error) {
      await failGeneration(app, start.id, error);
      throw error;
    }
  });
}
