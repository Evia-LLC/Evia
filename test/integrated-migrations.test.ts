import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const migrationsDir = fileURLToPath(new URL('../server/db/migrations/', import.meta.url));

describe('combined consent, geometry, and progress-photo migrations', () => {
  it('applies every migration in order and links a progress photo to a consent event', async () => {
    const db = new PGlite();
    try {
      for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()) {
        await db.exec(readFileSync(new URL(`../server/db/migrations/${name}`, import.meta.url), 'utf8'));
      }

      const columns = await db.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'skin_scans'",
      );
      expect(columns.rows.map((row) => row.column_name)).not.toContain('landmarks_json');

      await db.exec(`
        INSERT INTO users (id, email, display_name, password_hash, password_salt, created_at)
        VALUES ('u1', 'u1@example.test', 'U1', 'hash', 'salt', '2026-09-23');
        INSERT INTO skin_scans (id, user_id, captured_at, metrics_json, model_version)
        VALUES ('s1', 'u1', '2026-09-23', '{}', 'test');
        INSERT INTO consent_events
          (id, user_id, consent_type, wording_version_id, state, recorded_at, idempotency_key)
        VALUES ('c1', 'u1', 'progress_photos', 'approved-test-v1', 'granted', '2026-09-23', 'k1');
        INSERT INTO progress_photos
          (id, user_id, skin_scan_id, blob_ref, created_at, captured_at, consent_event_id)
        VALUES ('p1', 'u1', 's1', 'encrypted-ref', '2026-09-23', '2026-09-23', 'c1');
      `);
      const photo = await db.query<{ consent_event_id: string }>('SELECT consent_event_id FROM progress_photos WHERE id = $1', ['p1']);
      expect(photo.rows[0].consent_event_id).toBe('c1');
    } finally {
      await db.close();
    }
  }, 60_000);
});
