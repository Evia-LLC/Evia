/**
 * What survives between one scan and the next.
 *
 * A body reading is only a measurement if it can be compared with a later one —
 * "track a belly" is a claim about two numbers a month apart, not one number
 * today. Everything here is about the round trip: what goes into the table
 * comes back out unchanged, an absent abdominal reading stays absent rather
 * than becoming a zero, and the previous scan is findable.
 *
 * Runs against whatever NETLIFY_DATABASE_URL names, inside a schema it creates
 * and drops, so a test run can never touch real rows.
 *
 * Skipped — loudly — when nothing is configured. A database test that quietly
 * passes with no database is worse than one that never ran: this file is the
 * only thing standing between a schema change and a silently broken account,
 * so it has to be obvious when it checked nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BodyAnalysisRecord } from '../shared/types.ts';

type Repo = typeof import('../server/db/body-scans.ts');
type Users = typeof import('../server/db/users.ts');

const BASE_URL = process.env.NETLIFY_DATABASE_URL ?? '';
const configured = BASE_URL.length > 0;

/** Its own schema, named for this run. */
const SCHEMA = `elohim_test_${process.pid}_${Date.now()}`;

let repo: Repo;
let userId: string;

const METRICS = {
  shoulderHipRatio: 70,
  waistRatio: 64,
  shoulderTilt: 88,
  hipTilt: 86,
  headForward: 84,
  postureAlignment: 87,
};

/** Unique per run, so a repeated run never trips over its own leftovers. */
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function reading(over: Partial<BodyAnalysisRecord> = {}): BodyAnalysisRecord {
  return {
    capturedAt: new Date().toISOString(),
    metrics: { ...METRICS },
    waistSource: 'silhouette',
    profile: { abdominalProfile: 42 },
    profileDetail: { depthRatio: 1.05, chestDepth: 0.22, bellyDepth: 0.231 },
    landmarks: Array.from({ length: 33 }, (_, i) => ({
      x: i / 33,
      y: 1 - i / 33,
      z: 0,
      visibility: 0.9,
    })),
    confidence: 0.97,
    modelVersion: 'elohim-body-2.0.0',
    profileModelVersion: 'elohim-profile-1.0.0',
    ...over,
  };
}

