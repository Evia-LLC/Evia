import { AGE_FLOW_COPY, ageOnDate, REGISTRATION_TERMS_VERSION, REGISTRATION_DOCUMENT_VERSIONS } from '../../shared/age-flow.ts';
import { sampleDemoEnabled } from '../ai/perfectcorp.ts';
import { type Request, type Response, type NextFunction } from 'express';
import { asyncRouter } from '../lib/async-router.ts';
import * as users from '../db/users.ts';
import { recordConsentDecision } from '../db/consents.ts';
import { loginLimiter, registerLimiter } from '../lib/rate-limit.ts';
import { MAX_PASSWORD_BYTES } from '../lib/crypto.ts';
import { createRequestClient } from '../lib/supabase.ts';

export const authRouter = asyncRouter();
declare module 'express-serve-static-core' { interface Request { userId?: string; } }
const ACCESS = 'evia_access';
const REFRESH = 'evia_refresh';
function options() { return 'HttpOnly; SameSite=Strict; Path=/; ' + (process.env.NODE_ENV === 'production' ? 'Secure; ' : ''); }
function cookie(req: Request, key: string): string | null {
  return req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(key + '='))?.slice(key.length + 1) ?? null;
}
function setSession(res: Response, s: { access_token: string; refresh_token: string; expires_in: number }) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', [
    ACCESS + '=' + s.access_token + '; ' + options() + 'Max-Age=' + s.expires_in,
    REFRESH + '=' + s.refresh_token + '; ' + options() + 'Max-Age=2592000',
  ]);
}
function clearSession(res: Response) {
  res.setHeader('Set-Cookie', [ACCESS, REFRESH, 'elohim_session'].map(k => k + '=; ' + options() + 'Max-Age=0'));
}
async function identify(req: Request, res: Response): Promise<string | null> {
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const token = bearer ?? cookie(req, ACCESS);
  if (token) {
    const { data, error } = await createRequestClient().auth.getUser(token);
    if (!error && data.user) return data.user.id;
  }
  if (bearer) return null;
  const refresh = cookie(req, REFRESH);
  if (!refresh) return null;
  const { data, error } = await createRequestClient().auth.refreshSession({ refresh_token: refresh });
  if (error || !data.session || !data.user) { clearSession(res); return null; }
  setSession(res, data.session);
  return data.user.id;
}
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = await identify(req, res);
    if (!id) { res.status(401).json({ error: 'Not signed in.' }); return; }
    req.userId = id;
    next();
  } catch (e) { next(e); }
}

authRouter.post('/register', registerLimiter, async (req, res) => {
  const { email, password, displayName, dateOfBirth, termsAccepted, termsVersion } = req.body ?? {};
  const age = typeof dateOfBirth === 'string' ? ageOnDate(dateOfBirth) : null;
  if (age === null) { res.status(400).json({ error: 'A valid date of birth is required.' }); return; }
  if (age < 16) { res.status(403).json({ error: AGE_FLOW_COPY.under16 }); return; }
  if (age < 18) { res.status(403).json({ error: AGE_FLOW_COPY.guardianHeading, guardianRequired: true }); return; }
  if (termsAccepted !== true || termsVersion !== REGISTRATION_TERMS_VERSION) {
    res.status(400).json({ error: 'The current Terms must be accepted.' }); return;
  }
  if (!sampleDemoEnabled()) { res.status(403).json({ error: 'Registration wording is awaiting approval.' }); return; }
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) ||
    typeof password !== 'string' || password.length < 8 ||
    Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    res.status(400).json({ error: 'Check your email and password (minimum 8 characters).' }); return;
  }
  const { data, error } = await createRequestClient().auth.signUp({
    email: email.trim().toLowerCase(), password,
    options: { data: { display_name: String(displayName ?? '').trim().slice(0, 100), date_of_birth: dateOfBirth } },
  });
  if (error) { res.status(error.status === 429 ? 429 : 400).json({ error: 'Registration could not be completed.' }); return; }
  // Supabase can return an obfuscated existing user on duplicate signup.
  // Never issue app consent evidence unless a real identity was newly created.
  if (data.user?.identities?.length) {
    await recordConsentDecision(data.user.id, 'registration_terms', REGISTRATION_TERMS_VERSION,
      'granted', { idempotencyKey: 'registration:' + data.user.id,
        documentVersions: REGISTRATION_DOCUMENT_VERSIONS, demoOnly: true, wordingStatus: 'placeholder' },
      { actorType: 'account', actorId: data.user.id, source: 'registration', ip: req.ip });
  }
  if (!data.session || !data.user) {
    res.status(202).json({ confirmationRequired: true, user: null, token: '' }); return;
  }
  setSession(res, data.session);
  res.json({ user: await users.getUserSummary(data.user.id), token: '' });
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' ||
      Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    res.status(400).json({ error: 'Invalid credentials.' }); return;
  }
  const { data, error } = await createRequestClient().auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    res.status(401).json({ error: 'Invalid credentials or email not yet confirmed.' }); return;
  }
  setSession(res, data.session);
  res.json({ user: await users.getUserSummary(data.user.id), token: '' });
});

authRouter.post('/logout', async (req, res) => {
  const refresh = cookie(req, REFRESH);
  if (refresh) {
    const client = createRequestClient();
    const { data } = await client.auth.refreshSession({ refresh_token: refresh });
    if (data.session) await client.auth.signOut({ scope: 'local' });
  }
  clearSession(res);
  res.json({ ok: true });
});
