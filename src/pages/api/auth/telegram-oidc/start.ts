import type { NextApiRequest, NextApiResponse } from 'next';
import { buildTelegramAuthorizationUrl, generatePkce, generateState } from '@/lib/telegramOidc';
import { buildOidcStateCookieHeader } from '@/lib/telegramOidcState';

const APP_URL = (process.env.APP_URL || 'https://nekruz2000n-eng-orthobynekruz-a9a4.twc1.net').replace(/\/$/, '');
const CLIENT_ID = process.env.TELEGRAM_OIDC_CLIENT_ID || '';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  if (!CLIENT_ID) {
    return res
      .status(503)
      .send('Вход через Telegram не настроен на сервере: нет TELEGRAM_OIDC_CLIENT_ID.');
  }

  const state = generateState();
  const { codeVerifier, codeChallenge } = generatePkce();
  res.setHeader('Set-Cookie', buildOidcStateCookieHeader({ state, codeVerifier }));

  const redirectUri = `${APP_URL}/api/auth/telegram-oidc/callback`;
  const url = buildTelegramAuthorizationUrl({ clientId: CLIENT_ID, redirectUri, state, codeChallenge });
  res.writeHead(302, { Location: url });
  res.end();
}
