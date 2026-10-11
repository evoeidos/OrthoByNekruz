// Проверка живости для внешнего мониторинга (UptimeRobot и т.п.):
// 200 — сервер отвечает и Redis доступен, 503 — Redis недоступен.
// Если сервер упал целиком, ответа не будет вовсе — это и ловит мониторинг.
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { alertAdmin } from '@/lib/alertAdmin';

const REDIS_TIMEOUT_MS = 3000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).end();
  res.setHeader('Cache-Control', 'no-store');

  const build = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';
  const started = Date.now();
  try {
    const redis = createRedisFromEnv();
    await Promise.race([
      redis.get('health:ping'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('redis timeout')), REDIS_TIMEOUT_MS)),
    ]);
    return res.status(200).json({ ok: true, redis: 'ok', redisMs: Date.now() - started, build });
  } catch (e) {
    console.error('[health] redis недоступен', e);
    alertAdmin('health:redis', 'Redis не отвечает', e);
    return res.status(503).json({ ok: false, redis: 'down', build });
  }
}
