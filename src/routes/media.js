import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

function mediaType(mimeType, filename) {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType === 'application/zip' || extname(filename).toLowerCase() === '.zip') return 'archive';
  return null;
}

export async function mediaRoutes(app) {
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
    const result = await app.db.query(`
      INSERT INTO variant_media (variant_id, media_id, sort_order)
      SELECT v.id, pm.id, $4
      FROM variants v
      JOIN product_media pm ON pm.product_id = v.product_id
      WHERE v.id = $1 AND pm.id = $2 AND v.product_id = $3
      ON CONFLICT (variant_id, media_id) DO UPDATE SET sort_order = EXCLUDED.sort_order
      RETURNING *
    `, [request.params.variantId, request.params.mediaId, request.params.productId, request.body?.sortOrder ?? 0]);
    if (!result.rowCount) return reply.code(404).send({ error: 'variant_or_media_not_found' });
    return result.rows[0];
  });
}
