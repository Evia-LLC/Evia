import type { Request, Response } from 'express';
import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { createRequestClient, resolveSupabaseConfig, SupabaseConfigError } from './supabase.ts';
import { database, result } from './data-api.ts';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGING_ORIGINS = ['https://evia-git-staging-personal-358f.vercel.app', 'https://evia-frontend-experiment.vercel.app'];
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const values = (env.EVIA_AUTH_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean);
  if (env.APP_ENV !== 'production') values.push(...STAGING_ORIGINS);
  if (env.VERCEL_URL) values.push('https://' + env.VERCEL_URL);
  if (env.VERCEL_BRANCH_URL) values.push('https://' + env.VERCEL_BRANCH_URL);
  if (env.NODE_ENV !== 'production' && !env.VERCEL) values.push('http://localhost:5195', 'http://127.0.0.1:5195');
  return new Set(values.filter(value => { try { const u = new URL(value); return u.origin === value && (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost','127.0.0.1'].includes(u.hostname))); } catch { return false; } }));
}
export function authOrigin(req: Request): string {
  const host = req.get('host') ?? '';
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
  const candidate = (local ? 'http://' : 'https://') + host;
  if (local || allowedOrigins().has(candidate)) return candidate;
  throw Object.assign(new Error('Auth origin is not configured.'), { status: 503 });
}
export function privateResponse(res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}
export function createAuthClient(req: Request, res: Response) {
  const config = resolveSupabaseConfig();
  if (!config.url || !config.anonKey) throw new SupabaseConfigError('Supabase Auth is not configured.');
  const jar = new Map(parseCookieHeader(req.headers.cookie ?? '').map(c => [c.name, c.value ?? '']));
  privateResponse(res);
  return createServerClient(config.url, config.anonKey, {
    auth: { flowType: 'pkce' },
    cookieOptions: { path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL), sameSite: 'lax', maxAge: 30 * 86400 },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies, headers) => {
        for (const { name, value, options } of cookies) {
          jar.set(name, value);
          res.append('Set-Cookie', serializeCookieHeader(name, value, { ...options, path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL) }));
        }
        req.headers.cookie = [...jar].map(([name,value]) => name + '=' + encodeURIComponent(value)).join('; ');
        for (const [name,value] of Object.entries(headers ?? {})) res.setHeader(name, value);
        privateResponse(res);
      },
    },
  });
}
export function clearAuthCookies(req: Request, res: Response): void {
  const host = resolveSupabaseConfig().url;
  const ref = host ? new URL(host).hostname.split('.')[0] : '';
  const prefix = 'sb-' + ref + '-auth-token';
  const names = new Set(['evia_access','evia_refresh','elohim_session','evia_recovery']);
  for (const {name} of parseCookieHeader(req.headers.cookie ?? '')) if (name === prefix || name.startsWith(prefix + '.') || name.startsWith(prefix + '-')) names.add(name);
  for (const name of names) res.append('Set-Cookie', serializeCookieHeader(name, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL) }));
  privateResponse(res);
}
export function sessionIdFromVerifiedToken(token: string): string | null {
  try { const id: unknown = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).session_id; return typeof id === 'string' && UUID.test(id) ? id : null; } catch { return null; }
}
export async function verifiedIdentity(req: Request, res: Response): Promise<{userId: string; sessionId: string; accessToken: string} | null> {
  const header = req.headers.authorization;
  if (header && !/^Bearer\s+\S+$/i.test(header)) return null;
  const bearer = header?.replace(/^Bearer\s+/i, '');
  const client = bearer ? createRequestClient(process.env, bearer) : createAuthClient(req, res);
  const {data, error} = await client.auth.getUser(bearer);
  if (error) {
    if ((error.status ?? 0) >= 500 || error.name === 'AuthRetryableFetchError') throw Object.assign(new Error('Auth temporarily unavailable.'), {status:503});
    return null;
  }
  if (!data.user || data.user.is_anonymous || !data.user.email_confirmed_at || !UUID.test(data.user.id)) return null;
  const accessToken = bearer ?? (await client.auth.getSession()).data.session?.access_token;
  if (!accessToken) return null;
  const sessionId = sessionIdFromVerifiedToken(accessToken);
  if (!sessionId) return null;
  const active = await result<boolean>(database().rpc('evia_auth_session_active', { p_user_id: data.user.id, p_session_id: sessionId }));
  return active ? {userId:data.user.id, sessionId, accessToken} : null;
}
export async function authSettings(): Promise<{registrationEnabled:boolean; emailConfirmationRequired:boolean}> {
  const c=resolveSupabaseConfig();
  if (!c.url || !c.anonKey) return {registrationEnabled:false,emailConfirmationRequired:true};
  const response=await fetch(c.url + '/auth/v1/settings',{headers:{apikey:c.anonKey},signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw Object.assign(new Error('Auth settings unavailable.'),{status:503});
  const settings=await response.json() as {disable_signup?:boolean; mailer_autoconfirm?:boolean; external?:{email?:boolean}};
  return {registrationEnabled:settings.external?.email === true && settings.disable_signup === false && settings.mailer_autoconfirm === false, emailConfirmationRequired:settings.mailer_autoconfirm === false};
}
