/**
 * The whole API, as one function.
 *
 * Netlify routes every `/api/*` request here (see netlify.toml) and this hands
 * it to the same Express app the local server runs. One function rather than a
 * file per route on purpose: the routes share middleware, a session lookup and
 * a database pool, and splitting them would mean re-establishing all three on
 * every endpoint — several cold starts where there should be one.
 *
 * `ready()` is awaited per invocation. It is memoised, so on a warm instance it
 * costs nothing; on a cold one it applies migrations and seeds the demo account
 * before the request is served, which is the only moment those can happen when
 * there is no boot sequence to hang them off.
 */
import serverless from 'serverless-http';
import { app, ready } from '../../server/app.ts';
import { modelAvailable } from '../../server/ai/claude.ts';
import { blobStorageAvailable } from '../../server/lib/crypto.ts';
import { bridge, type LambdaHandler } from '../../server/lib/web-lambda.ts';
import { clonedVoiceAvailable, guestVoiceAllowed } from '../../server/voice/tts.ts';

/*
 * The runtime speaks web `Request`/`Response`; `serverless-http` speaks API
 * Gateway events. `bridge` translates (see server/lib/web-lambda.ts). Bodies
 * travel as base64 in both directions so nothing is re-encoded on the way.
 */
const handler = bridge(serverless(app, { binary: true }) as unknown as LambdaHandler);

export default async (request: Request, context: unknown) => {
  try {
    await ready();
  } catch (err) {
    /*
     * No database attached.
     *
     * `ready()` migrates, and migrating needs a connection string. Without one
     * every request — including the health check the entry screen relies on —
     * died with a stack trace, so the site reported itself as offline when the
     * truth was narrower: the static app and everything on-device is fine,
     * and only the parts that store things are missing. Say exactly that -
     * and report the rest truthfully: her voice, the model and image storage
     * are configured by environment, not by the database, so a missing
     * database must not make them look missing too.
     */
    // A database that is configured but unreachable is a different failure
    // from one that was never configured; the health answer says which, with
    // the reason and any connection string in it redacted.
    const configured = Boolean(process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL);
    const reason = (err instanceof Error ? `${err.name}: ${err.message}` : String(err))
      .replace(/postgres(ql)?:\/\/\S+/g, '<url>')
      .slice(0, 200);
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return Response.json({
        ok: false,
        database: false,
        databaseConfigured: configured,
        databaseError: reason,
        modelAvailable: modelAvailable(),
        model: null,
        imageStorage: blobStorageAvailable(),
        clonedVoice: clonedVoiceAvailable(),
        guestVoice: guestVoiceAllowed(),
        demoMode: false,
      });
    }
    return Response.json(
      {
        error: configured
          ? 'The database is configured but could not be reached just now, so nothing can be saved or signed in to.'
          : 'This deployment has no database attached, so nothing can be saved or signed in to.',
      },
      { status: 503 },
    );
  }
  return handler(request, context) as Promise<Response>;
};

export const config = {
  path: '/api/*',
};
