import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';

const redis = createRedisFromEnv();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end();
  res.setHeader('Cache-Control', 'no-store');
  try {
    const version = (await redis.get<number>('cache_version')) ?? 0;
    return res.status(200).json({ version });
  } catch {
    return res.status(200).json({ version: 0 });
  }
}
