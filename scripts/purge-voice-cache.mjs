/** Purge non-stock cache rows; dry run by default. No direct database connection. */
import '../server/lib/env.ts';
import { database, result } from '../server/lib/data-api.ts';
import { dataApiConfigured } from '../server/lib/supabase.ts';
import { stockSentences } from '../server/voice/tts.ts';

if (!dataApiConfigured()) {
  console.error('[purge-voice-cache] Configure the three server-only Supabase variables.');
  process.exit(2);
}
try {
  const report = await result(database().rpc('evia_purge_voice_lines', {
    p_allowlist: stockSentences(), p_apply: process.argv.includes('--apply'),
  }));
  console.log(JSON.stringify(report));
} catch (error) {
  console.error('[purge-voice-cache] failed', { code: error?.code ?? 'transport-error' });
  process.exitCode = 1;
}