/** A short-lived connection for the schema itself, outside the app's pool. */
async function admin(sql: string) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: BASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  if (!configured) {
    console.warn('[body-store] NETLIFY_DATABASE_URL is not set — database tests did not run.');
    return;
  }

  await admin(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);

  /*
   * Point the app's pool at that schema before anything imports it.
   *
   * `search_path` travels in the connection string rather than being issued as
   * a statement, because a pool opens connections whenever it likes and a `SET`
   * only applies to the one it was sent on — the second connection would find
   * itself back in `public`, creating half the tables in the wrong place.
   */
  process.env.NETLIFY_DATABASE_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=-csearch_path%3D${SCHEMA}`;

  const { migrate } = await import('../server/db/index.ts');
  await migrate();
  repo = await import('../server/db/body-scans.ts');
  const users: Users = await import('../server/db/users.ts');
  userId = await users.createUser(`body-store-${stamp()}@test.local`, 'pw-not-used', 'Tester');
});

afterAll(async () => {
  if (!configured) return;
  process.env.NETLIFY_DATABASE_URL = BASE_URL;
  await admin(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
});

describe.skipIf(!configured)('a body reading survives the round trip', () => {
  it('comes back exactly as it went in', async () => {
    const stored = await repo.insertBodyScan(userId, reading());
    expect(stored.id).toBeTruthy();

    const back = await repo.latestBodyScan(userId);
    expect(back?.id).toBe(stored.id);
    expect(back?.metrics).toEqual(METRICS);
    expect(back?.profile).toEqual({ abdominalProfile: 42 });
    expect(back?.profileDetail?.depthRatio).toBeCloseTo(1.05, 5);
    expect(back?.waistSource).toBe('silhouette');
    // Five decimal places is why the column is DOUBLE PRECISION: Postgres REAL
    // is float4 and stores 0.97 as 0.9700000286, which fails right here.
    expect(back?.confidence).toBeCloseTo(0.97, 5);
    expect(back?.modelVersion).toBe('elohim-body-2.0.0');
    expect(back?.profileModelVersion).toBe('elohim-profile-1.0.0');
    expect(back?.landmarks).toHaveLength(33);
  });

  it('keeps an absent abdominal reading absent', async () => {
    /*
     * The one that matters most. A front-only scan measured no abdomen, and a
     * null is the only honest record of that — stored as 0 it would come back
     * looking like the deepest possible reading, and next month's scan would be
     * compared against it as though it were a measurement.
     */
    await repo.insertBodyScan(userId, reading({ profile: null, profileDetail: null }));
    const back = await repo.latestBodyScan(userId);
    expect(back?.profile).toBeNull();
    expect(back?.profileDetail).toBeNull();
    expect(back?.profileModelVersion).toBe('elohim-profile-1.0.0');
  });

  it('records which method the waist came from', async () => {
    // Traced and estimated waists are different measurements. If the source did
    // not survive storage, a trend could silently compare one with the other.
    await repo.insertBodyScan(userId, reading({ waistSource: 'joints' }));
    expect((await repo.latestBodyScan(userId))?.waistSource).toBe('joints');
  });
});

describe.skipIf(!configured)('finding the scan to compare against', () => {
  // Its own account, because ordering is the thing under test and the readings
  // stored above carry today's date — which sorts after any fixture date.
  let trendUser: string;
  beforeAll(async () => {
    const users: Users = await import('../server/db/users.ts');
    trendUser = await users.createUser(`body-trend-${stamp()}@test.local`, 'pw-not-used', 'Trend');
  });

  it('returns the one before the newest, not the newest', async () => {
    const older = await repo.insertBodyScan(
      trendUser,
      reading({ capturedAt: '2026-01-01T00:00:00.000Z', profile: { abdominalProfile: 20 } }),
    );
    const newer = await repo.insertBodyScan(
      trendUser,
      reading({ capturedAt: '2026-02-01T00:00:00.000Z', profile: { abdominalProfile: 55 } }),
    );
    expect((await repo.latestBodyScan(trendUser))?.id).toBe(newer.id);
    expect((await repo.previousBodyScan(trendUser))?.id).toBe(older.id);
    // And the comparison a trend actually makes: 20 -> 55 is a real move.
    const latest = await repo.latestBodyScan(trendUser);
    const previous = await repo.previousBodyScan(trendUser);
    expect(latest!.profile!.abdominalProfile - previous!.profile!.abdominalProfile).toBe(35);
  });

  it('has no previous scan on a first reading', async () => {
    expect(await repo.previousBodyScan('nobody-with-this-id')).toBeNull();
    expect(await repo.latestBodyScan('nobody-with-this-id')).toBeNull();
  });

  it('never returns readings belonging to another account', async () => {
    expect((await repo.listBodyScans('someone-else')).length).toBe(0);
  });
});

describe.skipIf(!configured)('deleting an account takes the pictures with it', () => {
  it('lists every blob this user owns here', async () => {
    const before = (await repo.allBodyBlobRefs(userId)).length;
    await repo.insertBodyScan(userId, reading(), {
      imageRef: 'front-blob-ref',
      profileImageRef: 'side-blob-ref',
    });
    const refs = await repo.allBodyBlobRefs(userId);
    expect(refs.length).toBe(before + 2);
    expect(refs).toContain('front-blob-ref');
    expect(refs).toContain('side-blob-ref');
  });

  it('reports which frames were actually kept', async () => {
    const stored = await repo.insertBodyScan(userId, reading(), { imageRef: 'only-the-front' });
    expect(stored.hasImage).toBe(true);
    expect(stored.hasProfileImage).toBe(false);
  });
});
