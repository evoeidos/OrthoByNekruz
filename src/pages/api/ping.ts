// pages/api/ping.ts  ← Pages Router формат
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { verifyInitDataId } from '@/lib/verifyInitData';
import { touchUserVisit } from '@/lib/userActivity';

const redis            = createRedisFromEnv();
const BOT_TOKEN        = process.env.BOT_TOKEN    || '';
const ADMIN_TG_ID      = process.env.ADMIN_TG_ID  || '';
const DAILY_OPEN_LIMIT = 50;

async function notifyAdmin(tgId: string, count: number): Promise<void> {
  if (!ADMIN_TG_ID || !BOT_TOKEN) {
    console.error('[ping] notifyAdmin: BOT_TOKEN или ADMIN_TG_ID не заданы!');
    return;
  }
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:    ADMIN_TG_ID,
          text:       `⚠️ <b>ByNekruz — подозрительная активность</b>\n\nTelegram ID: <code>${tgId}</code>\nОткрытий сегодня: <b>${count}</b>\n\nВозможно аккаунт используется несколькими людьми.`,
          parse_mode: 'HTML',
        }),
      }
    );
    const data = await resp.json();
    if (!data.ok) {
      console.error('[ping] Telegram error:', JSON.stringify(data));
    } else {
      console.log('[ping] Уведомление отправлено! userId:', tgId, 'opens:', count);
    }
  } catch (e) {
    console.error('[ping] fetch error:', e);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { telegramId, initData } = req.body;

    if (!telegramId || !initData) {
      console.error('[ping] Missing telegramId or initData');
      return res.status(400).json({ ok: false, reason: 'missing' });
    }

    const userId = verifyInitDataId(initData, BOT_TOKEN);
    if (!userId || String(userId) !== String(telegramId)) {
      console.error('[ping] auth failed. userId:', userId, 'tgId:', telegramId);
      return res.status(401).json({ ok: false, reason: 'auth' });
    }

    const tgId  = String(telegramId);

    // Создатель приложения — никогда не блокируется и не отслеживается
    if (ADMIN_TG_ID && tgId === ADMIN_TG_ID) {
      return res.status(200).json({ ok: true, opens: 0 });
    }

    // При лимите Redis — пропускаем учёт открытий, не ломаем вход
    try {
      const userData: any = await redis.get(`user_id:${tgId}`);
      if (userData?.blocked === true) {
        console.log(`[ping] blocked user: ${tgId}`);
        return res.status(200).json({ ok: true, blocked: true });
      }

      const today = new Date().toISOString().slice(0, 10);
      const actKey      = `opens:${tgId}:${today}`;
      const notifiedKey = `opens_notified:${tgId}:${today}`;

      const count = await redis.incr(actKey);
      if (count === 1) await redis.expire(actKey, 48 * 3600);

      if (userData && typeof userData === 'object') {
        await redis.set(`user_id:${tgId}`, touchUserVisit(userData));
      }

      console.log(`[ping] userId=${tgId} opens=${count} limit=${DAILY_OPEN_LIMIT}`);

      if (count >= DAILY_OPEN_LIMIT) {
        const alreadyNotified = await redis.exists(notifiedKey);
        if (!alreadyNotified) {
          await redis.set(notifiedKey, '1', { ex: 48 * 3600 });

          const user: any = await redis.get(`user_id:${tgId}`);
          if (user && typeof user === 'object') {
            await redis.set(`user_id:${tgId}`, {
              ...user,
              blocked:       true,
              blockedReason: 'activity',
              blockedAt:     new Date().toISOString(),
            });
          }

          await notifyAdmin(tgId, count);
        } else {
          console.log('[ping] уже уведомляли сегодня, пропускаем');
        }
      }

      return res.status(200).json({ ok: true, opens: count });
    } catch (redisErr) {
      console.warn('[ping] redis unavailable, skipping:', redisErr);
      return res.status(200).json({ ok: true, opens: 0, degraded: true });
    }

  } catch (err) {
    console.error('[ping] error:', err);
    return res.status(500).json({ ok: false });
  }
}