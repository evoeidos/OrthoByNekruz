import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { verifyAdminRequest } from '@/lib/adminAuth';
import { getSessionStats } from '@/lib/krasgmu/sessionStats';

const redis        = createRedisFromEnv();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = verifyAdminRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const stats = await getSessionStats(redis);
    return res.status(200).json({ success: true, stats });
  } catch (e) {
    console.error('[admin-krasgmu-sessions]', e);
    return res.status(500).json({ error: 'Не удалось загрузить статистику сессий' });
  }
}
