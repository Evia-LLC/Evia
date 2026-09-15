/**
 * A web `Request` in, a web `Response` out, with an Express app in between.
 *
 * Netlify's current functions runtime hands the handler a standard `Request`
 * and expects a standard `Response`. `serverless-http`, which is how the
 * Express app is driven without a listening socket, speaks a different
 * dialect: the AWS API Gateway event, with `httpMethod`, `path`, header maps
 * and a base64 body, and it answers with `{ statusCode, headers, body }`.
 * Handing it the `Request` directly fails the moment it tries to write
 * `event.body` on an object whose `body` is a getter.
 *
 * So this translates in both directions. The body always travels as base64 -
 * both ways - so bytes come out exactly as they went in, whatever the
 * content type says about them.
 */

/** What `serverless-http` returns for an API Gateway (v1) event. */
export interface LambdaResult {
  statusCode: number;
  headers?: Record<string, string | number | boolean>;
  multiValueHeaders?: Record<string, Array<string | number | boolean>>;
  body?: string;
  isBase64Encoded?: boolean;
}

export type LambdaHandler = (event: unknown, context: unknown) => Promise<LambdaResult>;

/** The subset of an API Gateway v1 event that `serverless-http` reads. */
export interface GatewayEvent {
  httpMethod: string;
  path: string;
  headers: Record<string, string>;
  multiValueHeaders: Record<string, string[]>;
  queryStringParameters: Record<string, string> | null;
  multiValueQueryStringParameters: Record<string, string[]> | null;
  body: string;
  isBase64Encoded: boolean;
  requestContext: { identity: { sourceIp: string } };
}

/** Requests without a body by definition; everything else is read in full. */
const BODYLESS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function toEvent(request: Request): Promise<GatewayEvent> {
  const url = new URL(request.url);

  const headers: Record<string, string> = {};
  const multiValueHeaders: Record<string, string[]> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
    multiValueHeaders[key] = [value];
  });

  const single: Record<string, string> = {};
  const multi: Record<string, string[]> = {};
  url.searchParams.forEach((value, key) => {
    single[key] = value;
    (multi[key] ??= []).push(value);
  });
  const hasQuery = Object.keys(single).length > 0;

  const hasBody = !BODYLESS.has(request.method.toUpperCase());
  const body = hasBody ? Buffer.from(await request.arrayBuffer()).toString('base64') : '';

  // Netlify puts the caller's address in its own header; a proxy chain's
  // first hop is the next best thing. Express reads it as `req.ip`.
  const sourceIp =
    headers['x-nf-client-connection-ip'] ?? headers['x-forwarded-for']?.split(',')[0]?.trim() ?? '';

  return {
    httpMethod: request.method.toUpperCase(),
    path: url.pathname,
    headers,
    multiValueHeaders,
    queryStringParameters: hasQuery ? single : null,
    multiValueQueryStringParameters: hasQuery ? multi : null,
    body,
    isBase64Encoded: hasBody,
    requestContext: { identity: { sourceIp } },
  };
}

/** Headers the platform sets itself from the body it is handed. */
const FRAMING = new Set(['content-length', 'transfer-encoding', 'connection', 'keep-alive']);

export function toResponse(result: LambdaResult): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    if (!FRAMING.has(key.toLowerCase())) headers.set(key, String(value));
  }
  // Multi-valued headers - several Set-Cookie lines above all - replace the
  // single value rather than duplicating it.
  for (const [key, values] of Object.entries(result.multiValueHeaders ?? {})) {
    if (FRAMING.has(key.toLowerCase())) continue;
    headers.delete(key);
    for (const value of values) headers.append(key, String(value));
  }

  const status = result.statusCode;
  const empty = status === 204 || status === 304 || !result.body;
  const body = empty
    ? null
    : result.isBase64Encoded
      ? Buffer.from(result.body!, 'base64')
      : result.body!;
  return new Response(body, { status, headers });
}

/** Wraps a `serverless-http` handler so it can be exported as a Netlify function. */
export function bridge(handler: LambdaHandler) {
  return async (request: Request, context: unknown): Promise<Response> =>
    toResponse(await handler(await toEvent(request), context));
}
