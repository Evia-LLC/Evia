import { randomUUID, randomBytes } from 'node:crypto';

export const newId = (): string => randomUUID();

/** URL-safe opaque session token. */
export const newToken = (): string => randomBytes(32).toString('base64url');

export const nowIso = (): string => new Date().toISOString();
