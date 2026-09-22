import type { NextApiRequest, NextApiResponse } from 'next';
import { bindUniversityAccount } from '@/lib/krasgmu/bindAccount';
import { createRedisFromEnv } from '@/lib/redis';
import { resolveRequestIdentity } from '@/lib/resolveIdentity';

const redis = createRedisFromEnv();

/** @deprecated Используйте POST /api/auth/university (App Router) */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { telegramId, initData, login, password } = req.body ?? {};

  const identity = await resolveRequestIdentity(redis, req, {
    telegramId,
    initData,
    requireTelegram: true,
  });
  if (!identity.ok) {
    return res.status(identity.status).json({ error: identity.error, code: identity.code });
  }

  const result = await bindUniversityAccount(
    redis,
    identity.tgId,
    String(login ?? ''),
    String(password ?? ''),
  );
  if (!result.ok) {
    return res.status(result.status).json({
      error: result.error,
      code: result.code,
      detail: result.detail,
    });
  }

  return res.status(200).json({
    success: true,
    message: result.message,
    login: result.login,
  });
}
