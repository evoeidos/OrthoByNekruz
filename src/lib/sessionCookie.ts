import { createHmac, timingSafeEqual } from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

export const SESSION_COOKIE = 'bn_sid';
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

function secret(): string {
  return process.env.SESSION_SECRET || process.env.BOT_TOKEN || '';
}

export type SessionPayload = { aid: string; sid: string };

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function encodeSessionCookie(aid: string, sid: string): string {
  const body = Buffer.from(JSON.stringify({ aid, sid } satisfies SessionPayload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function decodeSessionCookie(raw: string | undefined | null): SessionPayload | null {
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
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed?.aid || !parsed?.sid) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readSessionFromReq(req: NextApiRequest): SessionPayload | null {
  const raw = req.cookies?.[SESSION_COOKIE];
  return decodeSessionCookie(raw);
}

export function readSessionFromCookieHeader(cookieHeader: string | null | undefined): SessionPayload | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=');
    if (k === SESSION_COOKIE) return decodeSessionCookie(rest.join('='));
  }
  return null;
}

export function setSessionCookie(res: NextApiResponse, aid: string, sid: string): void {
  const value = encodeSessionCookie(aid, sid);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`,
  );
}

export function clearSessionCookie(res: NextApiResponse): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}
