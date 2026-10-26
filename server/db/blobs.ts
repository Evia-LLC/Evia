import { database, result, encodeBytea, decodeBytea } from '../lib/data-api.ts';

export async function storeEncryptedBlob(ref: string, bytes: Buffer, createdAt: string): Promise<void> {
  await result(database().from('blobs').insert({ ref, data: encodeBytea(bytes), bytes: bytes.length, created_at: createdAt }));
}

export async function readEncryptedBlob(ref: string): Promise<Buffer | null> {
  const found = await result<{ data: string } | null>(database().from('blobs').select('data').eq('ref', ref).maybeSingle());
  return found ? decodeBytea(found.data) : null;
}

export async function deleteEncryptedBlob(ref: string): Promise<void> {
  await result(database().from('blobs').delete().eq('ref', ref));
}
