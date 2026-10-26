import { execFileSync, spawn } from 'node:child_process';
import { database, result, verifyDataApi } from '../../server/lib/data-api.ts';

export const integrationLane = process.env.ELOHIM_DATA_API_LANE === '1';

function target() {
  const container = process.env.ELOHIM_TEST_CONTAINER ?? '';
  const runtime = process.env.ELOHIM_TEST_CONTAINER_RUNTIME;
  if (!integrationLane || !/^supabase_db_evia-test-[0-9]+-[a-f0-9]{8}$/.test(container) ||
    (runtime !== 'docker' && runtime !== 'podman')) throw new Error('No owned disposable test stack.');
  return { container, runtime };
}

/** Out-of-band fixture/admin SQL only. Application calls always use the real API. */
export function adminSql(sql: string): string {
  const { container, runtime } = target();
  return execFileSync(runtime, ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-At'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

export function startAdminSql(sql: string) {
  const { container, runtime } = target();
  const child = spawn(runtime, ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Fixture SQL failed.')));
  });
  child.stdin.end(sql);
  return { child, done };
}

export async function waitForSql(predicate: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (adminSql(predicate).trim() === 't') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('The expected database lock state was not observed.');
}

export async function requireDataApi(): Promise<void> {
  if (!integrationLane) throw new Error('Run this suite with npm run test:data-api.');
  target();
  await verifyDataApi();
}

export { database, result };
