import { database, result, encodeBytea, decodeBytea } from '../lib/data-api.ts';

export interface CachedVoiceLine {
  audio: Buffer;
  content_type: string;
  words_json: string;
  duration: number;
  created_at: string;
}

export async function readVoiceLine(key: string): Promise<CachedVoiceLine | undefined> {
  const found = await result<(Omit<CachedVoiceLine, 'audio'> & { audio: string }) | null>(
    database().from('voice_lines').select('audio,content_type,words_json,duration,created_at').eq('key', key).maybeSingle(),
  );
  return found ? { ...found, audio: decodeBytea(found.audio) } : undefined;
}

export async function deleteVoiceLine(key: string): Promise<void> {
  await result(database().from('voice_lines').delete().eq('key', key));
}

export async function touchVoiceLine(key: string): Promise<void> {
  await result(database().rpc('evia_touch_voice_line', { p_key: key }));
}

export async function storeVoiceLine(input: { key: string; voiceId: string; modelId: string; text: string;
  audio: Buffer; contentType: string; wordsJson: string; duration: number; createdAt: string }): Promise<void> {
  await result(database().from('voice_lines').upsert({
    key: input.key, voice_id: input.voiceId, model_id: input.modelId, text: input.text,
    audio: encodeBytea(input.audio), content_type: input.contentType, words_json: input.wordsJson,
    duration: input.duration, hits: 0, created_at: input.createdAt,
  }, { onConflict: 'key', ignoreDuplicates: true }));
}

export async function pruneVoiceLines(maxRows: number): Promise<void> {
  await result(database().rpc('evia_prune_voice_lines', { p_max_rows: maxRows }));
}
