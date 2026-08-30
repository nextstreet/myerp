import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { withTransaction } from '../db/pool.js';

function mediaType(mimeType, filename) {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType === 'application/zip' || extname(filename).toLowerCase() === '.zip') return 'archive';
  return null;
}

export async function mediaRoutes(app) {
  app.get('/:productId/media', async (request, reply) => {
    const result = await app.db.query(
      'SELECT * FROM product_media WHERE product_id=$1 ORDER BY sort_order,created_at',
      [request.params.productId]
    );
    if (!result.rowCount) {
      const product = await app.db.query('SELECT 1 FROM products WHERE id=$1', [request.params.productId]);
      if (!product.rowCount) return reply.code(404).send({ error: 'product_not_found' });
    }
    return { media: result.rows };
  });

  app.post('/:productId/media/external', async (request, reply) => {
    let externalUrl;
    try {
      externalUrl = new URL(request.body?.url);
      if (externalUrl.protocol !== 'https:') throw new Error();
    } catch {
      return reply.code(400).send({ error: 'valid_https_url_required' });
    }
    const mediaId = randomUUID();
    const result = await app.db.query(`
      INSERT INTO product_media (
        id,product_id,media_type,role,storage_key,original_filename,mime_type,
        byte_size,sort_order,prompt,external_url,alt_text
      ) SELECT $1,$2,'image',$3,$4,$5,$6,0,$7,$8,$9,$10
        WHERE EXISTS (SELECT 1 FROM products WHERE id=$2)
      RETURNING *
    `, [mediaId, request.params.productId, request.body?.role ?? 'generated', `external:${mediaId}`,
      request.body?.filename ?? `${mediaId}.jpg`, request.body?.mimeType ?? 'image/jpeg',
      request.body?.sortOrder ?? 0, request.body?.prompt ?? null, externalUrl.toString(), request.body?.altText ?? null]);
    if (!result.rowCount) return reply.code(404).send({ error: 'product_not_found' });
    reply.code(201);
    return result.rows[0];
  });

  app.post('/:productId/media', async (request, reply) => {
    const product = await app.db.query('SELECT id FROM products WHERE id = $1', [request.params.productId]);
    if (!product.rowCount) return reply.code(404).send({ error: 'product_not_found' });

    const part = await request.file();
    if (!part) return reply.code(400).send({ error: 'file_required' });
    const type = mediaType(part.mimetype, part.filename);
    if (!type) return reply.code(415).send({ error: 'unsupported_media_type' });

    const extension = extname(part.filename).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const mediaId = randomUUID();
    const relativeKey = join(request.params.productId, `${mediaId}${extension}`);
    const root = resolve(app.config.storage.localRoot);
    const target = resolve(root, relativeKey);
    if (!target.startsWith(`${root}/`)) throw new Error('Invalid storage path');
    await mkdir(resolve(root, request.params.productId), { recursive: true });

    try {
      await pipeline(part.file, createWriteStream(target, { flags: 'wx' }));
      if (part.file.truncated) {
        const error = new Error('Uploaded file exceeds configured limit');
        error.statusCode = 413;
        error.code = 'file_too_large';
        throw error;
      }
      const info = await stat(target);
      const maxBytes = type === 'image' ? app.config.storage.maxImageBytes : app.config.storage.maxVideoBytes;
      if (info.size > maxBytes) {
        const error = new Error('Uploaded file exceeds configured limit');
        error.statusCode = 413;
        error.code = 'file_too_large';
        throw error;
      }
      const result = await app.db.query(`
        INSERT INTO product_media (
          id, product_id, media_type, role, storage_key, original_filename, mime_type, byte_size
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
      `, [
        mediaId, request.params.productId, type, part.fields?.role?.value ?? 'original',
        relativeKey, part.filename, part.mimetype, info.size
      ]);
      reply.code(201);
      return result.rows[0];
    } catch (error) {
      await unlink(target).catch(() => {});
      throw error;
    }
  });

  app.post('/:productId/variants/:variantId/media/:mediaId', async (request, reply) => {
    const isPrimary = request.body?.isPrimary === true;
    const result = await withTransaction(app.db, async (client) => {
      const valid = await client.query(`
        SELECT 1 FROM variants v JOIN product_media pm ON pm.product_id=v.product_id
        WHERE v.id=$1 AND pm.id=$2 AND v.product_id=$3 AND pm.media_type='image'
      `, [request.params.variantId, request.params.mediaId, request.params.productId]);
      if (!valid.rowCount) return { rowCount: 0, rows: [] };
      if (isPrimary) await client.query('UPDATE variant_media SET is_primary=false WHERE variant_id=$1', [request.params.variantId]);
      return client.query(`
        INSERT INTO variant_media (variant_id, media_id, sort_order, is_primary)
        SELECT v.id, pm.id, $4, $5
        FROM variants v
        JOIN product_media pm ON pm.product_id = v.product_id
        WHERE v.id = $1 AND pm.id = $2 AND v.product_id = $3 AND pm.media_type='image'
        ON CONFLICT (variant_id, media_id) DO UPDATE SET
          sort_order = EXCLUDED.sort_order,is_primary=EXCLUDED.is_primary
        RETURNING *
      `, [request.params.variantId, request.params.mediaId, request.params.productId,
        request.body?.sortOrder ?? 0, isPrimary]);
    });
    if (!result.rowCount) return reply.code(404).send({ error: 'variant_or_media_not_found' });
    return result.rows[0];
  });

  app.patch('/:productId/media/:mediaId', async (request, reply) => {
    const allowedStatuses = new Set(['pending', 'ready', 'rejected']);
    if (request.body?.validationStatus && !allowedStatuses.has(request.body.validationStatus)) {
      return reply.code(400).send({ error: 'unsupported_validation_status' });
    }
    const result = await app.db.query(`
      UPDATE product_media SET
        role=COALESCE($3,role), sort_order=COALESCE($4,sort_order),
        prompt=CASE WHEN $5::boolean THEN $6 ELSE prompt END,
        alt_text=CASE WHEN $7::boolean THEN $8 ELSE alt_text END,
        mercado_picture_id=CASE WHEN $9::boolean THEN $10 ELSE mercado_picture_id END,
        validation_status=COALESCE($11,validation_status)
      WHERE id=$1 AND product_id=$2 RETURNING *
    `, [request.params.mediaId, request.params.productId, request.body?.role ?? null,
      request.body?.sortOrder ?? null, Object.hasOwn(request.body ?? {}, 'prompt'), request.body?.prompt ?? null,
      Object.hasOwn(request.body ?? {}, 'altText'), request.body?.altText ?? null,
      Object.hasOwn(request.body ?? {}, 'mercadoPictureId'), request.body?.mercadoPictureId ?? null,
      request.body?.validationStatus ?? null]);
    if (!result.rowCount) return reply.code(404).send({ error: 'media_not_found' });
    return result.rows[0];
  });

  app.get('/:productId/media/:mediaId/content', async (request, reply) => {
    const result = await app.db.query(`
      SELECT storage_key,mime_type,external_url FROM product_media
      WHERE id=$1 AND product_id=$2
    `, [request.params.mediaId, request.params.productId]);
    if (!result.rowCount) return reply.code(404).send({ error: 'media_not_found' });
    const media = result.rows[0];
    if (media.external_url) return reply.redirect(media.external_url);
    const root = resolve(app.config.storage.localRoot);
    const target = resolve(root, media.storage_key);
    if (!target.startsWith(`${root}/`)) throw new Error('Invalid storage path');
    reply.type(media.mime_type).header('cache-control', 'private, max-age=300');
    return reply.send(createReadStream(target));
  });
}
