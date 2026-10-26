import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { putBlob, getBlob, shredBlob } from '../../server/lib/crypto.ts';
import { storeEncryptedBlob, readEncryptedBlob } from '../../server/db/blobs.ts';
import { storeVoiceLine, readVoiceLine } from '../../server/db/voice-cache.ts';
import { database, result } from '../helpers/data-api.ts';

afterEach(() => vi.unstubAllEnvs());
describe('real bytea transport', () => {
  it('preserves ciphertext bytes including every possible byte value', async () => {
    const bytes = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), randomBytes(2048)]);
    await storeEncryptedBlob('binary-ref', bytes, new Date().toISOString());
    expect(await readEncryptedBlob('binary-ref')).toEqual(bytes);
    const native = await result<{ data: string }>(database().from('blobs').select('data').eq('ref', 'binary-ref').single());
    expect(native.data).toBe('\\x' + bytes.toString('hex'));
  });
  it('decrypts a maximum-size accepted photo exactly and distinguishes deletion', async () => {
    vi.stubEnv('ELOHIM_BLOB_KEY', 'a'.repeat(64));
    const photo = randomBytes(768_000);
    await putBlob(photo, 'maximum-photo.bin');
    expect(await getBlob('maximum-photo.bin')).toEqual(photo);
    await shredBlob('maximum-photo.bin');
    expect(await getBlob('maximum-photo.bin')).toBeNull();
  });
  it('preserves cached audio exactly and keeps the first writer', async () => {
    const audio = randomBytes(32_768);
    const line = { key: 'audio-key', voiceId: 'voice', modelId: 'model', text: 'stock', audio,
      contentType: 'audio/mpeg', wordsJson: '[]', duration: 1, createdAt: new Date().toISOString() };
    await storeVoiceLine(line);
    await storeVoiceLine({ ...line, audio: randomBytes(12) });
    expect((await readVoiceLine('audio-key'))?.audio).toEqual(audio);
  });
});
