/**
 * P1-T01 — database connection security.
 *
 * The pool used to set `ssl: { rejectUnauthorized: false }` for every
 * non-loopback URL (remote certificate verification disabled) and took its
 * size from an unvalidated `ELOHIM_DB_POOL`. This proves the replacement:
 * verified TLS by default for remote hosts with an explicit CA option, real
 * TLS semantics against a local server, plaintext only for loopback,
 * hostile URL options rejected loudly, and bounded pool validation with
 * sanitized errors.
 *
 * No live providers, no production `.env`, synthetic credentials only. The
 * unit parts need no database; the one live check uses the loopback database
 * when one is running and skips loudly otherwise.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import pg from 'pg';
import {
  connectionString,
  isLoopbackHostname,
  parsePoolMax,
  resolveCaCert,
  resolvePoolMax,
  resolveSslConfig,
} from '../server/db/index.ts';

// --- environment hygiene ---------------------------------------------------
// Saved once: under `test:local` the pool var is set for the whole file.
const savedPool = process.env.ELOHIM_DB_POOL;
const savedCa = process.env.ELOHIM_DB_CA;

afterEach(() => {
  if (savedPool === undefined) delete process.env.ELOHIM_DB_POOL;
  else process.env.ELOHIM_DB_POOL = savedPool;
  if (savedCa === undefined) delete process.env.ELOHIM_DB_CA;
  else process.env.ELOHIM_DB_CA = savedCa;
});

const REMOTE = 'postgres://app:placeholder@db.internal.example:5432/appdb';

describe('pool size validation', () => {
  it('defaults to 3 when unset', () => {
    delete process.env.ELOHIM_DB_POOL;
    expect(parsePoolMax(undefined)).toBe(3);
    expect(resolvePoolMax()).toBe(3);
  });

  it.each(['1', '3', '4', '10', '50'])('accepts %s', (value) => {
    // 1 and 4 are the disposable-lane sizes (test:local, test:pg) —
    // the bound must keep those lanes working.
    expect(parsePoolMax(value)).toBe(Number(value));
    process.env.ELOHIM_DB_POOL = value;
    expect(resolvePoolMax()).toBe(Number(value));
  });

  it('trims surrounding whitespace', () => {
    expect(parsePoolMax('  3  ')).toBe(3);
  });

  it.each([
    '0',
    '-1',
    '-100',
    'abc',
    'NaN',
    '',
    '   ',
    '2.5',
    '3.0',
    '+3',
    '3x',
    'Infinity',
  ])('rejects %s, naming the variable', (value) => {
    expect(() => parsePoolMax(value)).toThrow(/ELOHIM_DB_POOL/);
    process.env.ELOHIM_DB_POOL = value;
    expect(() => resolvePoolMax()).toThrow(/ELOHIM_DB_POOL/);
  });

  it('rejects huge sizes', () => {
    expect(() => parsePoolMax('999999')).toThrow(/ELOHIM_DB_POOL/);
    expect(() => parsePoolMax('9'.repeat(40))).toThrow(/ELOHIM_DB_POOL/);
  });

  it('never repeats the value in the error', () => {
    // Distinctive sentinels: if the message echoed its input, these would show it.
    for (const sentinel of ['987654321', 'pooljunk-7x9q', '-424242']) {
      let message = '';
      try {
        parsePoolMax(sentinel);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message, `leak check for ${sentinel}`).toContain('ELOHIM_DB_POOL');
      expect(message, `leak check for ${sentinel}`).not.toContain(sentinel);
    }
  });
});

describe('loopback detection', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'LocalHost',
    '127.0.0.1',
    '127.0.0.2',
    '127.255.0.1',
    '::1',
    '[::1]',
  ])('treats %s as this machine', (host) => {
    expect(isLoopbackHostname(host)).toBe(true);
  });

  it.each([
    'db.internal.example',
    'ep-cool-123.aws-us-east-2.aws.neon.tech',
    'db.supabase.co',
    '10.0.0.1',
    '192.168.1.5',
    '172.16.0.1',
    '0.0.0.0',
    'example.com',
    '',
    '127.0.0.999',
    'localhost.evil.example',
  ])('treats %s as remote', (host) => {
    expect(isLoopbackHostname(host)).toBe(false);
  });

  it('sees through IPv4-mapped IPv6 loopback', () => {
    expect(isLoopbackHostname('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('::ffff:10.0.0.1')).toBe(false);
  });
});

describe('TLS policy', () => {
  it('leaves loopback databases plaintext (PGlite-style URLs)', () => {
    delete process.env.ELOHIM_DB_CA;
    for (const url of [
      'postgres://postgres:postgres@localhost:5434/postgres',
      'postgres://postgres:postgres@127.0.0.1:5433/postgres',
      'postgres://postgres:postgres@[::1]:5432/postgres',
      'postgresql://postgres:postgres@localhost:5432/postgres',
      'postgresql://postgres:postgres@[::1]:5432/postgres',
    ]) {
      expect(resolveSslConfig(url), url).toBeUndefined();
    }
  });

  it('verifies remote hosts by default, against the system roots', () => {
    delete process.env.ELOHIM_DB_CA;
    const ssl = resolveSslConfig(REMOTE);
    expect(ssl).toMatchObject({ rejectUnauthorized: true });
    expect(ssl).not.toHaveProperty('ca');
  });

  it('attaches an explicit CA from inline PEM', () => {
    process.env.ELOHIM_DB_CA =
      '-----BEGIN CERTIFICATE-----\\nfakeca\\n-----END CERTIFICATE-----';
    const ssl = resolveSslConfig(REMOTE) as { ca?: string };
    expect(ssl).toMatchObject({ rejectUnauthorized: true });
    expect(ssl.ca).toContain('-----BEGIN CERTIFICATE-----');
    expect(ssl.ca).not.toContain('\\n');
  });

  it('attaches an explicit CA from a file path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'evia-ca-path-'));
    try {
      const pem =
        '-----BEGIN CERTIFICATE-----\nfileca\n-----END CERTIFICATE-----\n';
      const file = join(dir, 'ca.pem');
      writeFileSync(file, pem);
      process.env.ELOHIM_DB_CA = file;
      expect(resolveCaCert()).toBe(pem.trim());
      const ssl = resolveSslConfig(REMOTE) as { ca?: string };
      expect(ssl.ca).toBe(pem.trim());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a CA setting that is neither a file nor PEM', () => {
    process.env.ELOHIM_DB_CA = 'ca-setting-sentinel-5k2m';
    let message = '';
    try {
      resolveCaCert();
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('ELOHIM_DB_CA');
    expect(message).not.toContain('ca-setting-sentinel-5k2m');
  });

  it('permits the deployed shape: sslmode=require and verify-full still verify', () => {
    delete process.env.ELOHIM_DB_CA;
    for (const url of [
      'postgres://app:placeholder@db.internal.example:5432/appdb?sslmode=require',
      'postgres://app:placeholder@db.internal.example:5432/appdb?sslmode=verify-full',
      'postgres://app:placeholder@db.internal.example:5432/appdb?sslmode=verify-ca',
    ]) {
      expect(resolveSslConfig(url), url).toMatchObject({
        rejectUnauthorized: true,
      });
    }
  });

  it.each([
    'postgres://app:placeholder@db.internal.example:5432/appdb?sslmode=disable',
    'postgres://app:placeholder@db.internal.example:5432/appdb?sslmode=allow',
    'postgres://app:placeholder@db.internal.example:5432/appdb?sslmode=prefer',
    'postgres://app:placeholder@db.internal.example:5432/appdb?SSLMODE=DISABLE',
    'postgres://app:placeholder@db.internal.example:5432/appdb?rejectUnauthorized=false',
    'postgres://app:placeholder@db.internal.example:5432/appdb?rejectUnauthorized=0',
    'postgres://app:placeholder@db.internal.example:5432/appdb?ssl=false',
    'postgres://postgres:postgres@localhost:5434/postgres?sslmode=disable',
  ])('rejects hostile options loudly: %s', (url) => {
    // Hostile params fail even on loopback: a string copied to production
    // must never silently carry its downgrade with it.
    expect(() => resolveSslConfig(url)).toThrow(/verif|sslmode|SSL/i);
  });

  it('never repeats credentials from a hostile URL in the error', () => {
    const url =
      'postgres://app:hunter2-credential-8z4q@db.internal.example:5432/appdb?sslmode=disable';
    let message = '';
    try {
      resolveSslConfig(url);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain('hunter2-credential-8z4q');
  });

  it('rejects non-postgres schemes and malformed strings', () => {
    expect(() =>
      resolveSslConfig('http://db.internal.example:5432/appdb'),
    ).toThrow(/postgres:\/\//);
    expect(() => resolveSslConfig('not a url')).toThrow(/valid URL/);
  });
});

// --- real TLS semantics ----------------------------------------------------
// A CA plus a server certificate are generated with the openssl CLI into a
// temp dir, then a TLS server on 127.0.0.1 is driven with the exact option
// object resolveSslConfig() returns. No internet, no providers.

let opensslAvailable = true;
try {
  execFileSync('openssl', ['version'], { stdio: 'ignore' });
} catch {
  opensslAvailable = false;
}
if (!opensslAvailable) {
  console.warn(
    '[db-connection-security] openssl CLI not found — skipping real-TLS tests (unit parts above still ran).',
  );
}

function openssl(cwd: string, args: string[]): void {
  execFileSync('openssl', args, { cwd, stdio: 'ignore' });
}

function tlsConnectOnce(
  port: number,
  host: string,
  tlsOpts: tls.ConnectionOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, timeout: 5000, ...tlsOpts });
    socket.once('secureConnect', () => {
      socket.destroy();
      resolve();
    });
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.once('error', fail);
    socket.once('timeout', () => fail(new Error('TLS connect timed out')));
  });
}

function tlsOptionsFor(url: string): tls.ConnectionOptions {
  const ssl = resolveSslConfig(url) as tls.ConnectionOptions | undefined;
  expect(ssl, 'remote URLs must resolve TLS options').toBeDefined();
  if (!ssl || typeof ssl !== 'object')
    throw new Error('expected TLS options object');
  return ssl;
}

describe.skipIf(!opensslAvailable)(
  'real TLS semantics (local server, no network)',
  () => {
    it(
      'valid CA succeeds; wrong CA and wrong hostname fail',
      { timeout: 60_000 },
      async () => {
        const dir = mkdtempSync(join(tmpdir(), 'evia-tls-'));
        try {
          openssl(dir, [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-keyout',
            'ca.key',
            '-out',
            'ca.crt',
            '-days',
            '2',
            '-nodes',
            '-subj',
            '/CN=evia-test-ca',
          ]);
          openssl(dir, [
            'req',
            '-x509',
            '-newkey',
            'rsa:2048',
            '-keyout',
            'other-ca.key',
            '-out',
            'other-ca.crt',
            '-days',
            '2',
            '-nodes',
            '-subj',
            '/CN=evia-other-ca',
          ]);
          openssl(dir, [
            'req',
            '-newkey',
            'rsa:2048',
            '-keyout',
            'server.key',
            '-out',
            'server.csr',
            '-nodes',
            '-subj',
            '/CN=localhost',
          ]);
          // Server identity is DNS:localhost only — connecting by IP must fail
          // the hostname check even with the right CA.
          writeFileSync(join(dir, 'ext.cnf'), 'subjectAltName=DNS:localhost\n');
          openssl(dir, [
            'x509',
            '-req',
            '-in',
            'server.csr',
            '-CA',
            'ca.crt',
            '-CAkey',
            'ca.key',
            '-CAcreateserial',
            '-out',
            'server.crt',
            '-days',
            '2',
            '-extfile',
            'ext.cnf',
          ]);

          const caPem = readFileSync(join(dir, 'ca.crt'), 'utf8');
          const otherCaPem = readFileSync(join(dir, 'other-ca.crt'), 'utf8');

          const server = tls.createServer(
            {
              key: readFileSync(join(dir, 'server.key'), 'utf8'),
              cert: readFileSync(join(dir, 'server.crt'), 'utf8'),
            },
            (socket) => {
              socket.end('ok');
            },
          );
          await new Promise<void>((resolve) =>
            server.listen(0, '127.0.0.1', resolve),
          );
          const { port } = server.address() as import('node:net').AddressInfo;
          try {
            // Valid CA + matching hostname: the resolved options verify for real.
            process.env.ELOHIM_DB_CA = caPem;
            await expect(
              tlsConnectOnce(port, 'localhost', tlsOptionsFor(REMOTE)),
            ).resolves.toBeUndefined();

            // Wrong CA: verification fails instead of connecting anyway.
            process.env.ELOHIM_DB_CA = otherCaPem;
            await expect(
              tlsConnectOnce(port, 'localhost', tlsOptionsFor(REMOTE)),
            ).rejects.toThrow();

            // Wrong hostname: the certificate is for DNS:localhost, so
            // connecting by IP fails the identity check with the right CA.
            process.env.ELOHIM_DB_CA = caPem;
            await expect(
              tlsConnectOnce(port, '127.0.0.1', tlsOptionsFor(REMOTE)),
            ).rejects.toThrow();
          } finally {
            await new Promise((resolve) => server.close(resolve));
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    );
  },
);

describe('local database path', () => {
  it(
    'queries a loopback Postgres over plaintext when one is running',
    { timeout: 15_000 },
    async () => {
      const url = connectionString();
      let hostname = '';
      try {
        hostname = new URL(url).hostname;
      } catch {
        hostname = '';
      }
      if (!url || !isLoopbackHostname(hostname)) {
        console.warn(
          '[db-connection-security] No loopback DATABASE_URL — skipping live check (unit parts above still ran).',
        );
        return;
      }
      const client = new pg.Client({
        connectionString: url,
        connectionTimeoutMillis: 3000,
        ssl: resolveSslConfig(url) as never,
      });
      try {
        await client.connect();
      } catch (err) {
        console.warn(
          `[db-connection-security] Loopback database not reachable — skipping live check: ${(err as Error).message}`,
        );
        return;
      }
      try {
        const result = await client.query('SELECT 1 AS one');
        expect(result.rows[0].one).toBe(1);
      } finally {
        await client.end().catch(() => {});
      }
    },
  );
});
