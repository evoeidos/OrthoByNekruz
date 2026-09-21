import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { resolveRequestIdentity } from '@/lib/resolveIdentity';
import { KrasgmuAuthError, loginKrasgmu } from '@/lib/krasgmu/client';
import { saveBinding } from '@/lib/krasgmu/store';

const redis = createRedisFromEnv();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { telegramId, initData, login, password } = req.body ?? {};
  const loginStr = String(login ?? '').trim();
  const passStr = String(password ?? '');

  if (!loginStr || !passStr) {
    return res.status(400).json({ error: 'Укажите логин и пароль' });
  }

  const identity = await resolveRequestIdentity(redis, req, {
    telegramId,
    initData,
    requireTelegram: true,
  });
  if (!identity.ok) {
    return res.status(identity.status).json({ error: identity.error, code: identity.code });
  }

  try {
    const cookies = await loginKrasgmu(loginStr, passStr);
    await saveBinding(redis, identity.tgId, loginStr, passStr, cookies);
    return res.status(200).json({
      success: true,
      message: 'Аккаунт КрасГМУ успешно привязан',
      login: loginStr,
    });
  } catch (e) {
    if (e instanceof KrasgmuAuthError) {
      const status = e.code === 'invalid_credentials' ? 400 : 502;
      return res.status(status).json({ error: e.message, code: e.code });
    }
    console.error('[bind-profile]', e);
    return res.status(500).json({ error: 'Не удалось привязать аккаунт' });
  }
}
