import { AGE_FLOW_COPY, ageOnDate, REGISTRATION_TERMS_VERSION } from '../../shared/age-flow.ts';
import { sampleDemoEnabled } from '../ai/perfectcorp.ts';
import type { Request, Response, NextFunction } from 'express';
import { asyncRouter } from '../lib/async-router.ts';
import { getUserSummary } from '../db/users.ts';
import { prepareRegistration, discardRegistration, tokenHash } from '../db/registration.ts';
import { loginLimiter, registerLimiter } from '../lib/rate-limit.ts';
import { MAX_PASSWORD_BYTES } from '../lib/crypto.ts';
import { createAdminClient } from '../lib/supabase.ts';
import { authOrigin, authSettings, createAuthClient, clearAuthCookies, privateResponse, verifiedIdentity, sessionIdFromVerifiedToken } from '../lib/auth-session.ts';
import { randomBytes } from 'node:crypto';
import { parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { database, result } from '../lib/data-api.ts';

export const authRouter = asyncRouter();
declare module 'express-serve-static-core' { interface Request { userId?: string; authSessionId?: string; authAccessToken?: string; } }
export { clearAuthCookies };
export const sampleRegistrationAllowed = () => sampleDemoEnabled() && process.env.APP_ENV !== 'production';
const validEmail = (value:unknown): value is string => typeof value === 'string' && value.trim().length <= 254 && /^\S+@\S+\.\S+$/.test(value.trim());
function passwordError(password:unknown):string | null {
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters.';
  if (Buffer.byteLength(password,'utf8') > MAX_PASSWORD_BYTES) return `Password must be at most ${MAX_PASSWORD_BYTES} UTF-8 bytes.`;
  return null;
}
export async function requireAuth(req:Request, res:Response, next:NextFunction):Promise<void> {
  try {
    const identity=await verifiedIdentity(req,res);
    if (!identity) { res.status(401).json({error:'Not signed in.'}); return; }
    req.userId=identity.userId; req.authSessionId=identity.sessionId; req.authAccessToken=identity.accessToken;
    privateResponse(res); next();
  } catch(error) { next(error); }
}
authRouter.use((_req,res,next) => { privateResponse(res); next(); });
authRouter.post('/register', registerLimiter, async (req,res) => {
  const {email,password,displayName,dateOfBirth,termsAccepted,termsVersion}=req.body ?? {};
  const age=typeof dateOfBirth==='string' ? ageOnDate(dateOfBirth) : null;
  if (age===null) { res.status(400).json({error:'A valid date of birth is required.'}); return; }
  if (age<16) { res.status(403).json({error:AGE_FLOW_COPY.under16}); return; }
  if (age<18) { res.status(403).json({error:AGE_FLOW_COPY.guardianHeading,guardianRequired:true}); return; }
  if (termsAccepted!==true || termsVersion!==REGISTRATION_TERMS_VERSION) { res.status(400).json({error:'The current Terms must be accepted.'}); return; }
  if (!sampleRegistrationAllowed()) { res.status(403).json({error:'Registration wording is awaiting approval.'}); return; }
  if (!validEmail(email)) { res.status(400).json({error:'A valid email is required.'}); return; }
  const validation=passwordError(password);
  if (validation) { res.status(400).json({error:validation}); return; }
  const settings=await authSettings();
  if (!settings.registrationEnabled) { res.status(503).json({error:'Email-confirmed registration is not configured.'}); return; }
  const origin=authOrigin(req);
  const token=await prepareRegistration({email:email.trim().toLowerCase(),displayName:String(displayName??'').trim().slice(0,100),dateOfBirth,ip:req.ip});
  const client=createAuthClient(req,res);
  try {
    const {data,error}=await client.auth.signUp({email:email.trim().toLowerCase(),password,options:{emailRedirectTo:origin+'/api/auth/callback',data:{evia_registration_token:token}}});
    if (error) { res.status(error.status===429?429:400).json({error:'Registration could not be completed. Please try again.'}); return; }
    if (data.session) {
      // Configuration changed mid-request. Do not silently skip email confirmation.
      await client.auth.signOut({scope:'local'}); clearAuthCookies(req,res);
      res.status(503).json({error:'Email confirmation must be enabled before using registration.'}); return;
    }
    // The same response for an existing or new address avoids account enumeration.
    res.status(202).json({confirmationRequired:true,user:null});
  } finally {
    // The trigger consumes the intent transactionally; this removes failed/duplicate leftovers.
    try { await discardRegistration(token); } catch { /* Expiry and opportunistic bounded cleanup are the backstop. */ }
  }
});
authRouter.post('/login', loginLimiter, async (req,res) => {
  const {email,password}=req.body??{};
  if (!validEmail(email) || typeof password!=='string' || Buffer.byteLength(password,'utf8')>MAX_PASSWORD_BYTES) { res.status(400).json({error:'Invalid credentials.'}); return; }
  const client=createAuthClient(req,res);
  const {data,error}=await client.auth.signInWithPassword({email:email.trim().toLowerCase(),password});
  if (error || !data.session || !data.user?.email_confirmed_at || data.user.is_anonymous) {
    clearAuthCookies(req,res);
    res.status(error?.status===429?429:401).json({error:'Invalid credentials or email not yet confirmed.'}); return;
  }
  const sessionId=sessionIdFromVerifiedToken(data.session.access_token);
  const active=sessionId && await result<boolean>(database().rpc('evia_auth_session_active',{p_user_id:data.user.id,p_session_id:sessionId}));
  const user=active ? await getUserSummary(data.user.id) : null;
  if (!user) { await client.auth.signOut({scope:'local'}); clearAuthCookies(req,res); res.status(403).json({error:'This account has not completed registration.'}); return; }
  res.json({user});
});
authRouter.get('/callback', async (req,res) => {
  const code=typeof req.query.code==='string' ? req.query.code : '';
  const flowId=typeof req.query.sb_flow_id==='string' ? req.query.sb_flow_id : undefined;
  const client=createAuthClient(req,res);
  if (!code || code.length>2048) { res.redirect(303,'/?auth=link-invalid'); return; }
  const {data,error}=await client.auth.exchangeCodeForSession(code, flowId ? {flowId}:undefined);
  if (error || !data.session || !data.user?.email_confirmed_at) { res.redirect(303,'/?auth=link-invalid'); return; }
  const sid=sessionIdFromVerifiedToken(data.session.access_token);
  if (!sid || !await result<boolean>(database().rpc('evia_auth_session_active',{p_user_id:data.user.id,p_session_id:sid}))) { await client.auth.signOut({scope:'local'}); res.redirect(303,'/?auth=link-invalid'); return; }
  if ('redirectType' in data && data.redirectType==='recovery') {
    const nonce=randomBytes(32).toString('hex');
    await result(database().rpc('evia_prepare_recovery',{p_hash:tokenHash(nonce),p_user_id:data.user.id,p_session_id:sid}));
    res.append('Set-Cookie',serializeCookieHeader('evia_recovery',nonce,{path:'/',maxAge:900,httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'||Boolean(process.env.VERCEL)}));
    res.redirect(303,'/auth/recovery'); return;
  }
  // No arbitrary next parameter or URL fragments can select an external destination.
  res.redirect(303,'/?auth=confirmed');
});
authRouter.post('/resend-confirmation', loginLimiter, async (req,res) => {
  if (!validEmail(req.body?.email)) { res.status(400).json({error:'A valid email is required.'}); return; }
  const {error}=await createAuthClient(req,res).auth.resend({type:'signup',email:req.body.email.trim().toLowerCase(),options:{emailRedirectTo:authOrigin(req)+'/api/auth/callback'}});
  if (error?.status===429) { res.status(429).json({error:'Please wait before requesting another email.'}); return; }
  if (error && (error.status??0)>=500) { res.status(503).json({error:'Email delivery is temporarily unavailable.'}); return; }
  res.status(202).json({ok:true,message:'If the account can be confirmed, a confirmation email has been requested.'});
});
authRouter.post('/password-reset', loginLimiter, async (req,res) => {
  if (!validEmail(req.body?.email)) { res.status(400).json({error:'A valid email is required.'}); return; }
  const {error}=await createAuthClient(req,res).auth.resetPasswordForEmail(req.body.email.trim().toLowerCase(),{redirectTo:authOrigin(req)+'/api/auth/callback'});
  if (error?.status===429) { res.status(429).json({error:'Please wait before requesting another email.'}); return; }
  if (error && (error.status??0)>=500) { res.status(503).json({error:'Email delivery is temporarily unavailable.'}); return; }
  res.status(202).json({ok:true,message:'If that account exists, a password-reset email has been requested.'});
});
authRouter.post('/password', loginLimiter, requireAuth, async (req,res) => {
  const validation=passwordError(req.body?.password);
  if (validation) { res.status(400).json({error:validation}); return; }
  const nonce=parseCookieHeader(req.headers.cookie??'').find(c=>c.name==='evia_recovery')?.value;
  const authorized=nonce && /^[a-f0-9]{64}$/.test(nonce) && await result<boolean>(database().rpc('evia_consume_recovery',{p_hash:tokenHash(nonce),p_user_id:req.userId!,p_session_id:req.authSessionId!}));
  if (!authorized) { res.status(403).json({error:'Request a fresh password-reset email to change your password.'}); return; }
  const client=createAuthClient(req,res);
  const {error}=await client.auth.updateUser({password:req.body.password});
  if (error) { res.status(400).json({error:'The password could not be updated. Request a new reset link.'}); return; }
  const {error: revokeError}=await createAdminClient().auth.admin.signOut(req.authAccessToken!,'global');
  clearAuthCookies(req,res);
  if (revokeError) { res.status(503).json({error:'Password changed, but session revocation could not be confirmed. Sign in again and contact support.'}); return; }
  res.json({ok:true});
});
authRouter.post('/logout', async (req,res) => {
  try {
    const identity=await verifiedIdentity(req,res);
    if (identity) {
      const {error}=await createAdminClient().auth.admin.signOut(identity.accessToken,'local');
      if (error && error.status!==404 && error.status!==401) throw error;
    }
    clearAuthCookies(req,res); res.json({ok:true});
  } catch { clearAuthCookies(req,res); res.status(503).json({error:'This browser is signed out, but server revocation could not be confirmed.'}); }
});
