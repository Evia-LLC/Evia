import { AGE_FLOW_COPY, ageOnDate, REGISTRATION_TERMS_VERSION } from '../../shared/age-flow.ts';
import { sampleDemoEnabled } from '../ai/perfectcorp.ts';
import { type Request, type Response, type NextFunction } from 'express';
import { asyncRouter } from '../lib/async-router.ts';
import * as users from '../db/users.ts';
import { loginLimiter, registerLimiter } from '../lib/rate-limit.ts';
import { log } from '../lib/log.ts';

export const authRouter = asyncRouter();

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

const COOKIE = 'elohim_session';

function setSessionCookie(res: Response, token: string) {
  /*
   * `Secure` in production only.
   *
   * A Secure cookie is never sent over plain HTTP, so setting it
   * unconditionally would silently break every local development session — the
   * cookie would be issued, dropped by the browser, and the next request would
   * 401 with nothing to show for it. In production the app is behind TLS and
   * the flag is what stops the session token crossing a network in the clear.
   */
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/${secure}`,
  );
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

/** Attaches req.userId or 401s. Every route below /api except auth uses this. */
/*
 * Async now, because looking a session up is a database round trip.
 *
 * Express takes a promise-returning middleware perfectly well — it simply does
 * not await it, which is fine here: every path either calls next() or ends the
 * response itself, and nothing downstream runs until one of those happens.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const token = bearer || readCookie(req, COOKIE);
  const userId = token ? await users.userIdForSession(token) : null;
  if (!userId) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  req.userId = userId;
  next();
}

authRouter.post('/register', registerLimiter, async (req, res) => {
  const { email, password, displayName, dateOfBirth, termsAccepted, termsVersion } = req.body ?? {};
  const age = typeof dateOfBirth === 'string' ? ageOnDate(dateOfBirth) : null;
  if (age === null) { res.status(400).json({ error: 'A valid date of birth is required.' }); return; }
  // Reject before any account/session/event writes; never log blocked attempt data.
  if (age < 16) { res.status(403).json({ error: AGE_FLOW_COPY.under16 }); return; }
  if (age < 18) { res.status(403).json({ error: AGE_FLOW_COPY.guardianHeading, guardianRequired: true }); return; }
  if (termsAccepted !== true || termsVersion !== REGISTRATION_TERMS_VERSION) {
    res.status(400).json({ error: 'The separate Terms checkbox and current wording version are required.' }); return;
  }
  if (!sampleDemoEnabled()) {
    res.status(403).json({ error: 'Registration wording is awaiting approval. Only the sample-data demo is available.' }); return;
  }
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email)) {
    res.status(400).json({ error: 'A valid email is required.' });
    return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }
  try {
    const userId = await users.createUser(email, password, String(displayName ?? '').trim(), { dateOfBirth, ip: req.ip });
    const token = await users.createSession(userId);
    setSessionCookie(res, token);
    log.info('auth', 'registered user', { userId });
    res.json({ token, user: await users.getUserSummary(userId) });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }
  const userId = await users.authenticate(email, password);
  if (!userId) {
    res.status(401).json({ error: 'That email and password did not match.' });
    return;
  }
  const token = await users.createSession(userId);
  setSessionCookie(res, token);
  res.json({ token, user: await users.getUserSummary(userId) });
});

authRouter.post('/logout', async (req, res) => {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const token = bearer || readCookie(req, COOKIE);
  if (token) await users.destroySession(token);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ ok: true });
});
