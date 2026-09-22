/**
 * Evia API server — the long-running one.
 *
 * The app and its startup work live in `app.ts`, because the same routes also
 * run as a Netlify Function where there is no process to start and no port to
 * bind. This file is only the part that is true of a server: do the startup
 * work once, then listen.
 */
import './lib/env.ts';

import { app, ready } from './app.ts';
import { modelAvailable } from './ai/claude.ts';
import { sweepExpiredSessions } from './db/users.ts';
import { log } from './lib/log.ts';

const PORT = Number(process.env.EVIA_PORT ?? 5196);

await ready();

// Worth doing on a schedule here, where the process outlives the request. On a
// function it happens once per cold start and that is as often as it can.
setInterval(() => {
  void sweepExpiredSessions();
}, 6 * 60 * 60_000).unref();

app.listen(PORT, '127.0.0.1', () => {
  log.info('server', `Evia API on http://127.0.0.1:${PORT}`);
  if (!modelAvailable()) {
    log.warn(
      'server',
      'ANTHROPIC_API_KEY is not set — conversation runs the local Demo Evia engine. ' +
        'Scans, storage and trends are fully real either way.',
    );
  }
});
