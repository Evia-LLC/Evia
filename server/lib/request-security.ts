import type { Request, Response, NextFunction } from 'express';
import { allowedOrigins, authOrigin, privateResponse } from './auth-session.ts';
/** Same-origin BFF: no cross-site cookie mutations and no form-content login CSRF. */
export function requestSecurity(req: Request, res: Response, next: NextFunction): void {
  privateResponse(res);
  if (['GET','HEAD','OPTIONS'].includes(req.method)) { next(); return; }
  const origin = req.get('origin');
  const site = req.get('sec-fetch-site');
  if (site === 'cross-site' || origin === 'null') { res.status(403).json({error:'Cross-site request rejected.'}); return; }
  if (origin) {
    let own=''; try { own=authOrigin(req); } catch { /* Explicit allowed origins may still apply. */ }
    if (origin !== own && !allowedOrigins().has(origin)) { res.status(403).json({error:'Cross-site request rejected.'}); return; }
  }
  if (req.headers.cookie && !origin && site !== 'same-origin' && req.get('x-evia-request') !== '1') { res.status(403).json({error:'Request verification is required.'}); return; }
  if ((Number(req.get('content-length') ?? '0') > 0 || req.get('transfer-encoding')) && !req.is('application/json')) { res.status(415).json({error:'JSON requests are required.'}); return; }
  next();
}
