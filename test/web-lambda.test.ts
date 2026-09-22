import { describe, expect, it } from 'vitest';
import express from 'express';
import serverless from 'serverless-http';
import { bridge, toEvent } from '../server/lib/web-lambda.ts';

/**
 * The Express app is driven through the same two translations the Netlify
 * function uses, so what is asserted here is what a browser would see.
 */
const app = express();
app.use(express.json());
app.get('/api/echo', (req, res) => {
  res.cookie('first', '1', { httpOnly: true });
  res.cookie('second', '2');
  res.setHeader('x-answer', '42');
  res.json({ query: req.query, header: req.header('x-test') ?? null, method: req.method });
});
app.post('/api/echo', (req, res) => {
  res.status(201).json({ body: req.body, type: req.header('content-type') });
});
app.get('/api/bytes', (_req, res) => {
  res.type('application/octet-stream');
  res.send(Buffer.from([0, 1, 2, 253, 254, 255]));
});
app.get('/api/nothing', (_req, res) => {
  res.status(204).end();
});

const handler = bridge(serverless(app, { binary: true }) as unknown as Parameters<typeof bridge>[0]);
const call = (path: string, init?: RequestInit) =>
  handler(new Request(`https://evia.test${path}`, init), {});

describe('web request to lambda event', () => {
  it('carries method, path, repeated query values and headers', async () => {
    const event = await toEvent(
      new Request('https://evia.test/api/echo?a=1&a=2&b=x', { headers: { 'X-Test': 'yes' } }),
    );
    expect(event.httpMethod).toBe('GET');
    expect(event.path).toBe('/api/echo');
    expect(event.queryStringParameters).toEqual({ a: '2', b: 'x' });
    expect(event.multiValueQueryStringParameters).toEqual({ a: ['1', '2'], b: ['x'] });
    expect(event.headers['x-test']).toBe('yes');
    expect(event.body).toBe('');
    expect(event.isBase64Encoded).toBe(false);
  });

  it('reads the caller address from the platform header', async () => {
    const event = await toEvent(
      new Request('https://evia.test/api/echo', {
        headers: { 'x-nf-client-connection-ip': '203.0.113.9', 'x-forwarded-for': '10.0.0.1, 203.0.113.9' },
      }),
    );
    expect(event.requestContext.identity.sourceIp).toBe('203.0.113.9');
  });
});

describe('express through the bridge', () => {
  it('answers a GET with JSON, custom headers and every cookie', async () => {
    const res = await call('/api/echo?a=1&a=2&b=x', { headers: { 'x-test': 'yes' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('x-answer')).toBe('42');
    expect(res.headers.getSetCookie()).toHaveLength(2);
    expect(res.headers.getSetCookie()[0]).toContain('first=1');
    expect(res.headers.getSetCookie()[1]).toContain('second=2');
    const body = (await res.json()) as { query: unknown; header: string; method: string };
    expect(body.query).toEqual({ a: ['1', '2'], b: 'x' });
    expect(body.header).toBe('yes');
    expect(body.method).toBe('GET');
  });

  it('delivers a JSON body to the route intact', async () => {
    const payload = { text: 'Hello. Let me take a proper look.', nested: { n: 3, ok: true } };
    const res = await call('/api/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { body: unknown; type: string };
    expect(body.body).toEqual(payload);
    expect(body.type).toBe('application/json');
  });

  it('returns binary bodies byte for byte', async () => {
    const res = await call('/api/bytes');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/octet-stream');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([0, 1, 2, 253, 254, 255]);
  });

  it('keeps an empty 204 empty', async () => {
    const res = await call('/api/nothing');
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });

  it('lets Express answer 404 for an unknown route', async () => {
    const res = await call('/api/missing');
    expect(res.status).toBe(404);
  });
});
