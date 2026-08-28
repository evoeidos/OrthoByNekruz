import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { verifyAdminRequest } from '@/lib/adminAuth';

const redis        = createRedisFromEnv();
const WL_KEY       = 'sub_whitelist';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action, tgId } = req.body;

  const auth = verifyAdminRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  if (action === 'list_keys') {
    const keys = await redis.smembers('valid_keys');
    return res.status(200).json({ ok: true, keys });
  }

  if (action === 'list') {
    const members = await redis.smembers(WL_KEY);
    return res.status(200).json({ ok: true, ids: members });
  }

  if (action === 'add') {
    if (!tgId) return res.status(400).json({ error: 'tgId required' });
    await redis.sadd(WL_KEY, String(tgId));
    return res.status(200).json({ ok: true });
  }

  if (action === 'remove') {
    if (!tgId) return res.status(400).json({ error: 'tgId required' });
    await redis.srem(WL_KEY, String(tgId));
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action. Use: list | add | remove' });
}
