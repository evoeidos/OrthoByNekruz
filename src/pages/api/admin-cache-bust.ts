import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { verifyAdminRequest } from '@/lib/adminAuth';

const redis        = createRedisFromEnv();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const auth = verifyAdminRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  try {
    const version = await redis.incr('cache_version');
    return res.status(200).json({ version });
  } catch (err) {
    console.error('[admin-cache-bust]', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
