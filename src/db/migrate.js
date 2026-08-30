import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import { createPool } from './pool.js';

const here = dirname(fileURLToPath(import.meta.url));
const sql = await readFile(join(here, '../../migrations/001_initial.sql'), 'utf8');
const pool = createPool(loadConfig());

try {
  await pool.query(sql);
  console.log('Database migration 001_initial completed.');
} finally {
  await pool.end();
}
