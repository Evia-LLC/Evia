import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
const init = fs.readFileSync(new URL('../server/db/migrations/001_init.sql', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../server/db/migrations/011_versioned_consents.sql', import.meta.url), 'utf8');
async function base() { const db = new PGlite(); await db.exec(init); return db; }

describe('011 versioned consent migration', () => {
  it('migrates a fresh database', async () => {
    const db = await base(); await db.exec(migration);
    expect((await db.query(`SELECT * FROM consent_events`)).rows).toEqual([]);
  }, 30_000);
  it('converts both legacy rows and preserves known grant time', async () => {
    const db = await base();
    await db.exec(`INSERT INTO users VALUES ('u','u@example.test','U','h','s','2025-01-01');
      INSERT INTO consents VALUES ('u','image_storage',1,'2025-02-03');
      INSERT INTO consents VALUES ('u','cloud_reasoning',0,NULL);`);
    await db.exec(migration);
    const result = await db.query<{consent_type:string;state:string;recorded_at:string;metadata_json:Record<string,string>}>(
      `SELECT consent_type,state,recorded_at,metadata_json FROM consent_events ORDER BY consent_type`);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find(r => r.consent_type === 'image_storage')).toMatchObject({ state: 'granted', recorded_at: '2025-02-03' });
    expect(result.rows.find(r => r.consent_type === 'cloud_reasoning')).toMatchObject({ state: 'withdrawn' });
    expect(result.rows.find(r => r.consent_type === 'cloud_reasoning')?.metadata_json.recordedAtSource).toBe('migration_time');
    expect((await db.query(`SELECT * FROM consents`)).rows).toHaveLength(2);
  }, 30_000);
});
