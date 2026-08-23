import type { AppRedis } from '@/lib/redis';
import type { NextApiRequest } from 'next';
import { verifyInitDataId } from '@/lib/verifyInitData';
import {
  readSessionFromCookieHeader,
  readSessionFromReq,
  type SessionPayload,
} from '@/lib/sessionCookie';
import { getAccountById, type WebAccount } from '@/lib/webAccount';

export type ResolvedIdentity =
  | {
      ok: true;
      tgId: string;
      via: 'initData' | 'session';
      account: WebAccount | null;
    }
  | { ok: false; status: number; error: string; code?: string };

export type ResolveIdentityOpts = {
  telegramId?: unknown;
  initData?: unknown;
  requireTelegram?: boolean;
  cookieHeader?: string | null;
};

async function resolveWithSession(
  redis: AppRedis,
  session: SessionPayload | null,
  bodyTg: string,
  requireTelegram: boolean,
): Promise<ResolvedIdentity | null> {
  if (!session) return null;
  const account = await getAccountById(redis, session.aid);
  if (!account || account.sessionId !== session.sid) {
    return {
      ok: false,
      status: 401,
      error: 'Сессия устарела. Войди снова.',
      code: 'session_replaced',
    };
  }
  if (!account.telegramId) {
    if (!requireTelegram) {
      return { ok: true, tgId: bodyTg || '', via: 'session', account };
    }
    return {
      ok: false,
      status: 403,
      error: 'Привяжи Telegram, чтобы пользоваться приложением.',
      code: 'need_telegram_link',
    };
  }
  if (bodyTg && bodyTg !== account.telegramId) {
    return { ok: false, status: 401, error: 'Несовпадение аккаунта' };
  }
  return { ok: true, tgId: account.telegramId, via: 'session', account };
}

/**
 * Авторизация API: Telegram initData ИЛИ cookie-сессия веб-аккаунта.
 * req может быть null, если передаёте cookieHeader (App Router).
 */
export async function resolveRequestIdentity(
  redis: AppRedis,
  req: NextApiRequest | null,
  opts: ResolveIdentityOpts = {},
): Promise<ResolvedIdentity> {
  const botToken = process.env.BOT_TOKEN || '';
  const bodyTg = String(opts.telegramId ?? req?.body?.telegramId ?? '').trim();
  const initData = String(opts.initData ?? req?.body?.initData ?? '').trim();
  const requireTelegram = opts.requireTelegram !== false;

  if (initData && botToken) {
    const verifiedId = verifyInitDataId(initData, botToken);
    if (verifiedId && (!bodyTg || String(verifiedId) === bodyTg)) {
      const aid = await redis.get<string>(`tg_to_account:${verifiedId}`);
      const account = aid ? await getAccountById(redis, String(aid)) : null;
      return {
        ok: true,
        tgId: String(verifiedId),
        via: 'initData',
        account,
      };
    }
    if (initData && bodyTg && (!verifiedId || String(verifiedId) !== bodyTg)) {
      return { ok: false, status: 401, error: 'Неверная сессия Telegram' };
    }
  }

  const session =
    (req ? readSessionFromReq(req) : null)
    ?? readSessionFromCookieHeader(opts.cookieHeader);

  const fromSession = await resolveWithSession(redis, session, bodyTg, requireTelegram);
  if (fromSession) return fromSession;

  if (bodyTg && !initData) {
    const inWL = await redis.sismember('sub_whitelist', bodyTg);
    if (inWL) {
      return { ok: true, tgId: bodyTg, via: 'initData', account: null };
    }
  }

  return { ok: false, status: 401, error: 'Требуется авторизация' };
}
