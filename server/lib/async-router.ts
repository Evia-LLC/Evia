/**
 * A Router whose handlers may be `async` without taking the process down.
 *
 * Express 4 calls a handler and discards its return value — `router/layer.js`
 * wraps the call in try/catch, which catches a synchronous `throw` and nothing
 * else. So a rejected promise from an `async` handler never reaches the error
 * middleware: the response is never sent, the request hangs until the client or
 * the platform gives up, and Node 24's default unhandled-rejection policy then
 * kills the process.
 *
 * That matters here more than it would elsewhere. `requireAuth` is async and
 * runs *before* authentication, so any request carrying any cookie causes a
 * database round trip; the pool is `max: 3`; and a function instance that dies
 * takes every in-flight request with it. One malformed request was enough.
 *
 * Rather than remembering to wrap ~30 handlers by hand — which fails the first
 * time someone adds the thirty-first — this wraps the registration methods, so
 * every handler passed to the router is adapted on the way in.
 *
 * Express 5 awaits handlers natively and makes this file unnecessary; it is
 * kept small and self-contained so it can be deleted wholesale on that upgrade.
 */
import { Router, type ErrorRequestHandler, type RequestHandler } from 'express';

type AnyHandler = RequestHandler | ErrorRequestHandler;

/**
 * Arity is load-bearing: Express identifies error middleware by `fn.length === 4`,
 * so the wrapper has to declare the same number of parameters as the function it
 * replaces or a 4-arg error handler silently becomes a normal handler.
 */
function wrap(fn: AnyHandler): AnyHandler {
  if (fn.length >= 4) {
    const handler = fn as ErrorRequestHandler;
    const wrapped: ErrorRequestHandler = (err, req, res, next) => {
      Promise.resolve(handler(err, req, res, next)).catch(next);
    };
    return wrapped;
  }

  const handler = fn as RequestHandler;
  const wrapped: RequestHandler = (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
  return wrapped;
}

const METHODS = ['use', 'all', 'get', 'post', 'put', 'patch', 'delete'] as const;

export function asyncRouter(): Router {
  const router = Router();

  for (const method of METHODS) {
    const original = router[method].bind(router) as (...args: unknown[]) => unknown;
    // A path string, an array of handlers, or a handler can each appear here;
    // only functions are adapted, everything else is forwarded untouched.
    (router as unknown as Record<string, unknown>)[method] = (...args: unknown[]): unknown =>
      original(
        ...args.map((arg) => {
          if (typeof arg === 'function') return wrap(arg as AnyHandler);
          if (Array.isArray(arg)) {
            return arg.map((entry) =>
              typeof entry === 'function' ? wrap(entry as AnyHandler) : entry,
            );
          }
          return arg;
        }),
      );
  }

  return router;
}
