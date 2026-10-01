import { createHmac, timingSafeEqual } from 'crypto';
import type { NextApiRequest } from 'next';

const COOKIE = 'bn_toidc';
// Достаточно времени, чтобы пользователь успел ввести код входа на oauth.telegram.org.
const MAX_AGE_SEC = 10 * 60;

function secret(): string {
  return process.env.SESSION_SECRET || process.env.BOT_TOKEN || '';
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export type OidcStatePayload = { state: string; codeVerifier: string };

export function buildOidcStateCookieHeader(payload: OidcStatePayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const value = `${body}.${sign(body)}`;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`;
}

export function buildClearOidcStateCookieHeader(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function readOidcStateCookie(req: NextApiRequest): OidcStatePayload | null {
  const raw = req.cookies?.[COOKIE];
  if (!raw || !secret()) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OidcStatePayload;
    if (!parsed?.state || !parsed?.codeVerifier) return null;
    return parsed;
  } catch {
    return null;
  }
}
