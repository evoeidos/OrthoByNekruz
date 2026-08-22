import type { NextApiRequest, NextApiResponse } from 'next';
import { createRedisFromEnv } from '@/lib/redis';
import { verifyInitDataUser } from '@/lib/verifyInitData';
import { getFacultyStudentStats } from '@/lib/facultyStats';

const redis        = createRedisFromEnv();
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const ADMIN_TG_ID  = process.env.ADMIN_TG_ID || '978243325';
const BOT_TOKEN    = process.env.BOT_TOKEN    || '';

function verifyAdmin(initData: string, secret: string): boolean {
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return false;
  if (!BOT_TOKEN) return false;
  const tgUser = verifyInitDataUser(initData, BOT_TOKEN);
  if (!tgUser || String(tgUser.id) !== ADMIN_TG_ID) return false;
  return true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { initData, secret, force } = req.body ?? {};
  if (!initData || !secret || !verifyAdmin(String(initData), String(secret))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const stats = await getFacultyStudentStats(redis, { force: force === true });
    return res.status(200).json({ success: true, stats });
  } catch (e) {
    console.error('[admin-faculty-stats]', e);
    return res.status(500).json({ error: 'Не удалось посчитать статистику' });
  }
}
