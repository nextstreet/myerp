import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

export class TokenCipher {
  constructor(base64Key) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('Token encryption key must decode to exactly 32 bytes');
  }

  encrypt(plaintext, context = 'token') {
    if (!plaintext) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(`${VERSION}:${context}`, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
  }

  decrypt(payload, context = 'token') {
    if (!payload) return null;
    const [version, ivValue, tagValue, encryptedValue, ...extra] = String(payload).split(':');
    if (version !== VERSION || !ivValue || !tagValue || !encryptedValue || extra.length) {
      throw new Error('Unsupported encrypted token format');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivValue, 'base64url'));
    decipher.setAAD(Buffer.from(`${VERSION}:${context}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  }
}
