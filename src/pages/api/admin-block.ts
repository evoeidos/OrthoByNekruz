// pages/api/admin-block.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';

const redis        = createRedisFromEnv();
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { tgId, action, secret } = req.body;

    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!tgId) return res.status(400).json({ error: 'tgId required' });

    let user: any = await redis.get(`user_id:${tgId}`);
    if (typeof user === 'string') {
      try { user = JSON.parse(user); } catch { user = null; }
    }
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (action === 'block') {
      await redis.set(`user_id:${tgId}`, {
        ...user,
        blocked:       true,
        blockedReason: 'manual',
        blockedAt:     new Date().toISOString(),
      });
      return res.status(200).json({ ok: true, message: `User ${tgId} blocked` });
    }

    if (action === 'unblock') {
      const updated: Record<string, any> = { ...user };
      delete updated.blocked;
      delete updated.blockedReason;
      delete updated.blockedAt;
      await redis.set(`user_id:${tgId}`, updated);
      // Сбрасываем счётчик открытий — чистый старт
      const today = new Date().toISOString().slice(0, 10);
      await redis.del(`opens:${tgId}:${today}`);
      return res.status(200).json({ ok: true, message: `User ${tgId} unblocked` });
    }

    if (action === 'info') {
      const today = new Date().toISOString().slice(0, 10);
      const opens = await redis.get(`opens:${tgId}:${today}`) || 0;
      return res.status(200).json({
        ok:           true,
        tgId,
        blocked:      user.blocked === true,
        opensToday:   opens,
        activatedKey: user.activatedKey,
        hasMicro:     user.micro === true,
        date:         user.date,
        blockedAt:    user.blockedAt    || null,
        blockedReason:user.blockedReason || null,
      });
    }

    return res.status(400).json({ error: 'Unknown action. Use: block | unblock | info' });

  } catch (err) {
    console.error('admin-block error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}