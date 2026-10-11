// Веб-сессия после входа через Telegram (OIDC): кто я, выход, привязка.
// Вход по email/паролю и сброс пароля убраны — веб-вход только через Telegram.
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import {
  clearSessionCookie,
  readSessionFromReq,
  setSessionCookie,
} from '@/lib/sessionCookie';
import {
  getAccountById,
  linkTelegramToAccount,
  rotateSession,
  toPublicAccount,
  type WebAccount,
} from '@/lib/webAccount';
import { verifyTelegramLoginWidget, type TelegramLoginUser } from '@/lib/telegramLoginWidget';
import { getChannelUsername, isChannelSubscribed } from '@/lib/channelSubscription';
import { isRedisUnavailableError } from '@/lib/redisDegraded';
import { alertAdmin } from '@/lib/alertAdmin';

const redis = createRedisFromEnv();
const BOT_TOKEN = process.env.BOT_TOKEN || '';

function publicOk(account: WebAccount, extra: Record<string, unknown> = {}) {
  return {
    success: true,
    account: toPublicAccount(account),
    ...extra,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const mode = String(req.body?.mode || '').trim();

  try {
    if (mode === 'logout') {
      const session = readSessionFromReq(req);
      if (session) {
        const account = await getAccountById(redis, session.aid);
        if (account && account.sessionId === session.sid) {
          await rotateSession(redis, account);
        }
      }
      clearSessionCookie(res);
      return res.status(200).json({ success: true });
    }

    if (mode === 'me') {
      const session = readSessionFromReq(req);
      if (!session) {
        return res.status(401).json({ error: 'Нет сессии', authenticated: false });
      }
      const account = await getAccountById(redis, session.aid);
      if (!account || account.sessionId !== session.sid) {
        clearSessionCookie(res);
        return res.status(401).json({
          error: 'Сессия устарела (вход с другого устройства).',
          code: 'session_replaced',
          authenticated: false,
        });
      }
      let subscribed: boolean | null = null;
      if (account.telegramId) {
        subscribed = await isChannelSubscribed(Number(account.telegramId));
      }
      return res.status(200).json({
        authenticated: true,
        account: toPublicAccount(account),
        needSubscription: subscribed === false,
        channel: getChannelUsername(),
        botUsername: process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
          || process.env.TELEGRAM_BOT_USERNAME
          || '',
      });
    }

    if (mode === 'link_telegram') {
      const session = readSessionFromReq(req);
      if (!session) {
        return res.status(401).json({ error: 'Сначала войди на сайт.' });
      }
      let account = await getAccountById(redis, session.aid);
      if (!account || account.sessionId !== session.sid) {
        clearSessionCookie(res);
        return res.status(401).json({ error: 'Сессия устарела.', code: 'session_replaced' });
      }
      if (!BOT_TOKEN) {
        return res.status(503).json({ error: 'BOT_TOKEN не настроен.' });
      }
      const tgUser = req.body?.telegram as TelegramLoginUser;
      if (!verifyTelegramLoginWidget(tgUser, BOT_TOKEN)) {
        return res.status(401).json({ error: 'Неверные данные Telegram Login.' });
      }
      try {
        account = await linkTelegramToAccount(redis, account, String(tgUser.id));
      } catch (e) {
        if ((e as Error).message === 'TG_TAKEN') {
          return res.status(409).json({
            error: 'Этот Telegram уже привязан к другому email.',
          });
        }
        throw e;
      }
      const subscribed = await isChannelSubscribed(Number(tgUser.id));
      return res.status(200).json(publicOk(account, {
        needSubscription: !subscribed,
        channel: getChannelUsername(),
        telegram: {
          id: tgUser.id,
          username: tgUser.username || null,
          firstName: tgUser.first_name || null,
        },
      }));
    }

    return res.status(400).json({ error: 'Unknown mode' });
  } catch (e) {
    console.error('[web-auth]', e);
    alertAdmin('web-auth:500', 'веб-вход: ошибка сервера', e);
    if (isRedisUnavailableError(e)) {
      return res.status(503).json({
        error: 'База данных временно перегружена (лимит Upstash). Попробуй через пару минут.',
      });
    }
    const msg = String(e instanceof Error ? e.message : e);
    if (msg.includes('Redis env missing')) {
      return res.status(503).json({
        error: 'Сервер без Redis: задай KV_REST_API_URL/TOKEN или UPSTASH_REDIS_REST_URL/TOKEN.',
      });
    }
    return res.status(500).json({ error: 'Ошибка сервера.' });
  }
}
