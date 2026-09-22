/**
 * Password hashing and at-rest encryption for face images (ARCHITECTURE §10).
 *
 * Face images are the most sensitive thing this product touches, so the blob
 * store refuses to write anything when no key is configured rather than quietly
 * falling back to plaintext. A missing key is a setup error, not a downgrade.
 *
 * The bytes live in the database, not on disk. They used to be files, which
 * works for a process on a laptop and not for a function whose filesystem is
 * rebuilt per request: a kept photo survived until the next deploy and then
 * quietly 404ed. Rows survive deploys. The ciphertext is what gets stored, so
 * the database never holds a face in the clear either.
 */
import {
  scryptSync,
  randomBytes,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { row, run } from '../db/index.ts';
import { log } from './log.ts';

// --- passwords --------------------------------------------------------------

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// --- encrypted blob store ---------------------------------------------------

function blobKey(): Buffer | null {
  const hex = process.env.EVIA_BLOB_KEY;
  if (!hex) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    log.error('crypto', 'EVIA_BLOB_KEY must be 64 hex characters (32 bytes); ignoring it');
    return null;
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Whether this deployment can keep an image at all.
 *
 * One condition now: a key. The database is where the bytes go, and a
 * deployment without a database cannot store the scan the image belongs to
 * either, so there is no separate "nowhere to put it" state to report.
 */
export function blobStorageAvailable(): boolean {
  return blobKey() !== null;
}

export class BlobStorageUnavailable extends Error {
  constructor() {
    super('Image storage is not configured (EVIA_BLOB_KEY unset), so nothing was written.');
    this.name = 'BlobStorageUnavailable';
  }
}

/** Encrypts and stores `data`, returning its opaque ref. */
export async function putBlob(data: Buffer, ref: string): Promise<string> {
  const key = blobKey();
  if (!key) throw new BlobStorageUnavailable();

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  // [12-byte IV][16-byte tag][ciphertext]
  const sealed = Buffer.concat([iv, tag, body]);
  await run(
    'INSERT INTO blobs (ref, data, bytes, created_at) VALUES (?, ?, ?, ?)',
    safeRef(ref),
    sealed,
    sealed.length,
    new Date().toISOString(),
  );
  return ref;
}

export async function getBlob(ref: string): Promise<Buffer | null> {
  const key = blobKey();
  if (!key) return null;
  const found = await row<{ data: Buffer }>('SELECT data FROM blobs WHERE ref = ?', safeRef(ref));
  if (!found) return null;

  const raw = Buffer.isBuffer(found.data) ? found.data : Buffer.from(found.data);
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    log.error('crypto', 'blob failed authentication', { ref: '[redacted]' });
    return null;
  }
}

/**
 * Removes a blob for good.
 *
 * The on-disk version overwrote the file before unlinking so the bytes did not
 * linger in free space. A database row is deleted outright: what was stored
 * was ciphertext under a key that never touches the database, so a page that
 * has not yet been vacuumed holds nothing readable.
 */
export async function shredBlob(ref: string): Promise<void> {
  await run('DELETE FROM blobs WHERE ref = ?', safeRef(ref));
}

/** Refs are generated ids; reject anything that is not one. */
function safeRef(ref: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(ref)) throw new Error('invalid blob ref');
  return ref;
}
