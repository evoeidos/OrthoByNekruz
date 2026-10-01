import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { exchangeTelegramCode } from '@/lib/telegramOidc';
import { buildClearOidcStateCookieHeader, readOidcStateCookie } from '@/lib/telegramOidcState';
import { buildSessionCookieHeader } from '@/lib/sessionCookie';
import {
  createTelegramAccount,
  getAccountByTelegramId,
  rotateSession,
} from '@/lib/webAccount';

const redis = createRedisFromEnv();
const APP_URL = (process.env.APP_URL || 'https://nekruz2000n-eng-orthobynekruz-a9a4.twc1.net').replace(/\/$/, '');
const CLIENT_ID = process.env.TELEGRAM_OIDC_CLIENT_ID || '';
const CLIENT_SECRET = process.env.TELEGRAM_OIDC_CLIENT_SECRET || '';

function failPage(res: NextApiResponse, status: number, message: string) {
  res.setHeader('Set-Cookie', buildClearOidcStateCookieHeader());
  res.status(status).send(
    `<!doctype html><meta charset="utf-8">`
    + `<body style="font-family:sans-serif;background:#0A0E0C;color:#fff;padding:32px">`
    + `<p>${message}</p><p><a href="${APP_URL}/" style="color:#8fd" >Вернуться на сайт</a></p>`
    + `</body>`,
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  if (req.query.error) {
    return failPage(res, 400, 'Вход через Telegram отменён.');
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return failPage(res, 503, 'Вход через Telegram не настроен на сервере.');
  }

  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  if (!code || !state) {
    return failPage(res, 400, 'Некорректный ответ от Telegram.');
  }

  const saved = readOidcStateCookie(req);
  if (!saved || saved.state !== state) {
    return failPage(res, 400, 'Сессия входа истекла. Попробуйте снова.');
  }

  try {
    const redirectUri = `${APP_URL}/api/auth/telegram-oidc/callback`;
    const profile = await exchangeTelegramCode({
      code,
      codeVerifier: saved.codeVerifier,
      redirectUri,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    let account = await getAccountByTelegramId(redis, profile.telegramId);
    account = account
      ? await rotateSession(redis, account)
      : await createTelegramAccount(redis, profile.telegramId);

    res.setHeader('Set-Cookie', [
      buildClearOidcStateCookieHeader(),
      buildSessionCookieHeader(account.id, account.sessionId),
    ]);
    res.writeHead(302, { Location: `${APP_URL}/` });
    res.end();
  } catch (e) {
    console.error('[telegram-oidc/callback]', e);
    return failPage(res, 502, 'Не удалось войти через Telegram. Попробуйте позже.');
  }
}
