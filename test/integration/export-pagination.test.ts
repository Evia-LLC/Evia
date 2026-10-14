import { describe, expect, it } from 'vitest';
import { createAccount } from '../helpers/two-accounts.ts';
import { database, result } from '../helpers/data-api.ts';
import { consentHistory } from '../../server/db/consents.ts';
import { exportMemories, exportTranscripts } from '../../server/db/chat.ts';
import { exportScans } from '../../server/db/scans.ts';
import { exportBodyScans } from '../../server/db/body-scans.ts';
import { listOwnedProducts, listUsage } from '../../server/db/products.ts';
import { listProgressPhotos } from '../../server/db/progress-photos.ts';
import { listCatalogue } from '../../server/catalogue/store.ts';
import { listPendingReservations } from '../../server/ai/budget.ts';

describe('complete-list contracts exceed the server row ceiling', () => {
  it('returns every row across independent collections and embedded message boundaries', async () => {
    const { userId } = await createAccount('pagination');
    const n = 1001;
    const at = new Date().toISOString();
    const indices = Array.from({ length: n }, (_, i) => String(i).padStart(4, '0'));
    const insert = async (table: string, values: unknown[]) => {
      for (let start = 0; start < values.length; start += 200) {
        // Dynamic table names and fixtures are controlled by this test, never client input.
        await result(database().from(table as 'users').insert(values.slice(start, start + 200) as never));
      }
    };
    await insert('consent_events', indices.map((i) => ({ id: 'c-' + i, user_id: userId, consent_type: 'photos', wording_version_id: 'v1', state: 'granted', recorded_at: at, idempotency_key: i })));
    await insert('memories', indices.map((i) => ({ id: 'm-' + i, user_id: userId, kind: 'preference', key: i, value: 'value', confidence: 0.8, updated_at: at })));
    await insert('skin_scans', indices.map((i) => ({ id: 's-' + i, user_id: userId, captured_at: at, metrics_json: '{}', model_version: 'fixture' })));
    await insert('body_scans', indices.map((i) => ({ id: 'b-' + i, user_id: userId, captured_at: at, metrics_json: '{}', model_version: 'fixture' })));
    await insert('products', indices.map((i) => ({ id: 'p-' + i, owner_id: userId, name: i, created_at: at })));
    await insert('product_usage', indices.map((i) => ({ id: 'u-' + i, user_id: userId, product_id: 'p-' + i, started_at: at })));
    await insert('progress_photos', indices.map((i) => ({ id: 'photo-' + i, user_id: userId, skin_scan_id: 's-' + i, blob_ref: 'ref-' + i, consent_event_id: 'c-' + i, captured_at: at, created_at: at })));
    await insert('catalogue_products', indices.map((i) => ({ id: 'cat-' + i, source: 'manual', name: i, url: 'https://example.test', updated_at: at })));
    await insert('budget_reservations', indices.map((i) => ({ operation_id: 'op-' + i, user_id: userId, day: '2031-01-01', provider: 'fixture', unit: 'tts-chars', estimated_units: 1, created_at: at })));
    await result(database().from('conversations').insert({ id: 'conversation', user_id: userId, started_at: at, last_active_at: at }));
    await insert('messages', indices.map((i) => ({ id: 'msg-' + i, conversation_id: 'conversation', role: 'user', content: i, created_at: at })));
    const lists = await Promise.all([consentHistory(userId), exportMemories(userId), exportScans(userId), exportBodyScans(userId),
      listOwnedProducts(userId), listUsage(userId), listProgressPhotos(userId), listCatalogue(n), listPendingReservations('2031-01-01')]);
    // Full consent export must include the registration evidence in addition to the paginated photo events.
    expect(lists[0]).toHaveLength(n + 1);
    expect((await consentHistory(userId, 'photos'))).toHaveLength(n);
    expect((await consentHistory(userId, 'registration_terms'))).toHaveLength(1);
    for (const list of lists.slice(1)) expect(list).toHaveLength(n);
    expect((await exportTranscripts(userId))[0].messages).toHaveLength(n);
  });
});
